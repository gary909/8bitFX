/* 8bitFX — permalink codec.
   v3: a 31-byte binary payload (base64url, "3" prefix) holding every parameter,
       a 16-bit sample rate, a flags byte (depth + switches) and the noise seed.
   v2: the same layout with a 4-entry sample-rate index — still decoded.
   v1: the original base64url JSON array — still decoded. */
(function (root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.SFX = root.SFX || {};
  root.SFX.codec = api;
}(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this), function (root) {
  "use strict";

  function P() { return root.SFX.params; }

  function round(v, digits) {
    var f = Math.pow(10, digits);
    return Math.round(v * f) / f;
  }

  function b64encode(str) {
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function b64decode(str) {
    var s = String(str).replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) { s += "="; }
    return atob(s);
  }

  function b64encodeBytes(bytes) {
    var s = "", i;
    for (i = 0; i < bytes.length; i++) { s += String.fromCharCode(bytes[i] & 0xff); }
    return b64encode(s);
  }

  function b64decodeBytes(str) {
    var bin = b64decode(str), out = [], i;
    for (i = 0; i < bin.length; i++) { out.push(bin.charCodeAt(i) & 0xff); }
    return out;
  }

  /* Each knob is quantised to a byte: at most half a step (0.2 % of its range)
     away from the original — inaudible, but 3.5x shorter than the v1 payload. */
  function encode(p) {
    var api = P();
    p = api.coerce(p);

    var bytes = [p.wave_type & 3], i, d, v, b;

    for (i = 0; i < api.LINK_KEYS.length; i++) {
      d = api.byKey[api.LINK_KEYS[i]];
      v = p[d.key];
      b = d.signed ? Math.round((v + 1) * 127.5) : Math.round(v * 255);
      bytes.push(b < 0 ? 0 : (b > 255 ? 255 : b));
    }

    bytes.push(p.sample_rate & 0xff, (p.sample_rate >>> 8) & 0xff);

    var flags = 0;
    if (p.sample_size === 16) { flags |= 1; }
    if (p.p_dc_block) { flags |= 2; }
    if (p.p_wave_trim) { flags |= 4; }
    bytes.push(flags);

    var seed = p.noise_seed >>> 0;
    bytes.push(seed & 0xff, (seed >>> 8) & 0xff, (seed >>> 16) & 0xff, (seed >>> 24) & 0xff);

    return "3" + b64encodeBytes(bytes);
  }

  /* v3: the sample rate is a 16-bit field, so any rate in 4–96 kHz survives */
  function decodeV3(bytes) {
    var api = P();
    if (!bytes || bytes.length !== api.LINK_KEYS.length + 8) { return null; }

    var p = api.defaults(0), i, d, b, flags, at = 0;

    p.wave_type = bytes[at++] & 3;
    for (i = 0; i < api.LINK_KEYS.length; i++) {
      d = api.byKey[api.LINK_KEYS[i]];
      b = bytes[at++];
      p[d.key] = d.signed ? (b / 127.5 - 1) : (b / 255);
    }
    p.sample_rate = bytes[at] | (bytes[at + 1] << 8);
    at += 2;
    flags = bytes[at++];
    p.sample_size = (flags & 1) ? 16 : 8;
    p.p_dc_block = (flags & 2) ? 1 : 0;
    p.p_wave_trim = (flags & 4) ? 1 : 0;
    p.noise_seed = (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) |
                    (bytes[at + 3] << 24)) >>> 0;
    return api.coerce(p);
  }

  function decodeV2(bytes) {
    var api = P();
    if (!bytes || bytes.length !== api.LINK_KEYS.length + 7) { return null; }

    var p = api.defaults(0), i, d, b, flags, at = 0;

    p.wave_type = bytes[at++] & 3;
    for (i = 0; i < api.LINK_KEYS.length; i++) {
      d = api.byKey[api.LINK_KEYS[i]];
      b = bytes[at++];
      p[d.key] = d.signed ? (b / 127.5 - 1) : (b / 255);
    }
    p.sample_rate = api.RATES[bytes[at++]] || 44100;
    flags = bytes[at++];
    p.sample_size = (flags & 1) ? 16 : 8;
    p.p_dc_block = (flags & 2) ? 1 : 0;
    p.p_wave_trim = (flags & 4) ? 1 : 0;
    p.noise_seed = (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) |
                    (bytes[at + 3] << 24)) >>> 0;
    return api.coerce(p);
  }

  /* the v1 payload: used by the back-compatibility test, and by anyone who needs
     a link an older copy of the tool can still open */
  function encodeLegacy(p) {
    var api = P();
    p = api.coerce(p);
    var values = [], i;
    for (i = 0; i < api.LEGACY_ORDER.length; i++) {
      values.push(i === api.LEGACY_ORDER.length - 1
        ? (p.noise_seed >>> 0)
        : round(p[api.LEGACY_ORDER[i]], 5));
    }
    return b64encode(JSON.stringify(values));
  }

  function decode(str) {
    var api = P();
    var s = String(str || "");
    if (!s) { return null; }
    try {
      if (s.charAt(0) === "3") { return decodeV3(b64decodeBytes(s.substring(1))); }
      if (s.charAt(0) === "2") { return decodeV2(b64decodeBytes(s.substring(1))); }

      var values = JSON.parse(b64decode(s));
      if (!values || values.length !== api.LEGACY_ORDER.length) { return null; }
      var p = api.defaults(0), i;
      for (i = 0; i < api.LEGACY_ORDER.length; i++) { p[api.LEGACY_ORDER[i]] = values[i]; }
      return api.coerce(p);
    } catch (e) {
      return null;
    }
  }

  return {
    encode: encode,
    decode: decode,
    encodeLegacy: encodeLegacy,
    b64encode: b64encode,
    b64decode: b64decode
  };
}));
