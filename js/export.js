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

  /* options: { normalize: bool } */
  function toWav(params, options) {
    options = options || {};
    var p = root.SFX.params.coerce(params);
    var rendered = root.SFX.synth.render(p);
    var quantized = root.SFX.synth.quantize(rendered.float, p.sample_size, {
      normalize: !!options.normalize,
      peak: rendered.peak
    });
    var wav = root.SFX.wav.encode(quantized.pcm, {
      sampleRate: p.sample_rate,
      bits: p.sample_size
    });

    return {
      bytes: new Uint8Array(wav.buffer),
      byteLength: wav.byteLength,
      frames: quantized.frames,
      clipped: quantized.clipped,
      duration: rendered.duration,
      sampleRate: p.sample_rate,
      bits: p.sample_size
    };
  }

  return { toWav: toWav };
}));
