/* 8bitFX — seeded RNG (deterministic noise + reproducible random sounds).
   Plain ES5, no dependencies: runs in any browser and in the headless harness. */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.SFX = root.SFX || {};
  root.SFX.rng = api;
}(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this), function () {
  "use strict";

  // 32-bit integer multiply without Math.imul (IE11 / old engines).
  var imul = Math.imul || function (a, b) {
    var ah = (a >>> 16) & 0xffff, al = a & 0xffff;
    var bh = (b >>> 16) & 0xffff, bl = b & 0xffff;
    return ((al * bl) + (((ah * bl + al * bh) << 16) >>> 0)) | 0;
  };

  /* mulberry32: tiny, fast, well-distributed 32-bit PRNG. */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = imul(a ^ (a >>> 15), 1 | a);
      t = (t + imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Wrap a PRNG with the helpers the generators need. */
  function make(seed) {
    var next = mulberry32(seed);
    return {
      seed: seed >>> 0,
      next: next,
      /* float in [min, max) */
      range: function (min, max) { return min + next() * (max - min); },
      /* integer in [0, max] (inclusive) */
      int: function (max) { return Math.floor(next() * (max + 1)); },
      pick: function (list) { return list[Math.floor(next() * list.length)]; },
      chance: function (p) { return next() < p; }
    };
  }

  function newSeed() {
    return (Math.random() * 0x100000000) >>> 0;
  }

  return { mulberry32: mulberry32, make: make, newSeed: newSeed };
}));
