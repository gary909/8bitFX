/* 8bitFX — parameter model.
   Every synthesis knob lives here, in sfxr's units (0..1, or -1..1 for signed
   parameters). This file is the single source of truth for slider ranges,
   defaults, display units AND the UI-value → DSP-value mapping used by synth.js. */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.SFX = root.SFX || {};
  root.SFX.params = api;
}(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this), function () {
  "use strict";

  function sq(x) { return x * x; }
  function cube(x) { return x * x * x; }
  function sign(x) { return x < 0 ? -1 : 1; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* ---------- display helpers ---------- */
  function hz(v) {
    var r = Math.round(v);
    return r > 20000 ? ">20 kHz" : (r + " Hz");
  }
  function ms(s) { return s < 0.0005 ? "0 ms" : (s < 0.1 ? (s * 1000).toFixed(1) : Math.round(s * 1000) + "") + " ms"; }
  function pct(v) { return Math.round(v * 100) + "%"; }
  function sgnUnit(v, digits, unit) {
    if (Math.abs(v) < 1e-9) { return "OFF"; }
    return (v > 0 ? "+" : "\u2212") + Math.abs(v).toFixed(digits) + " " + unit;
  }

  var RATES = [44100, 22050, 11025, 8000];
  var RATE_MIN = 4000;
  var RATE_MAX = 96000;

  /* the LPF cutoff slider counts as "off" at the very top of its range */
  var LPF_OFF_THRESHOLD = 0.9999;

  /* ---------- parameter definitions ---------- */
  var DEFS = [
    { key: "wave_type", group: "Waveform", label: "Waveform", type: "wave" },

    { key: "p_env_attack", group: "Envelope", label: "Attack", def: 0, curve: 2,
      fmt: function (k) { return ms(k.attack); } },
    { key: "p_env_sustain", group: "Envelope", label: "Sustain", def: 0.3, curve: 2,
      fmt: function (k) { return ms(k.sustain); } },
    { key: "p_env_punch", group: "Envelope", label: "Punch", def: 0,
      fmt: function (k) { return pct(k.punch); } },
    { key: "p_env_decay", group: "Envelope", label: "Decay", def: 0.4, curve: 2,
      fmt: function (k) { return ms(k.decay); } },

    { key: "p_base_freq", group: "Tone", label: "Start frequency", def: 0.3, curve: 2,
      fmt: function (k) { return hz(k.freq); } },
    { key: "p_freq_limit", group: "Tone", label: "Min frequency", def: 0, curve: 2,
      fmt: function (k) { return k.freqLimitOn ? hz(k.freqMin) : "OFF"; } },
    { key: "p_freq_ramp", group: "Tone", label: "Slide", def: 0, signed: true,
      fmt: function (k) { return sgnUnit(k.freqSlideOct, 2, "oct/s"); } },
    { key: "p_freq_dramp", group: "Tone", label: "Delta slide", def: 0, signed: true,
      fmt: function (k, p) { return sgnUnit(p.p_freq_dramp * 100, 0, "%"); } },

    { key: "p_vib_strength", group: "Vibrato", label: "Depth", def: 0,
      fmt: function (k) { return k.vibDepth === 0 ? "OFF" : pct(k.vibDepth); } },
    { key: "p_vib_speed", group: "Vibrato", label: "Speed", def: 0,
      fmt: function (k) { return (k.vibHz === 0 || k.vibDepth === 0) ? "OFF" : hz(k.vibHz); } },

    { key: "p_arp_mod", group: "Arpeggio", label: "Change", def: 0, signed: true,
      fmt: function (k) { return k.arpMult === 1 ? "OFF" : (12 * Math.log(1 / k.arpMult) / Math.LN2).toFixed(1) + " st"; } },
    { key: "p_arp_speed", group: "Arpeggio", label: "Speed", def: 0,
      fmt: function (k, p) { return (p.p_arp_mod === 0 || p.p_arp_speed === 1) ? "OFF" : ms(k.arpSeconds); } },

    { key: "p_duty", group: "Duty", label: "Duty cycle", def: 0,
      fmt: function (k) { return pct(k.duty); } },
    { key: "p_duty_ramp", group: "Duty", label: "Duty sweep", def: 0, signed: true,
      fmt: function (k) { return sgnUnit(k.dutySweep, 0, "%/s"); } },

    { key: "p_repeat_speed", group: "Retrigger", label: "Retrigger rate", def: 0,
      fmt: function (k) { return k.retriggerHz === 0 ? "OFF" : hz(k.retriggerHz); } },

    { key: "p_pha_offset", group: "Flanger", label: "Offset", def: 0, signed: true,
      fmt: function (k) { return k.flangerOffset === 0 ? "OFF" : ms(Math.abs(k.flangerOffset)); } },
    { key: "p_pha_ramp", group: "Flanger", label: "Sweep", def: 0, signed: true,
      fmt: function (k) { return sgnUnit(k.flangerSweep * 1000, 0, "ms/s"); } },

    { key: "p_lpf_freq", group: "Filters", label: "Low-pass cutoff", def: 1,
      fmt: function (k) { return k.lpfOn ? hz(k.lpfHz) : "OFF"; } },
    { key: "p_lpf_ramp", group: "Filters", label: "Low-pass sweep", def: 0, signed: true,
      fmt: function (k) { return k.lpfSweep === 1 ? "OFF" : k.lpfSweep.toFixed(2) + "\u00D7/s"; } },
    { key: "p_lpf_resonance", group: "Filters", label: "Resonance", def: 0,
      fmt: function (k) { return k.res === 0 ? "OFF" : pct(k.res); } },
    { key: "p_hpf_freq", group: "Filters", label: "High-pass cutoff", def: 0,
      fmt: function (k) { return k.hpfHz < 1 ? "OFF" : hz(k.hpfHz); } },
    { key: "p_hpf_ramp", group: "Filters", label: "High-pass sweep", def: 0, signed: true,
      fmt: function (k) { return k.hpfSweep === 1 ? "OFF" : k.hpfSweep.toFixed(2) + "\u00D7/s"; } },

    { key: "sound_vol", group: "Output", label: "Gain", def: 0.25,
      fmt: function (k) { return k.gain <= 1e-6 ? "mute" : (20 * Math.log(k.gain) / Math.LN10).toFixed(1) + " dB"; } },
    { key: "p_dc_block", group: "Output", label: "DC blocker", def: 1, type: "switch",
      fmt: function (k, p) { return p.p_dc_block ? "ON" : "OFF"; } },
    { key: "p_wave_trim", group: "Output", label: "Level waveforms", def: 1, type: "switch",
      fmt: function (k, p) { return p.p_wave_trim ? "ON" : "OFF"; } }
  ];

  /* ---------- definitions index + defaults ---------- */
  var EXTRA_DEFAULTS = { sound_vol: 0.25, sample_rate: 44100, sample_size: 8, noise_seed: 0 };

  var BY_KEY = {};
  var GROUPS = [];
  (function () {
    for (var i = 0; i < DEFS.length; i++) {
      var d = DEFS[i];
      if (!d.group) { d.group = "Other"; }
      BY_KEY[d.key] = d;
      if (GROUPS.indexOf(d.group) === -1) { GROUPS.push(d.group); }
      if (d.type !== "wave") {
        d.min = d.signed ? -1 : 0;
        d.max = 1;
        if (typeof d.curve !== "number") { d.curve = 1; }
      }
    }
  }());

  function defaults(seed) {
    var p = {}, i, d;
    for (i = 0; i < DEFS.length; i++) {
      d = DEFS[i];
      if (d.type !== "wave") { p[d.key] = d.def; }
    }
    p.wave_type = 0;
    p.sound_vol = EXTRA_DEFAULTS.sound_vol;
    p.sample_rate = EXTRA_DEFAULTS.sample_rate;
    p.sample_size = EXTRA_DEFAULTS.sample_size;
    p.noise_seed = (typeof seed === "number" ? seed : 0) >>> 0;
    return p;
  }

  function clone(p) {
    var out = {}, key;
    for (key in p) { if (p.hasOwnProperty(key)) { out[key] = p[key]; } }
    return out;
  }

  /* Clamp / repair an arbitrary object into a valid parameter set. */
  function coerce(src) {
    var p = defaults(0), i, d, v;
    if (!src || typeof src !== "object") { return p; }
    for (i = 0; i < DEFS.length; i++) {
      d = DEFS[i];
      v = src[d.key];
      if (d.type === "wave") {
        v = Math.round(Number(v));
        p.wave_type = isFinite(v) ? (clamp(v, 0, 3) | 0) : 0;
      } else if (typeof v === "number" && isFinite(v)) {
        p[d.key] = clamp(v, d.min, d.max);
        if (d.type === "switch") { p[d.key] = (p[d.key] >= 0.5) ? 1 : 0; }
      }
    }
    if (typeof src.sound_vol === "number" && isFinite(src.sound_vol)) {
      p.sound_vol = clamp(src.sound_vol, 0, 1);
    }
    if (typeof src.sample_rate === "number" && isFinite(src.sample_rate) &&
        src.sample_rate >= RATE_MIN && src.sample_rate <= RATE_MAX) {
      p.sample_rate = Math.round(src.sample_rate);
    }
    p.sample_size = (src.sample_size === 16) ? 16 : 8;
    if (typeof src.noise_seed === "number" && isFinite(src.noise_seed)) {
      p.noise_seed = src.noise_seed >>> 0;
    }
    return p;
  }

  /* ---------- UI value -> DSP value mapping (mirrors sfxr's sliders) ---------- */
  /* Assumes p is already coerced — use toKnobs() when it may not be. */
  function toKnobsCoerced(p) {
    var k = {};

    k.waveType = p.wave_type | 0;

    k.attack = sq(p.p_env_attack) * 100000 / 44100;
    k.sustain = sq(p.p_env_sustain) * 100000 / 44100;
    k.decay = sq(p.p_env_decay) * 100000 / 44100;
    k.punch = p.p_env_punch;

    k.freq = 3528 * (sq(p.p_base_freq) + 0.001);
    k.freqLimitOn = p.p_freq_limit > 0;
    k.freqMin = 3528 * (sq(p.p_freq_limit) + 0.001);
    k.freqSlideOct = -44100 * Math.log(1 - Math.min(0.999999, cube(p.p_freq_ramp) / 100)) / Math.LN2;
    k.freqDramp = -cube(p.p_freq_dramp) * 0.000001;

    k.vibHz = 44100 * 10 / 64 * sq(p.p_vib_speed) / 100;
    k.vibDepth = p.p_vib_strength / 2;

    k.arpMult = p.p_arp_mod >= 0
      ? 1 / (1 - sq(p.p_arp_mod) * 0.9)
      : 1 / (1 + sq(p.p_arp_mod) * 10);
    k.arpSeconds = p.p_arp_speed === 1 ? 0 : (Math.floor(sq(1 - p.p_arp_speed) * 20000) + 32) / 44100;

    k.duty = (1 - p.p_duty) / 2;
    k.dutySweep = 8 * 44100 * (-p.p_duty_ramp) / 20000;

    k.retriggerHz = p.p_repeat_speed === 0
      ? 0
      : 44100 / (Math.floor(sq(1 - p.p_repeat_speed) * 20000) + 32);

    k.flangerOffset = sign(p.p_pha_offset) * sq(p.p_pha_offset) * 1020 / 44100;
    k.flangerSweep = sign(p.p_pha_ramp) * sq(p.p_pha_ramp);

    k.lpfOn = p.p_lpf_freq < LPF_OFF_THRESHOLD;
    var lx = cube(p.p_lpf_freq) / 10;
    k.lpfHz = k.lpfOn ? 352800 * (lx / Math.max(1e-6, 1 - lx)) : 0;
    k.lpfSweep = Math.pow(1 + p.p_lpf_ramp / 10000, 44100);
    k.res = p.p_lpf_resonance;

    var hy = sq(p.p_hpf_freq) / 10;
    k.hpfHz = 352800 * (hy / Math.max(1e-6, 1 - hy));
    k.hpfSweep = Math.pow(1 + p.p_hpf_ramp * 0.0003, 44100);

    k.gain = Math.exp(p.sound_vol) - 1;

    k.sampleRate = p.sample_rate;
    k.sampleSize = p.sample_size;
    return k;
  }

  function toKnobs(p) {
    return toKnobsCoerced(coerce(p));
  }

  /* ---------- display ---------- */
  function format(key, p, knobs) {
    var d = BY_KEY[key];
    if (!d || !d.fmt) { return ""; }
    return d.fmt(knobs || toKnobs(p), p);
  }

  /* ---------- serialisation ---------- */
  /* canonical key order (deduplicated: sound_vol is also a slider) */
  var ORDER = (function () {
    var list = [], seen = {}, extras = ["sound_vol", "sample_rate", "sample_size", "noise_seed"];
    var i;
    for (i = 0; i < DEFS.length; i++) {
      list.push(DEFS[i].key);
      seen[DEFS[i].key] = 1;
    }
    for (i = 0; i < extras.length; i++) {
      if (!seen[extras[i]]) { list.push(extras[i]); seen[extras[i]] = 1; }
    }
    return list;
  }());

  /* The v1 permalink payload (a JSON array, base64url) listed sound_vol twice and
     had no DC-block / wave-trim switches. Kept so old links still open. */
  var LEGACY_ORDER = ["wave_type", "p_env_attack", "p_env_sustain", "p_env_punch",
    "p_env_decay", "p_base_freq", "p_freq_limit", "p_freq_ramp", "p_freq_dramp",
    "p_vib_strength", "p_vib_speed", "p_arp_mod", "p_arp_speed", "p_duty",
    "p_duty_ramp", "p_repeat_speed", "p_pha_offset", "p_pha_ramp", "p_lpf_freq",
    "p_lpf_ramp", "p_lpf_resonance", "p_hpf_freq", "p_hpf_ramp", "sound_vol",
    "sound_vol", "sample_rate", "sample_size", "noise_seed"];

  /* numeric parameters carried in the v2 link — wave type, rate, depth, seed and
     the two switches travel separately (flags byte) */
  var LINK_KEYS = (function () {
    var out = [], i;
    var skip = {
      wave_type: 1, sample_rate: 1, sample_size: 1, noise_seed: 1,
      p_dc_block: 1, p_wave_trim: 1
    };
    for (i = 0; i < ORDER.length; i++) {
      if (!skip[ORDER[i]]) { out.push(ORDER[i]); }
    }
    return out;
  }());

  function serialize(p) {
    var out = {}, i;
    for (i = 0; i < ORDER.length; i++) { out[ORDER[i]] = p[ORDER[i]]; }
    return out;
  }

  /* Permalink encoding lives in js/codec.js; this file keeps the definitions,
     the UI→DSP mapping and the display formatting. */

  return {
    DEFS: DEFS,
    GROUPS: GROUPS,
    RATES: RATES,
    RATE_MIN: RATE_MIN,
    RATE_MAX: RATE_MAX,
    ORDER: ORDER,
    LEGACY_ORDER: LEGACY_ORDER,
    LINK_KEYS: LINK_KEYS,
    byKey: BY_KEY,
    defaults: defaults,
    clone: clone,
    coerce: coerce,
    toKnobs: toKnobs,
    toKnobsCoerced: toKnobsCoerced,
    format: format,
    serialize: serialize
  };
}));



