/* 8bitFX — browser IO helpers: downloads, clipboard, filenames, JSON sanity. */
(function (root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.SFX = root.SFX || {};
  root.SFX.io = api;
}(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this), function (root) {
  "use strict";

  var REVOKE_MS = 1500;

  function download(blob, name) {
    var doc = root.document;
    var url = root.URL.createObjectURL(blob);
    var a = doc.createElement("a");
    a.href = url;
    a.download = name;
    a.style.display = "none";
    doc.body.appendChild(a);
    a.click();
    root.setTimeout(function () {
      doc.body.removeChild(a);
      root.URL.revokeObjectURL(url);
    }, REVOKE_MS);
  }

  /* notify(message) is the app's toast; keeping it injected avoids a dependency */
  function copyText(text, okMessage, notify) {
    var doc = root.document;

    function fallback() {
      var ta = doc.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "readonly");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      doc.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = doc.execCommand("copy"); } catch (e) { ok = false; }
      doc.body.removeChild(ta);
      return ok;
    }

    if (root.navigator.clipboard && root.navigator.clipboard.writeText) {
      root.navigator.clipboard.writeText(text).then(function () {
        notify(okMessage);
      }, function () {
        notify(fallback() ? okMessage : "Copy failed");
      });
    } else {
      notify(fallback() ? okMessage : "Copy failed");
    }
  }

  function fileName(name, params, ext) {
    return name + "-" + params.sample_size + "bit-" +
      Math.round(params.sample_rate / 1000) + "k." + ext;
  }

  /* guards against loading an arbitrary JSON object as a "sound" */
  function looksLikeSoundParams(obj, byKey) {
    if (!obj || typeof obj !== "object") { return false; }
    var known = 0, key;
    for (key in obj) {
      if (obj.hasOwnProperty(key) && byKey.hasOwnProperty(key)) { known++; }
    }
    return known >= 3;
  }

  return {
    download: download,
    copyText: copyText,
    fileName: fileName,
    looksLikeSoundParams: looksLikeSoundParams
  };
}));
