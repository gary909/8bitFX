/* 8bitFX — mixes the rendered sections into one buffer.
   Sections are independent renders; the mix is their sum scaled by 1/n so a single
   enabled section is exactly as loud as it was before layering existed. */
(function (root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.SFX = root.SFX || {};
  root.SFX.mix = api;
}(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this), function (root) {
  "use strict";

  /* renders: render() results (nulls allowed for disabled sections)
     enabled: per-section booleans
     -> { float, frames, peak, duration, count, sampleRate } */
  function combine(renders, enabled) {
    var i, j, count = 0, frames = 0, rate = 44100;

    for (i = 0; i < renders.length; i++) {
      if (enabled && !enabled[i]) { continue; }
      if (!renders[i] || !renders[i].frames) { continue; }
      count++;
      if (renders[i].frames > frames) { frames = renders[i].frames; }
    }

    if (!count || !frames) {
      return { float: new Float32Array(0), frames: 0, peak: 0, duration: 0, count: 0, sampleRate: rate };
    }

    var out = new Float32Array(frames), v;

    for (i = 0; i < renders.length; i++) {
      if (enabled && !enabled[i]) { continue; }
      if (!renders[i] || !renders[i].frames) { continue; }
      rate = renders[i].sampleRate || rate;
      for (j = 0; j < renders[i].frames; j++) { out[j] += renders[i].float[j]; }
    }

    /* 1/n keeps the level of a single section unchanged and stops three
       full-scale layers from slamming into the quantiser */
    var gain = 1 / count;
    var peak = 0;
    for (j = 0; j < frames; j++) {
      v = out[j] * gain;
      out[j] = v;
      if (v < 0) { v = -v; }
      if (v > peak) { peak = v; }
    }

    return {
      float: out,
      frames: frames,
      peak: peak,
      duration: frames / rate,
      count: count,
      sampleRate: rate
    };
  }

  return { combine: combine };
}));
