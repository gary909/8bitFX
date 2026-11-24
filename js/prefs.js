/* 8bitFX — persisted UI preferences (panel state, normalize, master volume).
   Storage is injectable so tests don't need real localStorage. */
(function (root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.SFX = root.SFX || {};
  root.SFX.prefs = api;
}(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this), function (root) {
  "use strict";

  var KEY = "8bitfx.prefs.v1";
  var injected = null;

  function usesLocalStorage() {
    try {
      var store = root.localStorage;
      if (!store) { return null; }
      store.setItem("8bitfx.probe", "1");
      store.removeItem("8bitfx.probe");
      return store;
    } catch (e) {
      return null;
    }
  }

  function storage() { return injected || usesLocalStorage(); }

  function useStorage(fake) { injected = fake || null; }

  function load() {
    var out = { normalize: true, volume: 100, groups: {} };
    var store = storage();
    if (!store) { return out; }

    try {
      var raw = store.getItem(KEY);
      var saved = raw ? JSON.parse(raw) : null;
      if (!saved || typeof saved !== "object") { return out; }

      if (typeof saved.normalize === "boolean") { out.normalize = saved.normalize; }
      if (typeof saved.volume === "number" && isFinite(saved.volume)) {
        out.volume = Math.max(0, Math.min(150, Math.round(saved.volume)));
      }
      if (saved.groups && typeof saved.groups === "object") { out.groups = saved.groups; }
    } catch (e) {
      /* corrupt prefs fall back to defaults */
    }
    return out;
  }

  function save(patch) {
    var store = storage();
    if (!store) { return false; }
    var prefs = load(), key;
    for (key in patch) {
      if (patch.hasOwnProperty(key)) { prefs[key] = patch[key]; }
    }
    try {
      store.setItem(KEY, JSON.stringify(prefs));
      return true;
    } catch (e) {
      return false;
    }
  }

  return { KEY: KEY, load: load, save: save, useStorage: useStorage };
}));
