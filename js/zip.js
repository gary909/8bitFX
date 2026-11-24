/* 8bitFX — minimal ZIP writer (store method, no compression, no dependencies).
   Enough for packing a folder of WAVs that Explorer/Finder/any unzip can open. */
(function (root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.SFX = root.SFX || {};
  root.SFX.zip = api;
}(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this), function (root) {
  "use strict";

  var LOCAL_SIG = 0x04034b50;
  var CENTRAL_SIG = 0x02014b50;
  var END_SIG = 0x06054b50;
  var DOS_DATE = 0x0021;              /* 1980-01-01, so archives are deterministic */

  var CRC_TABLE = (function () {
    var table = [], c, n, k;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  }());

  function crc32(bytes) {
    var crc = 0xFFFFFFFF, i;
    for (i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function u16(v) { return [v & 0xff, (v >>> 8) & 0xff]; }
  function u32(v) {
    return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  }

  function asciiBytes(text) {
    var out = [], i;
    for (i = 0; i < text.length; i++) { out.push(text.charCodeAt(i) & 0xff); }
    return out;
  }

  function put(target, bytes) {
    for (var i = 0; i < bytes.length; i++) { target.push(bytes[i]); }
  }

  /* files: [{ name: "laser.wav", data: Uint8Array }] -> Uint8Array */
  function create(files) {
    var out = [], central = [], offset = 0, i, f, nameBytes, data, crc, record, cd;

    for (i = 0; i < files.length; i++) {
      f = files[i];
      nameBytes = asciiBytes(f.name);
      data = f.data;
      crc = crc32(data);

      /* local file header (30 bytes) + name + stored data */
      record = [];
      put(record, u32(LOCAL_SIG));
      put(record, u16(20));           /* version needed */
      put(record, u16(0));            /* flags */
      put(record, u16(0));            /* method: store */
      put(record, u16(0));            /* time */
      put(record, u16(DOS_DATE));     /* date */
      put(record, u32(crc));
      put(record, u32(data.length));  /* compressed size */
      put(record, u32(data.length));  /* uncompressed size */
      put(record, u16(nameBytes.length));
      put(record, u16(0));            /* extra field length */

      put(out, record);
      put(out, nameBytes);
      put(out, data);

      /* central directory record (46 bytes) + name */
      cd = [];
      put(cd, u32(CENTRAL_SIG));
      put(cd, u16(20));               /* version made by */
      put(cd, u16(20));               /* version needed */
      put(cd, u16(0));                /* flags */
      put(cd, u16(0));                /* method */
      put(cd, u16(0));                /* time */
      put(cd, u16(DOS_DATE));         /* date */
      put(cd, u32(crc));
      put(cd, u32(data.length));
      put(cd, u32(data.length));
      put(cd, u16(nameBytes.length));
      put(cd, u16(0));                /* extra */
      put(cd, u16(0));                /* comment */
      put(cd, u16(0));                /* disk number */
      put(cd, u16(0));                /* internal attributes */
      put(cd, u32(0));                /* external attributes */
      put(cd, u32(offset));           /* local header offset */
      put(cd, nameBytes);
      put(central, cd);

      offset += record.length + nameBytes.length + data.length;
    }

    var cdOffset = out.length;
    var cdSize = central.length;
    put(out, central);

    var end = [];
    put(end, u32(END_SIG));
    put(end, u16(0));                 /* this disk */
    put(end, u16(0));                 /* disk with the central directory */
    put(end, u16(files.length));
    put(end, u16(files.length));
    put(end, u32(cdSize));
    put(end, u32(cdOffset));
    put(end, u16(0));                 /* comment length */
    put(out, end);

    return new Uint8Array(out);
  }

  return { create: create, crc32: crc32 };
}));
