/* 8bitFX — dependency-free test suite.
   Runs in any browser (tests.html) and in the IE-based harness (tests.hta). */
(function (root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.SFX = root.SFX || {};
  root.SFX.tests = api;
}(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this), function (root) {
  "use strict";

  var results = [];

  function assert(cond, message) {
    if (!cond) { throw new Error(message || "assertion failed"); }
  }

  function approx(actual, expected, tolerance, message) {
    if (!(Math.abs(actual - expected) <= tolerance)) {
      throw new Error((message || "out of range") + " (got " + actual +
        ", expected " + expected + " \u00B1 " + tolerance + ")");
    }
  }

  function check(name, fn) {
    try {
      results.push({ name: name, ok: true, detail: String(fn() || "") });
    } catch (e) {
      results.push({ name: name, ok: false, detail: String((e && e.message) || e) });
    }
  }

  function ascii(view, offset, length) {
    var s = "", i;
    for (i = 0; i < length; i++) { s += String.fromCharCode(view.getUint8(offset + i)); }
    return s;
  }

  function zeroCrossings(samples, limit) {
    var count = 0, prev = 0, i, v, now;
    for (i = 0; i < samples.length && i < limit; i++) {
      v = samples[i];
      now = (v > 1e-4) ? 1 : (v < -1e-4 ? -1 : 0);
      if (now !== 0) {
        if (prev !== 0 && now !== prev) { count++; }
        prev = now;
      }
    }
    return count;
  }

  function meanOf(samples, fromPct, toPct) {
    var a = Math.floor(samples.length * fromPct);
    var b = Math.floor(samples.length * toPct);
    var sum = 0, n = 0, i;
    for (i = a; i < b; i++) { sum += samples[i]; n++; }
    return n ? sum / n : 0;
  }

  function run() {
    results = [];
    var P = root.SFX.params;
    var S = root.SFX.synth;
    var W = root.SFX.wav;
    var G = root.SFX.presets;
    var UI = root.SFX.ui;
    var C = root.SFX.codec;
    var B = root.SFX.bank;
    var Z = root.SFX.zip;
    var i, j, k;

    check("WAV header: 8-bit mono PCM", function () {
      var wav = W.encode(new Uint8Array(100), { sampleRate: 8000, bits: 8 });
      var v = new DataView(wav.buffer);
      assert(ascii(v, 0, 4) === "RIFF", "missing RIFF");
      assert(v.getUint32(4, true) === 136, "wrong RIFF size");
      assert(ascii(v, 8, 4) === "WAVE", "missing WAVE");
      assert(ascii(v, 12, 4) === "fmt ", "missing fmt chunk");
      assert(v.getUint32(16, true) === 16, "wrong fmt size");
      assert(v.getUint16(20, true) === 1, "not PCM");
      assert(v.getUint16(22, true) === 1, "not mono");
      assert(v.getUint32(24, true) === 8000, "wrong rate");
      assert(v.getUint32(28, true) === 8000, "wrong byte rate");
      assert(v.getUint16(32, true) === 1, "wrong block align");
      assert(v.getUint16(34, true) === 8, "wrong bit depth");
      assert(ascii(v, 36, 4) === "data", "missing data chunk");
      assert(v.getUint32(40, true) === 100, "wrong data size");
      assert(wav.byteLength === 144, "wrong total size");
      return "144 bytes @ 8 kHz";
    });

    check("WAV header: 16-bit mono PCM", function () {
      var wav = W.encode(new Int16Array(250), { sampleRate: 44100, bits: 16 });
      var v = new DataView(wav.buffer);
      assert(v.getUint32(28, true) === 88200, "wrong byte rate");
      assert(v.getUint16(32, true) === 2, "wrong block align");
      assert(v.getUint16(34, true) === 16, "wrong bit depth");
      assert(v.getUint32(40, true) === 500, "wrong data size");
      assert(wav.byteLength === 544, "wrong total size");
      return "544 bytes @ 44.1 kHz";
    });

    check("WAV samples are little-endian int16", function () {
      var wav = W.encode(new Int16Array([1, -1, 258]), { sampleRate: 44100, bits: 16 });
      var v = new DataView(wav.buffer);
      assert(v.getInt16(44, true) === 1, "first sample wrong");
      assert(v.getInt16(46, true) === -1, "second sample wrong");
      assert(v.getInt16(48, true) === 258, "third sample wrong");
      return "LE verified";
    });

    check("8-bit WAV stores unsigned bytes", function () {
      var wav = W.encode(new Uint8Array([0, 128, 255]), { sampleRate: 44100, bits: 8 });
      var v = new DataView(wav.buffer);
      assert(v.getUint8(44) === 0 && v.getUint8(45) === 128 && v.getUint8(46) === 255,
        "unsigned bytes not preserved");
      return "0 / 128 / 255 preserved";
    });

    check("render is deterministic for a given seed", function () {
      var p = P.defaults(1234);
      p.wave_type = 3;
      p.p_base_freq = 0.5;
      p.p_env_decay = 0.2;
      var a = S.render(p);
      var b = S.render(p);
      assert(a.frames === b.frames, "frame count differs");
      for (i = 0; i < a.frames; i++) {
        assert(a.float[i] === b.float[i], "sample " + i + " differs");
      }
      return a.frames + " identical samples";
    });

    check("noise seed changes the noise texture", function () {
      var p = P.defaults(11);
      p.wave_type = 3;
      p.p_base_freq = 0.5;
      var a = S.render(p);
      var q = P.clone(p);
      q.noise_seed = 999;
      var b = S.render(q);
      var diff = 0;
      for (i = 0; i < Math.min(a.frames, b.frames); i += 37) {
        if (a.float[i] !== b.float[i]) { diff++; }
      }
      assert(diff > 0, "seed had no effect");
      return diff + " sampled differences";
    });

    check("every preset renders audible audio", function () {
      var names = G.names, r, p;
      for (i = 0; i < names.length; i++) {
        p = G.make(names[i], 4242 + i);
        r = S.render(p);
        assert(r.frames > 0, names[i] + " produced no samples");
        assert(r.peak > 0.001, names[i] + " is silent");
        assert(r.duration > 0.02, names[i] + " is too short");
        assert(r.duration <= S.MAX_SECONDS + 0.001, names[i] + " exceeds max length");
        assert(isFinite(r.peak), names[i] + " produced NaN");
      }
      return names.length + " presets OK";
    });

    check("8-bit quantisation stays in 0..255", function () {
      var r = S.render(G.make("explosion", 7));
      var q = S.quantize(r.float, 8, { normalize: true });
      assert(q.pcm.length === r.frames, "length mismatch");
      for (i = 0; i < q.pcm.length; i++) {
        assert(q.pcm[i] >= 0 && q.pcm[i] <= 255, "out of range at " + i);
      }
      assert(q.clipped === 0, "normalised audio should not clip");
      return q.pcm.length + " samples in range";
    });

    check("16-bit quantisation stays in int16 range", function () {
      var r = S.render(G.make("explosion", 8));
      var q = S.quantize(r.float, 16, { normalize: true });
      for (i = 0; i < q.pcm.length; i++) {
        assert(q.pcm[i] >= -32768 && q.pcm[i] <= 32767, "out of range at " + i);
      }
      return q.pcm.length + " samples in range";
    });

    check("normalisation lands on the -1 dBFS target", function () {
      var r = S.render(G.make("laserShoot", 3));
      var q = S.quantize(r.float, 16, { normalize: true });
      approx(q.peak, S.NORMALIZE_PEAK, 0.002, "peak after normalisation");
      assert(S.quantize(r.float, 16, { normalize: false }).scale === 1,
        "raw quantisation must not rescale");
      return "peak " + q.peak.toFixed(4);
    });

    check("sustain time maps to real seconds", function () {
      var p = P.defaults(5);
      p.wave_type = 2;
      p.p_env_attack = 0;
      p.p_env_sustain = Math.sqrt(44100 / 100000);
      p.p_env_decay = 0;
      p.p_base_freq = Math.sqrt(440 / 3528 - 0.001);
      p.sound_vol = 0.5;
      var r = S.render(p);
      approx(r.duration, 1.0, 0.02, "1 s sustain");
      return r.duration.toFixed(3) + " s";
    });

    check("440 Hz tone really oscillates at 440 Hz", function () {
      var p = G.make("tone", 1);
      p.sample_rate = 44100;
      var r = S.render(p);
      var seconds = Math.min(0.5, r.duration);
      var limit = Math.floor(seconds * r.sampleRate);
      var measured = zeroCrossings(r.float, limit) / (2 * (limit / r.sampleRate));
      approx(measured, 440, 25, "measured pitch");
      return measured.toFixed(1) + " Hz";
    });

    check("sound_vol controls gain", function () {
      var quiet = G.make("tone", 1);
      quiet.sound_vol = 0.1;
      var loud = P.clone(quiet);
      loud.sound_vol = 0.7;
      var a = S.render(quiet).peak;
      var b = S.render(loud).peak;
      assert(b > a * 2, "gain did not raise the peak (" + a + " vs " + b + ")");
      return a.toFixed(3) + " -> " + b.toFixed(3);
    });

    check("loud saw wave reports clipping", function () {
      var p = P.defaults(2);
      p.wave_type = 1;
      p.p_wave_trim = 0;      /* unlevelled saw is twice as loud */
      p.sound_vol = 1;
      var r = S.render(p);
      var q = S.quantize(r.float, 8, { normalize: false, peak: r.peak });
      assert(q.clipped > 0, "expected clipping, got " + q.clipped);
      return q.clipped + " clipped samples";
    });

    check("parameter encode/decode round-trips (v2 link)", function () {
      var p = G.make("powerUp", 777);
      p.p_arp_mod = -0.42;
      p.sample_rate = 22050;
      p.sample_size = 16;
      p.p_dc_block = 0;
      p.p_wave_trim = 0;
      var code = C.encode(p);
      assert(code.charAt(0) === "3", "missing v3 version marker");
      assert(!/[+/=]/.test(code), "payload is not URL safe");
      assert(code.length < 60, "link too long: " + code.length);
      var back = C.decode(code);
      assert(back, "decode failed");
      for (i = 0; i < P.LINK_KEYS.length; i++) {
        approx(back[P.LINK_KEYS[i]], p[P.LINK_KEYS[i]], 0.004,
          "round-trip mismatch on " + P.LINK_KEYS[i]);
      }
      assert(back.wave_type === p.wave_type, "wave type lost");
      assert(back.sample_rate === 22050, "sample rate lost");
      assert(back.sample_size === 16, "bit depth lost");
      assert(back.p_dc_block === 0 && back.p_wave_trim === 0, "switches lost");
      assert(back.noise_seed === p.noise_seed, "seed not preserved");
      return code.length + " chars, values within 1/255";
    });

    check("legacy v1 links still decode", function () {
      var p = G.make("explosion", 4242);
      p.p_freq_ramp = -0.33;
      var legacy = C.encodeLegacy(p);
      assert(legacy.charAt(0) !== "2" && legacy.charAt(0) !== "3",
        "a legacy payload must not start with a version marker");
      var back = C.decode(legacy);
      assert(back, "legacy decode failed");
      for (i = 0; i < P.LEGACY_ORDER.length - 1; i++) {
        approx(back[P.LEGACY_ORDER[i]], p[P.LEGACY_ORDER[i]], 1e-4,
          "legacy mismatch on " + P.LEGACY_ORDER[i]);
      }
      assert(back.p_dc_block === 1 && back.p_wave_trim === 1,
        "new parameters should default to ON for old links");
      return legacy.length + " chars of legacy payload decoded";
    });

    check("link keeps a non-preset sample rate (v3)", function () {
      var p = G.make("jump", 21);
      p.sample_rate = 48000;
      var code = C.encode(p);
      assert(code.charAt(0) === "3", "expected a v3 payload");
      var back = C.decode(code);
      assert(back && back.sample_rate === 48000, "custom rate lost: " + (back && back.sample_rate));
      return code.length + " chars, 48 kHz preserved";
    });

    check("sample rates 4-96 kHz are accepted, others fall back", function () {
      assert(P.coerce({ sample_rate: 48000 }).sample_rate === 48000, "48 kHz rejected");
      assert(P.coerce({ sample_rate: 96000 }).sample_rate === 96000, "96 kHz rejected");
      assert(P.coerce({ sample_rate: 4000 }).sample_rate === 4000, "4 kHz rejected");
      assert(P.coerce({ sample_rate: 3999 }).sample_rate === 44100, "below range should fall back");
      assert(P.coerce({ sample_rate: 100000 }).sample_rate === 44100, "above range should fall back");
      return "range enforced";
    });

    check("switches coerce to 0 or 1 and default on", function () {
      var p = P.coerce({ p_dc_block: 0.7, p_wave_trim: -3 });
      assert(p.p_dc_block === 1, "0.7 should round to ON");
      assert(p.p_wave_trim === 0, "a negative value should clamp to OFF");
      var d = P.defaults(1);
      assert(d.p_dc_block === 1 && d.p_wave_trim === 1, "switches should default ON");
      return "ON/OFF coercion correct";
    });

    check("decode rejects junk", function () {
      assert(C.decode("") === null, "empty string should fail");
      assert(C.decode("!!!not-base64!!!") === null, "junk should fail");
      return "junk rejected";
    });

    check("coerce clamps out-of-range input", function () {
      var p = P.coerce({
        p_env_attack: 5,
        p_freq_ramp: -9,
        wave_type: 9,
        sample_rate: 200,
        sample_size: 32,
        sound_vol: 4,
        noise_seed: -1
      });
      assert(p.p_env_attack === 1, "attack not clamped");
      assert(p.p_freq_ramp === -1, "signed value not clamped");
      assert(p.wave_type === 3, "wave type not clamped");
      assert(p.sample_rate === 44100, "out-of-range sample rate not replaced");
      assert(p.sample_size === 8, "sample size not validated");
      assert(p.sound_vol === 1, "volume not clamped");
      assert(p.noise_seed === 4294967295, "seed not masked");
      return "all clamps applied";
    });

    check("coerce fills defaults for missing keys", function () {
      var p = P.coerce({ wave_type: 2 });
      var d = P.defaults(0);
      var keys = P.ORDER;
      for (i = 0; i < keys.length; i++) {
        if (keys[i] === "wave_type") { continue; }
        assert(p[keys[i]] === d[keys[i]], "default missing for " + keys[i]);
      }
      assert(p.wave_type === 2, "explicit wave_type was not kept");
      return "defaults restored";
    });

    check("every slider has a readable value", function () {
      var p = G.make("laserShoot", 21);
      for (i = 0; i < P.DEFS.length; i++) {
        if (P.DEFS[i].type === "wave") { continue; }
        var text = P.format(P.DEFS[i].key, p);
        assert(typeof text === "string" && text.length > 0, "no readout for " + P.DEFS[i].key);
        assert(text.indexOf("NaN") === -1, "NaN readout for " + P.DEFS[i].key + ": " + text);
        assert(text.indexOf("undefined") === -1, "undefined readout for " + P.DEFS[i].key);
      }
      return (P.DEFS.length - 1) + " readouts OK";
    });

    check("slider <-> value mapping round-trips", function () {
      var d, v;
      for (i = 0; i < P.DEFS.length; i++) {
        d = P.DEFS[i];
        if (d.type === "wave") { continue; }
        for (j = 0; j <= 10; j++) {
          v = d.min + (d.max - d.min) * (j / 10);
          approx(UI.fromSlider(d, UI.toSlider(d, v)), v, 0.02, d.key + " mapping drift");
        }
      }
      return "all knobs map cleanly";
    });

    check("mutate keeps values valid and changes the sound", function () {
      var p = G.make("pickupCoin", 31337);
      var m = G.mutate(p, 999);
      var keys = P.ORDER;
      for (i = 0; i < keys.length; i++) {
        assert(typeof m[keys[i]] === "number" && isFinite(m[keys[i]]),
          "mutate produced a bad " + keys[i]);
      }
      assert(m.p_env_attack >= 0 && m.p_env_attack <= 1, "mutate left the valid range");
      assert(S.render(p).float[100] !== S.render(m).float[100],
        "mutation had no audible effect");
      return "values valid, sound changed";
    });

    check("render respects the 4 second cap", function () {
      var p = P.defaults(4);
      p.p_env_attack = 1;
      p.p_env_sustain = 1;
      p.p_env_decay = 1;
      var r = S.render(p);
      assert(r.duration <= S.MAX_SECONDS + 0.001, "cap not applied");
      return r.duration.toFixed(2) + " s (cap " + S.MAX_SECONDS + " s)";
    });

    check("durations are independent of sample rate", function () {
      var p = G.make("laserShoot", 55);
      var r44 = S.render(p);
      var p8 = P.clone(p);
      p8.sample_rate = 8000;
      var r8 = S.render(p8);
      approx(r8.duration, r44.duration, 0.005, "duration changed with sample rate");
      var wav = W.encode(S.quantize(r8.float, 8, {}).pcm, { sampleRate: 8000, bits: 8 });
      var v = new DataView(wav.buffer);
      assert(v.getUint32(40, true) === r8.frames, "WAV data size mismatch");
      assert(v.getUint32(24, true) === 8000, "WAV rate mismatch");
      return r8.frames + " frames @ 8 kHz = " + r8.duration.toFixed(3) + " s";
    });

    check("parameter panel builds and syncs every control", function () {
      var doc = root.document;
      var host = doc.createElement("div");
      var last = null;
      var built = UI.buildParams(host, {
        onInput: function (key, value) { last = { key: key, value: value }; },
        onCommit: function () {}
      });

      var inputs = host.getElementsByTagName("input");
      var byId = {};
      var ranges = 0, radios = 0, toggles = 0, n;
      for (n = 0; n < inputs.length; n++) {
        byId[inputs[n].id] = inputs[n];
        if (inputs[n].type === "range") { ranges++; }
        if (inputs[n].type === "radio") { radios++; }
        if (inputs[n].type === "checkbox") { toggles++; }
      }
      assert(ranges === 23, "expected 23 sliders, got " + ranges);
      assert(radios === 4, "expected 4 waveform radios, got " + radios);
      assert(toggles === 2, "expected 2 switches, got " + toggles);

      var p = G.make("tone", 1);
      built.sync(p);
      assert(byId["wave-2"].checked, "sine radio not selected by sync()");
      assert(byId["p-p_base_freq"].value !== "", "slider was not positioned");

      var outputs = host.getElementsByTagName("output");
      assert(outputs.length === 25, "expected 25 readouts, got " + outputs.length);
      assert(outputs[0].textContent.length > 0, "readout is empty");

      var slider = byId["p-p_base_freq"];
      slider.value = "1000";
      var ev = doc.createEvent("HTMLEvents");
      ev.initEvent("input", true, false);
      slider.dispatchEvent(ev);
      assert(last && last.key === "p_base_freq", "input event missed the handler");
      approx(last.value, 1, 1e-6, "slider max should map to 1");

      var groups = host.getElementsByTagName("details");
      assert(groups.length === P.GROUPS.length, "expected " + P.GROUPS.length + " groups");
      return ranges + " sliders, " + radios + " radios, " + groups.length + " groups";
    });

    check("render throughput (informational)", function () {
      var p = G.make("explosion", 9);
      p.p_env_sustain = 0.5;
      var now = function () {
        return (root.performance && root.performance.now) ? root.performance.now() : Date.now();
      };
      var started = now();
      var r = S.render(p);
      var elapsed = now() - started;
      assert(r.frames > 0, "render produced nothing");
      return r.frames + " frames in " + elapsed.toFixed(1) + " ms";
    });

    check("8 kHz output rate is exact", function () {
      var p = G.make("jump", 12);
      p.sample_rate = 8000;
      p.p_env_attack = 0;
      p.p_env_sustain = Math.sqrt(44100 / 100000);   /* exactly 1 s */
      p.p_env_decay = 0;
      var r = S.render(p);
      approx(r.duration, 1, 0.01, "1 s at 8 kHz");
      approx(r.frames, 8000, 20, "frame count at 8 kHz");
      var wav = W.encode(S.quantize(r.float, 8, { peak: r.peak }).pcm,
        { sampleRate: 8000, bits: 8 });
      assert(new DataView(wav.buffer).getUint32(24, true) === 8000, "header rate not 8000");
      return r.frames + " frames over " + r.duration.toFixed(3) + " s";
    });

    check("DC blocker removes pulse-wave offset", function () {
      var base = P.defaults(5);
      base.wave_type = 0;
      base.p_duty = 0.9;                  /* 5 % pulse: strong DC offset */
      base.p_env_attack = 0;
      base.p_env_sustain = Math.sqrt(0.6 * 44100 / 100000);
      base.p_env_decay = 0.1;
      base.p_env_punch = 1;               /* flat sustain keeps the mean simple */
      base.sound_vol = 0.7;

      var on = P.clone(base);
      on.p_dc_block = 1;
      var off = P.clone(base);
      off.p_dc_block = 0;

      var meanOn = meanOf(S.render(on).float, 0.2, 0.7);
      var meanOff = meanOf(S.render(off).float, 0.2, 0.7);
      assert(Math.abs(meanOff) > 0.1, "expected a DC offset when disabled, got " + meanOff);
      assert(Math.abs(meanOn) < 0.02, "DC blocker left an offset of " + meanOn);
      return "offset " + meanOff.toFixed(3) + " -> " + meanOn.toFixed(3);
    });

    check("decay-free sounds fade out instead of clicking", function () {
      var p = P.defaults(31);
      p.wave_type = 2;
      p.p_env_attack = 0;
      p.p_env_sustain = Math.sqrt(0.3 * 44100 / 100000);
      p.p_env_decay = 0;              /* ends at full level without the fade */
      p.p_base_freq = 0.4;
      p.sound_vol = 0.5;
      var r = S.render(p);
      var n = r.frames;
      var last = Math.abs(r.float[n - 1]);
      var prev = Math.abs(r.float[n - 2]);
      assert(last <= prev + 0.01, "tail does not ramp down (" + prev + " -> " + last + ")");
      assert(last < 0.02 * r.peak, "last sample is still loud: " + last);
      return "tail " + prev.toFixed(4) + " -> " + last.toFixed(4);
    });

    check("a natural decay tail is left untouched", function () {
      var p = P.defaults(32);
      p.wave_type = 0;
      p.p_env_attack = 0;
      p.p_env_sustain = Math.sqrt(0.2 * 44100 / 100000);
      p.p_env_decay = 0.5;
      var r = S.render(p);
      var n = r.frames;
      var last = Math.abs(r.float[n - 1]);
      assert(last < 0.02 * r.peak, "decaying sound should already end near zero");
      return "tail " + last.toExponential(2);
    });

    check("DC blocker also works on short sounds", function () {
      var p = P.defaults(41);
      p.wave_type = 0;
      p.p_duty = 0.9;
      p.p_env_attack = 0;
      p.p_env_sustain = Math.sqrt(0.05 * 44100 / 100000);   /* 50 ms blip */
      p.p_env_decay = 0;
      p.p_env_punch = 1;
      p.sound_vol = 0.7;

      var on = P.clone(p);
      on.p_dc_block = 1;
      var off = P.clone(p);
      off.p_dc_block = 0;

      var meanOn = meanOf(S.render(on).float, 0.1, 0.9);
      var meanOff = meanOf(S.render(off).float, 0.1, 0.9);
      assert(Math.abs(meanOff) > 0.05, "expected an offset when disabled, got " + meanOff);
      /* a 50 ms sound can only partly settle a 25 Hz blocker, so compare the two */
      assert(Math.abs(meanOn) < Math.abs(meanOff) * 0.35,
        "short sound keeps too much DC (" + meanOn + " vs " + meanOff + ")");
      return meanOff.toFixed(3) + " -> " + meanOn.toFixed(3);
    });

    check("waveform levelling evens out the peaks", function () {
      var base = P.defaults(8);
      base.p_env_attack = 0;
      base.p_env_sustain = Math.sqrt(0.3 * 44100 / 100000);
      base.p_env_decay = 0;
      base.p_env_punch = 1;
      base.p_base_freq = 0.5;
      base.sound_vol = 0.5;

      var square = P.clone(base);
      square.wave_type = 0;
      var sawTrim = P.clone(base);
      sawTrim.wave_type = 1;
      var sawRaw = P.clone(sawTrim);
      sawRaw.p_wave_trim = 0;

      var peakSquare = S.render(square).peak;
      var peakTrim = S.render(sawTrim).peak;
      var peakRaw = S.render(sawRaw).peak;

      approx(peakTrim, peakSquare, peakSquare * 0.1, "levelled saw should match the square");
      assert(peakRaw > peakTrim * 1.6, "unlevelled saw should be about twice as loud");
      return "square " + peakSquare.toFixed(3) + " / saw " + peakTrim.toFixed(3) +
        " (unlevelled " + peakRaw.toFixed(3) + ")";
    });

    check("reduced oversampling keeps duration", function () {
      var p = G.make("laserShoot", 77);
      var full = S.render(p);
      var fast = S.render(p, { oversampling: 2 });
      approx(fast.duration, full.duration, 0.01, "duration changed with oversampling");
      assert(fast.oversampling === 2, "oversampling not reported");
      assert(fast.peak > 0, "fast render is silent");
      return full.frames + " vs " + fast.frames + " frames";
    });

    check("fuzz: 120 random parameter sets stay finite", function () {
      var rnd = root.SFX.rng.make(20240101);
      var bad = 0, total = 0, n, j, d, p, r, q;
      for (n = 0; n < 120; n++) {
        p = P.defaults(rnd.int(0x7fffffff));
        for (j = 0; j < P.DEFS.length; j++) {
          d = P.DEFS[j];
          if (d.type === "wave") { p.wave_type = rnd.int(3); }
          else if (d.type === "switch") { p[d.key] = rnd.int(1); }
          else { p[d.key] = d.min + (d.max - d.min) * rnd.next(); }
        }
        /* short envelopes keep the fuzz fast while still exercising every filter */
        p.p_env_attack = rnd.next() * 0.3;
        p.p_env_sustain = rnd.next() * 0.3;
        p.p_env_decay = rnd.next() * 0.3;
        p.sample_rate = P.RATES[rnd.int(3)];
        p.sample_size = rnd.int(1) ? 16 : 8;

        r = S.render(p);
        total += r.frames;
        if (!(r.frames > 0) || !isFinite(r.peak) || r.peak > 20) { bad++; continue; }
        for (q = 0; q < r.frames; q += 89) {
          if (!isFinite(r.float[q])) { bad++; break; }
        }
      }
      assert(bad === 0, bad + " of 120 random sounds produced bad output");
      return "120 randomised sounds, " + total + " frames";
    });

    check("WAV export helpers produce complete files", function () {
      var pcm = new Uint8Array(1000);
      for (i = 0; i < pcm.length; i++) { pcm[i] = i & 0xff; }
      var wav = W.encode(pcm, { sampleRate: 8000, bits: 8 });

      var blob = W.toBlob(wav);
      assert(blob.size === wav.byteLength, "blob size mismatch");

      var uri = W.toDataURI(wav);
      assert(uri.indexOf("data:audio/wav;base64,") === 0, "wrong data URI header");
      var decoded = atob(uri.substring(uri.indexOf(",") + 1));
      assert(decoded.length === wav.byteLength,
        "data URI length mismatch (" + decoded.length + " vs " + wav.byteLength + ")");
      assert(decoded.charCodeAt(0) === 82 && decoded.charCodeAt(1) === 73,
        "data URI does not start with RIFF");
      assert(decoded.charCodeAt(44) === pcm[0], "first sample byte changed in transit");
      assert(decoded.charCodeAt(44 + 500) === pcm[500], "middle sample byte changed in transit");
      assert(decoded.charCodeAt(44 + 999) === pcm[999], "last sample byte changed in transit");
      return decoded.length + " bytes round-tripped";
    });

    check("ZIP writer: CRC-32 and archive structure", function () {
      var nine = [0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39];
      assert(Z.crc32(nine) === 0xCBF43926, "CRC-32 check value wrong");

      var a = new Uint8Array([1, 2, 3, 4, 5]);
      var b = new Uint8Array([9, 9, 9]);
      var zip = Z.create([{ name: "a.wav", data: a }, { name: "b.wav", data: b }]);
      var v = new DataView(zip.buffer);

      assert(v.getUint32(0, true) === 0x04034b50, "missing local header");
      assert(v.getUint16(8, true) === 0, "method should be store");
      assert(v.getUint32(14, true) === Z.crc32(a), "local CRC mismatch");
      assert(v.getUint32(18, true) === a.length, "local size mismatch");
      assert(v.getUint16(26, true) === 5, "name length wrong");

      var eocd = zip.length - 22;
      assert(v.getUint32(eocd, true) === 0x06054b50, "missing EOCD");
      assert(v.getUint16(eocd + 8, true) === 2, "wrong entry count");
      var cdSize = v.getUint32(eocd + 12, true);
      var cdOffset = v.getUint32(eocd + 16, true);
      assert(v.getUint32(cdOffset, true) === 0x02014b50, "missing central record");
      assert(cdOffset + cdSize === eocd, "central directory size mismatch");

      var secondCd = cdOffset + 46 + 5;                  /* 46-byte record + "a.wav" */
      assert(v.getUint32(secondCd, true) === 0x02014b50, "second central record missing");
      var secondLocal = v.getUint32(secondCd + 42, true);
      assert(v.getUint32(secondLocal, true) === 0x04034b50, "second local header misplaced");
      return zip.length + " bytes, 2 stored entries";
    });

    check("bank persists entries and honours its cap", function () {
      var memory = {
        data: {},
        getItem: function (key) { return this.data[key] === undefined ? null : this.data[key]; },
        setItem: function (key, value) { this.data[key] = String(value); },
        removeItem: function (key) { delete this.data[key]; }
      };
      B.useStorage(memory);
      B.clear();

      var p = G.make("pickupCoin", 5);
      var e1 = B.add(p, "one");
      var e2 = B.add(p, "two");
      assert(e1 && e2, "add failed");

      var list = B.all();
      assert(list.length === 2, "expected 2 entries, got " + list.length);
      assert(list[0].name === "two", "newest entry should be first");
      assert(list[0].params.p_base_freq === p.p_base_freq, "params not stored verbatim");
      assert(list[0].params.p_dc_block === p.p_dc_block, "switch not stored");

      var n;
      for (n = 0; n < B.LIMIT + 6; n++) { B.add(p, "bulk " + n); }
      assert(B.all().length === B.LIMIT, "cap not applied: " + B.all().length);

      var first = B.all()[0];
      B.remove(first.id);
      assert(B.all().length === B.LIMIT - 1, "remove failed");

      B.clear();
      assert(B.all().length === 0, "clear failed");
      B.useStorage(null);
      return "cap of " + B.LIMIT + " honoured";
    });

    check("export helper returns a valid WAV", function () {
      var p = G.make("explosion", 12);
      p.sample_rate = 22050;
      p.sample_size = 16;

      var out = root.SFX.exporter.toWav(p, { normalize: true });
      var v = new DataView(out.bytes.buffer);

      assert(v.getUint32(0, true) === 0x46464952, "not a RIFF file");
      assert(v.getUint32(24, true) === 22050, "wrong rate");
      assert(v.getUint16(34, true) === 16, "wrong depth");
      assert(v.getUint32(40, true) === out.frames * 2, "data size mismatch");
      assert(out.clipped === 0, "normalised export should not clip");
      assert(out.bits === 16 && out.sampleRate === 22050, "metadata mismatch");
      approx(out.duration, out.frames / 22050, 1e-9, "duration mismatch");
      return out.byteLength + " bytes";
    });

    var failed = 0;
    for (k = 0; k < results.length; k++) { if (!results[k].ok) { failed++; } }
    return { results: results, passed: results.length - failed, failed: failed };
  }

  return { run: run, results: function () { return results; } };
}));
