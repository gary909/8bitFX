/* 8bitFX — synthesis engine.
   A faithful port of DrPetter's sfxr render loop: everything is synthesised at
   8x oversampling (352.8 kHz) from a hand-drawn waveform, then averaged down to
   the requested sample rate and quantised to 8 or 16 bit.

   Parameter convention (see params.js):
     p_* values are 0..1 (or -1..1 for signed controls), exactly like sfxr. */
(function (root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.SFX = root.SFX || {};
  root.SFX.synth = api;
}(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this), function (root) {
  "use strict";

  var OVERSAMPLING = 8;
  var BASE_RATE = 44100;
  var MAX_SECONDS = 4;                           /* hard cap on render length */
  var RING_SIZE = 8192;                          /* flanger delay line */
  var NORMALIZE_PEAK = 0.891;                    /* -1 dBFS target */
  var DC_CUTOFF_HZ = 25;                         /* DC blocker corner frequency */
  var FADE_OUT_SECONDS = 0.001;                  /* anti-click tail fade */
  var END_LEVEL = 0.01;                          /* fade only if the tail is louder than this */

  function sq(x) { return x * x; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function P() { return root.SFX.params; }

  /* ------------------------------------------------------------------
     render(): produce the float sample buffer for a parameter set.
     Returns { float, frames, sampleRate, bits, duration, peak, gain }
     ------------------------------------------------------------------ */
  function render(params, options) {
    options = options || {};
    var p = P().coerce(params);
    var k = P().toKnobsCoerced(p);
    var rnd = root.SFX.rng.make(p.noise_seed);
    /* Oversampling can be lowered for fast previews while a slider is dragged;
       exports and commits always render at the full rate. */
    var os = (options.oversampling === 2 || options.oversampling === 4)
      ? options.oversampling
      : OVERSAMPLING;
    var isr = BASE_RATE * os;

    /* ---- envelope lengths (sfxr times are always specified at 44.1 kHz) ---- */
    var envLen = [
      Math.round(k.attack * isr),
      Math.round(k.sustain * isr),
      Math.round(k.decay * isr)
    ];
    var total = envLen[0] + envLen[1] + envLen[2];
    if (total < 8) { envLen[2] += 8 - total; total = 8; }
    var maxTotal = Math.round(MAX_SECONDS * isr);
    var capped = false;
    if (total > maxTotal) {
      var shrink = maxTotal / total;
      envLen[0] = Math.floor(envLen[0] * shrink);
      envLen[1] = Math.floor(envLen[1] * shrink);
      envLen[2] = maxTotal - envLen[0] - envLen[1];
      total = maxTotal;
      capped = true;
    }

    /* sub-samples averaged into one output sample. This can be fractional
       (352800/8000 = 44.1), which keeps the output rate exactly as requested. */
    var summands = isr / k.sampleRate;
    var frames = Math.max(1, Math.floor(total / summands));

    /* ---- oscillator setup ---- */
    var period0 = clamp(isr / k.freq, 4, isr * 4);
    var period = period0;
    var periodMult = Math.pow(2, -k.freqSlideOct / isr);   /* constant slide rate */
    var periodSlide = k.freqDramp;                          /* linear slide (small) */
    var periodMax = k.freqLimitOn ? clamp(isr / k.freqMin, 4, isr * 4) : isr * 4;
    var absoluteMaxPeriod = isr * 4;

    var vibPhase = 0;
    var vibInc = 2 * k.vibHz / isr;
    var vibDepth = k.vibDepth;

    var arpBoost = 1;
    var arpLimit = k.arpSeconds > 0 ? Math.max(1, Math.round(k.arpSeconds * isr)) : 0;
    var arpTimer = 0;
    var arpMult = k.arpMult;

    var dutyNow = clamp(k.duty, 0.01, 0.99);
    var dutyStep = k.dutySweep / isr;

    var retrigLimit = k.retriggerHz > 0 ? Math.max(2, Math.round(isr / k.retriggerHz)) : 0;
    var retrigTimer = 0;

    /* ---- flanger ---- */
    var flangerOn = (k.flangerOffset !== 0) || (k.flangerSweep !== 0);
    var ring = flangerOn ? new Float32Array(RING_SIZE) : null;
    var ringIdx = 0;
    var delay = clamp(Math.abs(k.flangerOffset) * isr, 0, RING_SIZE - 1);
    var delayStep = k.flangerSweep;   /* seconds/second -> samples/sample */

    /* ---- low-pass filter (1-pole with sfxr's resonance feedback) ---- */
    var lpfOn = k.lpfOn;
    var lpfW = 0, lpfDamp = 0;
    if (lpfOn) {
      var lpfCut = Math.min(k.lpfHz, isr * 0.45);
      lpfW = clamp(1 - Math.exp(-2 * Math.PI * lpfCut / isr), 0.0001, 0.1);
      lpfDamp = Math.min(0.8, 5 / (1 + sq(p.p_lpf_resonance) * 20) * (0.01 + lpfW));
    }
    var lpfSweepStep = Math.pow(1 + p.p_lpf_ramp / 10000, 44100 / isr);
    var lpfSweeping = lpfSweepStep !== 1;

    /* ---- high-pass filter ---- */
    var hpfA = 1 / (1 + 2 * Math.PI * Math.min(k.hpfHz, isr * 0.45) / isr);
    var hpfSweepStep = Math.pow(1 + p.p_hpf_ramp * 0.0003, 44100 / isr);
    var hpPrevIn = 0, hpPrevOut = 0;

    /* ---- DC blocker (removes the offset a narrow pulse or noise wave carries) ---- */
    var dcOn = !!p.p_dc_block;
    var dcA = Math.exp(-2 * Math.PI * DC_CUTOFF_HZ / isr);
    var dcPrevIn = 0, dcPrevOut = 0;

    /* ---- waveform levelling: square already peaks at ±0.5, the others at ±1 ---- */
    var trimOn = !!p.p_wave_trim;
    var waveGain = (k.waveType === 0) ? 1 : 0.5;

    /* ---- state ---- */
    var float = new Float32Array(frames);
    var noise = new Float32Array(32);
    for (var n = 0; n < 32; n++) { noise[n] = rnd.next() * 2 - 1; }

    var envStage = 0, envTime = 0, envVol = 0;
    var phase = 0;
    var lp = 0, lpDelta = 0;
    var acc = 0, accCount = 0, accPos = 0, outIdx = 0;
    var i, sub, ip;

    for (i = 0; i < total; i++) {
      /* ---- envelope: attack -> sustain (with punch) -> decay ---- */
      envTime++;
      if (envTime > envLen[envStage]) {
        envStage++;
        envTime = 1;
        if (envStage > 2) { break; }
      }
      if (envStage === 0) {
        envVol = envLen[0] ? envTime / envLen[0] : 1;
      } else if (envStage === 1) {
        envVol = 1 + sq(1 - k.punch) * 2 * (envLen[1] ? (1 - envTime / envLen[1]) : 0);
      } else {
        envVol = 1 - (envLen[2] ? envTime / envLen[2] : 1);
      }
      if (envVol < 0) { envVol = 0; }

      /* ---- retrigger ---- */
      if (retrigLimit) {
        retrigTimer++;
        if (retrigTimer >= retrigLimit) { retrigTimer = 0; phase = 0; }
      }

      /* ---- pitch glide ---- */
      period *= periodMult;
      period += periodSlide;
      if (period > periodMax) { period = periodMax; }
      if (period < 4) { period = 4; }
      else if (period > absoluteMaxPeriod) { period = absoluteMaxPeriod; }

      /* ---- arpeggio (cumulative, like sfxr's ladder) ---- */
      if (arpLimit) {
        arpTimer++;
        if (arpTimer >= arpLimit) {
          arpTimer = 0;
          arpBoost *= arpMult;
          if (arpBoost > 64) { arpBoost = 64; }
          else if (arpBoost < 0.015625) { arpBoost = 0.015625; }
        }
      }

      /* ---- vibrato ---- */
      if (vibInc !== 0) {
        vibPhase += vibInc;
        if (vibPhase > 1) { vibPhase -= 2; }
        else if (vibPhase < -1) { vibPhase += 2; }
      }

      ip = period * arpBoost * (1 + vibPhase * vibDepth);
      if (ip < 4) { ip = 4; }
      else if (ip > absoluteMaxPeriod) { ip = absoluteMaxPeriod; }

      /* ---- pulse-width sweep ---- */
      if (dutyStep !== 0) {
        dutyNow += dutyStep;
        if (dutyNow < 0.01) { dutyNow = 0.01; }
        else if (dutyNow > 0.99) { dutyNow = 0.99; }
      }

      /* ---- oscillator ---- */
      phase += 1 / ip;
      if (phase >= 1) { phase -= 1; }   /* increment is <= 0.25, so one step is enough */

      if (k.waveType === 0) {
        sub = phase < dutyNow ? 0.5 : -0.5;
      } else if (k.waveType === 1) {
        sub = phase < dutyNow
          ? -1 + 2 * (phase / dutyNow)
          : 1 - 2 * ((phase - dutyNow) / (1 - dutyNow));
      } else if (k.waveType === 2) {
        sub = Math.sin(phase * 2 * Math.PI);
      } else {
        sub = noise[(phase * 32) | 0];
      }

      if (trimOn) { sub *= waveGain; }

      /* ---- low-pass (1-pole with resonance feedback) ---- */
      if (lpfOn) {
        lpDelta += (sub - lp) * lpfW;
        lpDelta -= lpDelta * lpfDamp;
        lp += lpDelta;
        if (lpfSweeping) {
          lpfW *= lpfSweepStep;
          if (lpfW > 0.1) { lpfW = 0.1; }
          else if (lpfW < 0.0001) { lpfW = 0.0001; }
        }
      } else {
        lp = sub;
        lpDelta = 0;
      }
      sub = lp;

      /* ---- high-pass ---- */
      var hp = hpfA * (hpPrevOut + sub - hpPrevIn);
      hpPrevIn = sub;
      hpPrevOut = hp;
      sub = hp;
      if (hpfSweepStep !== 1) {
        hpfA *= hpfSweepStep;
        if (hpfA > 1) { hpfA = 1; }
        else if (hpfA < 0.0001) { hpfA = 0.0001; }
      }

      /* ---- flanger ---- */
      if (flangerOn) {
        ring[ringIdx & (RING_SIZE - 1)] = sub;
        sub += ring[(ringIdx - (delay | 0) + RING_SIZE) & (RING_SIZE - 1)];
        ringIdx++;
        if (delayStep !== 0) {
          delay += delayStep;
          if (delay >= RING_SIZE) { delay -= RING_SIZE; }
          else if (delay < 0) { delay += RING_SIZE; }
        }
      }

      /* ---- DC blocker ---- */
      if (dcOn) {
        var dcOut = sub - dcPrevIn + dcA * dcPrevOut;
        dcPrevIn = sub;
        dcPrevOut = dcOut;
        sub = dcOut;
      }

      /* ---- accumulate sub-samples, decimate to the output rate ----
         accPos carries the fractional remainder, so a non-integer ratio such as
         352800/8000 = 44.1 averages out to exactly the requested rate. */
      acc += sub * envVol;
      accCount++;
      accPos++;
      if (accPos >= summands) {
        float[outIdx++] = acc / accCount;
        acc = 0;
        accCount = 0;
        accPos -= summands;
        if (outIdx >= frames) { break; }
      }
    }

    if (outIdx < frames && accCount > 0) { float[outIdx++] = acc / accCount; }
    if (outIdx < frames) {
      float = float.subarray(0, outIdx);
      frames = outIdx;
    }

    /* ---- anti-click tail fade ----
       With decay = 0 the envelope ends at full level, leaving a step (an audible
       click). Ramp the last millisecond down when the buffer doesn't already end
       near silence, before the peak is measured. */
    var tail = float[frames - 1];
    if (tail < 0) { tail = -tail; }
    if (tail > END_LEVEL) {
      var fadeLen = Math.min(Math.round(isr * FADE_OUT_SECONDS), Math.floor(frames / 4));
      for (i = 0; i < fadeLen; i++) {
        float[frames - 1 - i] *= i / fadeLen;
      }
    }

    /* ---- apply the sound_vol gain and measure the peak ---- */
    var gain = k.gain;
    var peak = 0, v;
    for (i = 0; i < frames; i++) {
      v = float[i] * gain;
      float[i] = v;
      if (v < 0) { v = -v; }
      if (v > peak) { peak = v; }
    }

    return {
      float: float,
      frames: frames,
      sampleRate: k.sampleRate,
      bits: k.sampleSize,
      duration: frames / k.sampleRate,
      peak: peak,
      gain: gain,
      capped: capped,
      oversampling: os
    };
  }


  /* ------------------------------------------------------------------
     quantize(): float samples -> 8-bit unsigned or 16-bit signed PCM.
     options.normalize scales the whole buffer to -1 dBFS first.
     ------------------------------------------------------------------ */
  function quantize(samples, bits, options) {
    options = options || {};
    bits = (bits === 16) ? 16 : 8;
    var n = samples.length, peak = 0, i, v, x;

    if (typeof options.peak === "number" && isFinite(options.peak)) {
      /* render() already measured this, so skip the extra pass */
      peak = options.peak < 0 ? -options.peak : options.peak;
    } else {
      for (i = 0; i < n; i++) {
        x = samples[i];
        if (x < 0) { x = -x; }
        if (x > peak) { peak = x; }
      }
    }
    var scale = (options.normalize && peak > 0) ? NORMALIZE_PEAK / peak : 1;

    var clipped = 0;
    if (bits === 8) {
      var u8 = new Uint8Array(n);
      for (i = 0; i < n; i++) {
        v = Math.floor((samples[i] * scale + 1) * 128);
        if (v > 255) { v = 255; clipped++; }
        else if (v < 0) { v = 0; clipped++; }
        u8[i] = v;
      }
      return { pcm: u8, bits: 8, frames: n, clipped: clipped, peak: peak * scale, scale: scale };
    }

    var i16 = new Int16Array(n);
    for (i = 0; i < n; i++) {
      v = Math.floor(samples[i] * scale * 32768);
      if (v > 32767) { v = 32767; clipped++; }
      else if (v < -32768) { v = -32768; clipped++; }
      i16[i] = v;
    }
    return { pcm: i16, bits: 16, frames: n, clipped: clipped, peak: peak * scale, scale: scale };
  }

  /* PCM -> float, so the preview plays back exactly what the WAV will contain. */
  function dequantize(pcm, bits) {
    var n = pcm.length, out = new Float32Array(n), i;
    if (bits === 8) {
      for (i = 0; i < n; i++) { out[i] = (pcm[i] - 128) / 128; }
    } else {
      for (i = 0; i < n; i++) { out[i] = pcm[i] / 32768; }
    }
    return out;
  }

  return {
    render: render,
    quantize: quantize,
    dequantize: dequantize,
    OVERSAMPLING: OVERSAMPLING,
    BASE_RATE: BASE_RATE,
    DC_CUTOFF_HZ: DC_CUTOFF_HZ,
    MAX_SECONDS: MAX_SECONDS,
    NORMALIZE_PEAK: NORMALIZE_PEAK
  };
}));
