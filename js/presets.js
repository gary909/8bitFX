/* 8bitFX — preset generators and mutation.
   Heuristics follow sfxr's own randomisers so each category sounds like the
   genre it promises (lasers sweep down, power-ups climb, explosions roar). */
(function (root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.SFX = root.SFX || {};
  root.SFX.presets = api;
}(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this), function (root) {
  "use strict";

  function P() { return root.SFX.params; }

  var GENERATORS = {
    pickupCoin: function (r, p) {
      p.wave_type = 0;
      p.p_base_freq = 0.4 + r.range(0, 0.5);
      p.p_env_attack = 0;
      p.p_env_sustain = r.range(0, 0.1);
      p.p_env_decay = 0.1 + r.range(0, 0.4);
      p.p_env_punch = 0.3 + r.range(0, 0.3);
      if (r.chance(0.5)) {
        p.p_arp_speed = 0.5 + r.range(0, 0.2);
        p.p_arp_mod = 0.2 + r.range(0, 0.4);
      }
    },

    laserShoot: function (r, p) {
      p.wave_type = r.chance(0.5) ? 1 : 0;
      if (r.chance(0.5)) {
        p.p_base_freq = 0.5 + r.range(0, 0.5);
        p.p_freq_limit = p.p_base_freq - 0.2 - r.range(0, 0.6);
        if (p.p_freq_limit < 0.2) { p.p_freq_limit = 0.2; }
      } else {
        p.p_base_freq = 0.3 + r.range(0, 0.6);
        p.p_freq_limit = r.range(0, 0.1);
      }
      p.p_freq_ramp = -0.15 - r.range(0, 0.2);
      if (r.chance(0.5)) {
        p.p_duty = r.range(0, 0.5);
        p.p_duty_ramp = r.range(0, 0.2);
      } else {
        p.p_duty = 0.4 + r.range(0, 0.5);
        p.p_duty_ramp = -r.range(0, 0.7);
      }
      p.p_env_attack = 0;
      p.p_env_sustain = 0.1 + r.range(0, 0.2);
      p.p_env_decay = r.range(0, 0.4);
      if (r.chance(0.5)) { p.p_env_punch = r.range(0, 0.3); }
      p.p_pha_offset = r.range(0, 0.2);
      p.p_pha_ramp = -r.range(0, 0.2);
      p.p_hpf_freq = r.range(0, 0.3);
    },

    explosion: function (r, p) {
      p.wave_type = 3;
      if (r.chance(0.5)) {
        p.p_base_freq = 0.1 + r.range(0, 0.4);
        p.p_freq_ramp = -0.1 + r.range(0, 0.4);
      } else {
        p.p_base_freq = 0.2 + r.range(0, 0.7);
        p.p_freq_ramp = -0.2 - r.range(0, 0.2);
      }
      if (r.chance(0.25)) { p.p_freq_ramp = 0; }
      p.p_env_attack = 0;
      p.p_env_sustain = 0.1 + r.range(0, 0.3);
      p.p_env_decay = 0.1 + r.range(0, 0.5);
      p.p_env_punch = 0.2 + r.range(0, 0.6);
      if (r.chance(0.5)) {
        p.p_pha_offset = -0.3 + r.range(0, 0.9);
        p.p_pha_ramp = -r.range(0, 0.3);
      }
      p.p_vib_strength = r.range(0, 0.7);
      p.p_vib_speed = r.range(0, 0.6);
      p.p_lpf_freq = 0.4 + r.range(0, 0.45);
      p.p_lpf_resonance = r.range(0, 0.6);
    },

    powerUp: function (r, p) {
      p.wave_type = r.chance(0.5) ? 0 : 1;
      p.p_duty = r.range(0, 0.6);
      p.p_base_freq = 0.2 + r.range(0, 0.3);
      if (r.chance(0.5)) {
        p.p_freq_ramp = 0.1 + r.range(0, 0.4);
        p.p_repeat_speed = 0.4 + r.range(0, 0.4);
      } else {
        p.p_freq_ramp = 0.05 + r.range(0, 0.3);
        p.p_repeat_speed = 0.7 - r.range(0, 0.5);
      }
      p.p_env_attack = 0;
      p.p_env_sustain = r.range(0, 0.4);
      p.p_env_decay = 0.1 + r.range(0, 0.4);
    },

    hitHurt: function (r, p) {
      p.wave_type = r.chance(0.6) ? 0 : 1;
      if (r.chance(0.5)) {
        p.p_base_freq = 0.2 + r.range(0, 0.6);
        p.p_freq_ramp = -0.3 - r.range(0, 0.4);
      } else {
        p.p_base_freq = 0.2 + r.range(0, 0.3);
        p.p_freq_ramp = -0.1 - r.range(0, 0.2);
      }
      p.p_env_attack = 0;
      p.p_env_sustain = r.range(0, 0.1);
      p.p_env_decay = 0.1 + r.range(0, 0.2);
      p.p_hpf_freq = r.range(0, 0.3);
    },

    jump: function (r, p) {
      p.wave_type = 0;
      p.p_duty = r.range(0, 0.6);
      p.p_base_freq = 0.3 + r.range(0, 0.3);
      p.p_freq_ramp = 0.1 + r.range(0, 0.2);
      p.p_env_attack = 0;
      p.p_env_sustain = 0.1 + r.range(0, 0.3);
      p.p_env_decay = 0.1 + r.range(0, 0.2);
      if (r.chance(0.5)) { p.p_hpf_freq = 0.1 + r.range(0, 0.6); }
      else { p.p_lpf_freq = 1 - r.range(0, 0.6); }
    },

    blipSelect: function (r, p) {
      p.wave_type = 0;
      p.p_duty = r.range(0, 0.5);
      p.p_base_freq = 0.2 + r.range(0, 0.4);
      p.p_env_attack = 0;
      p.p_env_sustain = 0.1 + r.range(0, 0.1);
      p.p_env_decay = r.range(0, 0.2);
      p.p_hpf_freq = 0.1;
    },

    synth: function (r, p) {
      p.wave_type = r.chance(0.5) ? 1 : 0;
      p.p_base_freq = 0.3 + r.range(0, 0.4);
      p.p_env_attack = r.range(0, 0.3);
      p.p_env_sustain = 0.3 + r.range(0, 0.4);
      p.p_env_decay = 0.1 + r.range(0, 0.4);
      p.p_env_punch = r.range(0, 0.3);
      p.p_duty = r.range(0, 0.5);
      p.p_lpf_freq = 1 - r.range(0, 0.4);
      p.p_lpf_resonance = r.range(0, 0.4);
      if (r.chance(0.5)) {
        p.p_vib_strength = r.range(0, 0.2);
        p.p_vib_speed = r.range(0.1, 0.4);
      }
    },

    /* A clean 440 Hz sine — handy for tuning and for the pitch test. */
    tone: function (r, p) {
      p.wave_type = 2;
      p.p_base_freq = Math.sqrt(440 / 3528 - 0.001);
      p.p_env_attack = 0;
      p.p_env_sustain = 1;
      p.p_env_decay = 0;
    },

    random: function (r, p) {
      p.wave_type = r.int(2);
      p.p_base_freq = 0.25 + r.range(0, 0.6);
      if (r.chance(0.25)) {
        p.p_freq_limit = 0.1 + r.range(0, 0.5);
        p.p_freq_ramp = -(0.1 + r.range(0, 0.5));
      }
      p.p_env_attack = r.chance(0.7) ? 0 : r.range(0, 0.4);
      p.p_env_sustain = r.chance(0.5) ? r.range(0, 0.2) : r.range(0.1, 0.5);
      p.p_env_decay = 0.1 + r.range(0, 0.5);
      if (r.chance(0.4)) { p.p_env_punch = r.range(0, 0.4); }
      if (r.chance(0.5)) { p.p_duty = r.range(0, 0.6); }
      if (r.chance(0.3)) {
        p.p_vib_strength = r.range(0, 0.4);
        p.p_vib_speed = r.range(0.1, 0.5);
      }
      if (r.chance(0.2)) {
        p.p_arp_mod = r.range(0.2, 0.6);
        p.p_arp_speed = r.range(0.4, 0.9);
      }
      if (r.chance(0.25)) {
        p.p_lpf_freq = r.range(0.4, 0.95);
        p.p_lpf_resonance = r.range(0, 0.4);
      }
      if (r.chance(0.2)) { p.p_hpf_freq = r.range(0, 0.3); }
    }
  };

  function make(name, seed) {
    var p = P().defaults(seed);
    var gen = GENERATORS[name] || GENERATORS.random;
    var r = root.SFX.rng.make((seed ^ 0x9e3779b9) >>> 0);
    gen(r, p);
    p.noise_seed = seed >>> 0;
    return P().coerce(p);
  }

  /* Nudge the current sound a little; it keeps its identity. */
  function mutate(params, seed) {
    var api = P();
    var p = api.clone(api.coerce(params));
    var r = root.SFX.rng.make(seed >>> 0);
    var i, d, span, jitter;

    for (i = 0; i < api.DEFS.length; i++) {
      d = api.DEFS[i];
      if (d.type === "wave") {
        if (r.chance(0.15)) { p.wave_type = r.int(3); }
        continue;
      }
      if (!r.chance(0.55)) { continue; }
      span = d.max - d.min;
      jitter = (r.next() * 2 - 1) * span * 0.18;
      p[d.key] = Math.min(d.max, Math.max(d.min, p[d.key] + jitter));
    }

    /* keep coupled controls audible */
    if (p.p_vib_strength !== 0 && p.p_vib_speed === 0) { p.p_vib_speed = 0.4; }
    if (p.p_arp_mod !== 0 && p.p_arp_speed === 0) { p.p_arp_speed = 0.6; }
    if (p.p_freq_limit !== 0 && p.p_freq_limit > p.p_base_freq) {
      p.p_freq_limit = p.p_base_freq * 0.5;
    }
    return api.coerce(p);
  }

  var NAMES = ["pickupCoin", "laserShoot", "explosion", "powerUp", "hitHurt",
               "jump", "blipSelect", "synth", "tone", "random"];

  return { make: make, mutate: mutate, names: NAMES, GENERATORS: GENERATORS };
}));

