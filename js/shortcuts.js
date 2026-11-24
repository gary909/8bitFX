/* 8bitFX — keyboard shortcuts.
   handlers: { play, generate, mutate, undo, redo, help, setWave(index) } */
(function (root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.SFX = root.SFX || {};
  root.SFX.shortcuts = api;
}(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this), function (root) {
  "use strict";

  /* Text-entry targets keep every keystroke; sliders/checkboxes keep their own
     native Space behaviour, but shortcuts still work while they are focused. */
  function isTypingTarget(t) {
    if (!t) { return false; }
    var tag = t.tagName ? t.tagName.toUpperCase() : "";
    if (tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable) { return true; }
    if (tag !== "INPUT") { return false; }
    var type = String(t.type || "text").toLowerCase();
    return type !== "range" && type !== "radio" && type !== "checkbox" && type !== "button";
  }

  function isNativeSpaceTarget(t) {
    if (!t) { return false; }
    var tag = t.tagName ? t.tagName.toUpperCase() : "";
    if (tag === "BUTTON" || tag === "SUMMARY" || tag === "A") { return true; }
    if (tag !== "INPUT") { return false; }
    var type = String(t.type || "").toLowerCase();
    return type === "radio" || type === "checkbox" || type === "button" || type === "submit";
  }

  function bind(handlers) {
    function onKey(e) {
      var key = e.key;
      var t = e.target;

      /* undo/redo come first: they must work while a slider has focus */
      if ((e.ctrlKey || e.metaKey) && String(key).toLowerCase() === "z" && !isTypingTarget(t)) {
        if (e.shiftKey) {
          if (handlers.redo) { handlers.redo(); }
        } else {
          handlers.undo();
        }
        e.preventDefault();
        return;
      }
      if (isTypingTarget(t)) { return; }

      if (key === " " || key === "Spacebar") {
        if (isNativeSpaceTarget(t)) { return; }
        handlers.play();
        e.preventDefault();
        return;
      }
      if (key === "g" || key === "G") { handlers.generate(); return; }
      if (key === "m" || key === "M") { handlers.mutate(); return; }
      if ((key === "a" || key === "A") && handlers.compare) { handlers.compare(); return; }
      if (key === "?") { handlers.help(); return; }
      if (key >= "1" && key <= "4") { handlers.setWave(Number(key) - 1); }
    }

    root.document.addEventListener("keydown", onKey);
    return onKey;
  }

  return {
    bind: bind,
    isTypingTarget: isTypingTarget,
    isNativeSpaceTarget: isNativeSpaceTarget
  };
}));
