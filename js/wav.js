/* 8bitFX — WAV (RIFF/WAVE) encoder.
   Writes mono PCM: 8-bit unsigned or 16-bit signed little-endian. */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.SFX = root.SFX || {};
  root.SFX.wav = api;
}(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this), function () {
  "use strict";

  function writeAscii(view, offset, text) {
    for (var i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  }

  /* pcm: Uint8Array (8-bit) or Int16Array (16-bit) */
  function encode(pcm, options) {
    options = options || {};
    var sampleRate = options.sampleRate || 44100;
    var bits = (options.bits === 16) ? 16 : 8;
    var channels = 1;
    var frames = pcm.length;
    var bytesPerSample = bits >> 3;
    var dataSize = frames * bytesPerSample;
    var blockAlign = channels * bytesPerSample;
    var byteRate = sampleRate * blockAlign;

    var buffer = new ArrayBuffer(44 + dataSize);
    var view = new DataView(buffer);

    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);   /* file size - 8 */
    writeAscii(view, 8, "WAVE");

    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);             /* fmt chunk size */
    view.setUint16(20, 1, true);              /* PCM */
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bits, true);

    writeAscii(view, 36, "data");
    view.setUint32(40, dataSize, true);

    var offset = 44, i;
    if (bits === 8) {
      for (i = 0; i < frames; i++) {
        view.setUint8(offset + i, pcm[i] & 0xff);
      }
    } else {
      for (i = 0; i < frames; i++) {
        view.setInt16(offset + i * 2, pcm[i], true);
      }
    }

    return {
      buffer: buffer,
      byteLength: 44 + dataSize,
      sampleRate: sampleRate,
      bits: bits,
      frames: frames,
      dataSize: dataSize
    };
  }

  function toBlob(wav) {
    return new Blob([wav.buffer], { type: "audio/wav" });
  }

  function toDataURI(wav) {
    var bytes = new Uint8Array(wav.buffer);
    var chunks = [], chunk = "", i;
    for (i = 0; i < bytes.length; i++) {
      chunk += String.fromCharCode(bytes[i]);
      if (chunk.length >= 0x8000) { chunks.push(chunk); chunk = ""; }
    }
    chunks.push(chunk);
    return "data:audio/wav;base64," + btoa(chunks.join(""));
  }

  return { encode: encode, toBlob: toBlob, toDataURI: toDataURI };
}));
