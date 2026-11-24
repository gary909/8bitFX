/* 8bitFX — parameters to WAV bytes in one call.
   Used by the single-sound export, the pack export and the app self-test. */
(function (root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.SFX = root.SFX || {};
  root.SFX.exporter = api;
}(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this), function (root) {
  "use strict";

  function packageWav(float, sampleRate, bits, peak, options) {
    var quantized = root.SFX.synth.quantize(float, bits, {
      normalize: !!options.normalize,
      peak: peak
    });
    var wav = root.SFX.wav.encode(quantized.pcm, { sampleRate: sampleRate, bits: bits });

    return {
      bytes: new Uint8Array(wav.buffer),
      byteLength: wav.byteLength,
      frames: quantized.frames,
      clipped: quantized.clipped,
      duration: sampleRate ? quantized.frames / sampleRate : 0,
      sampleRate: sampleRate,
      bits: bits
    };
  }

  /* options: { normalize: bool } */
  function toWav(params, options) {
    options = options || {};
    var p = root.SFX.params.coerce(params);
    var rendered = root.SFX.synth.render(p);
    return packageWav(rendered.float, p.sample_rate, p.sample_size, rendered.peak, options);
  }

  /* patch = { sections: [...], enabled: [...] } — the audio the master Play makes */
  function renderPatch(patch, options) {
    var api = root.SFX.params;
    var sections = (patch && patch.sections) || [];
    var enabled = (patch && patch.enabled) || [true, false, false];
    var renders = [], base = null, i, p;

    for (i = 0; i < 3; i++) {
      p = api.coerce(sections[i] || api.defaults(0));
      if (!base) { base = p; }
      renders.push(enabled[i] ? root.SFX.synth.render(p, options) : null);
    }

    return { mixed: root.SFX.mix.combine(renders, enabled), params: base };
  }

  function toWavPatch(patch, options) {
    options = options || {};
    var rendered = renderPatch(patch, { oversampling: options.oversampling });

    return packageWav(rendered.mixed.float, rendered.params.sample_rate,
      rendered.params.sample_size, rendered.mixed.peak, options);
  }

  return { toWav: toWav, toWavPatch: toWavPatch, renderPatch: renderPatch };
}));
