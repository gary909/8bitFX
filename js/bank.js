/* 8bitFX — sound bank persisted in localStorage.
   Entries keep the full-precision parameter set (not the lossy link payload). */
(function (root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.SFX = root.SFX || {};
  root.SFX.bank = api;
}(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this), function (root) {
  "use strict";

  var KEY = "8bitfx.bank.v1";
  var LIMIT = 24;
  var injected = null;    /* used by the test suite / memory fallback */

  function usesLocalStorage() {
    try {
      var store = root.localStorage;
      if (!store) { return null; }
      store.setItem("8bitfx.probe", "1");
      store.removeItem("8bitfx.probe");
      return store;
    } catch (e) {
      return null;   /* private mode / blocked file:// origin */
    }
  }

  function storage() {
    return injected || usesLocalStorage();
  }

  function useStorage(fake) { injected = fake || null; }

  function read() {
    var store = storage();
    if (!store) { return []; }
    try {
      var raw = store.getItem(KEY);
      var list = raw ? JSON.parse(raw) : [];
      return (list && list.length !== undefined) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function write(list) {
    var store = storage();
    if (!store) { return false; }
    try {
      store.setItem(KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      return false;
    }
  }

  function all() { return read(); }

  /* returns the new entry, or null when it could not be persisted */
  function add(params, name) {
    var list = read();
    var now = new Date().getTime();
    var entry = {
      id: "s" + now + "-" + Math.floor(Math.random() * 100000),
      name: String(name || "sound"),
      at: now,
      params: root.SFX.params.serialize(params)
    };
    list.unshift(entry);
    if (list.length > LIMIT) { list.length = LIMIT; }
    if (!write(list)) { return null; }
    return entry;
  }

  function remove(id) {
    var list = read(), out = [], i;
    for (i = 0; i < list.length; i++) {
      if (list[i].id !== id) { out.push(list[i]); }
    }
    write(out);
    return out;
  }

  function clear() { write([]); }

  return {
    KEY: KEY,
    LIMIT: LIMIT,
    all: all,
    add: add,
    remove: remove,
    clear: clear,
    useStorage: useStorage
  };
}));
