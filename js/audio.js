/* 8bitFX — Web Audio playback.
   Plays the quantised PCM (dequantised back to float) so the preview sounds
   exactly like the exported WAV, grit included. */
(function (root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.SFX = root.SFX || {};
  root.SFX.audio = api;
}(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this), function (root) {
  "use strict";

  var ctx = null;
  var master = null;
  var current = null;
  var volume = 1;

  function isSupported() {
    return !!(root.AudioContext || root.webkitAudioContext);
  }

  function ensure() {
    if (!ctx) {
      var Ctor = root.AudioContext || root.webkitAudioContext;
      if (!Ctor) { return null; }
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended" && typeof ctx.resume === "function") { ctx.resume(); }
    return ctx;
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(2, v));
    if (master) { master.gain.value = volume; }
  }

  function stop() {
    if (current) {
      try { current.stop(); } catch (e) { /* already stopped */ }
      current = null;
    }
  }

  /* samples: Float32Array in [-1,1]; sampleRate: Hz */
  function play(samples, sampleRate, gain) {
    var c = ensure();
    if (!c || !samples || !samples.length) { return false; }
    stop();

    var buffer = c.createBuffer(1, samples.length, sampleRate);
    if (typeof buffer.copyToChannel === "function") {
      buffer.copyToChannel(samples, 0);
    } else {
      buffer.getChannelData(0).set(samples);
    }

    var src = c.createBufferSource();
    src.buffer = buffer;

    var g = c.createGain();
    g.gain.value = (typeof gain === "number") ? gain : 1;

    src.connect(g);
    g.connect(master);
    src.start(0);
    current = src;
    src.onended = function () { if (current === src) { current = null; } };
    return true;
  }

  return {
    play: play,
    stop: stop,
    setVolume: setVolume,
    isSupported: isSupported,
    context: function () { return ctx; }
  };
}));
