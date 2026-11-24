/* 8bitFX — application wiring: state, rendering, export, shortcuts. */
(function (root) {
  "use strict";

  var SFX = root.SFX;
  var doc = root.document;

  var state = {
    params: null,
    rendered: null,
    preview: null,      /* quantised, unnormalised — what you hear */
    name: "sound",
    normalize: true,
    undo: [],
    redo: [],
    batch: [],
    compareParams: null,   /* the sound before the current edit, for A/B */
    packing: false,
    editSnapshot: null,
    frame: 0,
    toastTimer: 0,
    signature: "",      /* params fingerprint of the last render */
    lastHash: "",
    canvasSize: null
  };

  var UNDO_DEPTH = 60;
  var TOAST_MS = 1800;
  var CLIP_RATIO = 0.005;   /* warn about clipping above this fraction of frames */

  var panel = null;
  var els = {};

  function $(id) { return doc.getElementById(id); }

  function toast(message) {
    if (!els.toast) { return; }
    els.toast.textContent = message;
    els.toast.className = "toast show";
    if (state.toastTimer) { root.clearTimeout(state.toastTimer); }
    state.toastTimer = root.setTimeout(function () {
      els.toast.className = "toast";
    }, TOAST_MS);
  }

  function fileName(ext) { return SFX.io.fileName(state.name, state.params, ext); }

  function download(blob, name) { SFX.io.download(blob, name); }

  function copyText(text, okMessage) { SFX.io.copyText(text, okMessage, toast); }

  /* ---------- undo / redo ---------- */
  function snapshot() {
    return JSON.stringify({ name: state.name, params: SFX.params.serialize(state.params) });
  }

  function updateHistoryButtons() {
    if (els.undo) { els.undo.disabled = state.undo.length === 0; }
    if (els.redo) { els.redo.disabled = state.redo.length === 0; }
  }

  function pushUndo(serialized) {
    if (!serialized) { return; }
    if (state.undo.length && state.undo[state.undo.length - 1] === serialized) { return; }
    state.undo.push(serialized);
    if (state.undo.length > UNDO_DEPTH) { state.undo.shift(); }
    state.redo.length = 0;              /* a new action invalidates redo */

    /* remember the "before" sound so A can compare against it */
    try {
      var entry = JSON.parse(serialized);
      state.compareParams = SFX.params.coerce(entry.params || entry);
    } catch (e) { /* ignore */ }

    updateHistoryButtons();
  }

  function restore(serialized) {
    var entry = JSON.parse(serialized);
    state.params = SFX.params.coerce(entry.params || entry);
    if (entry.name) { state.name = entry.name; }
    state.editSnapshot = null;
    renderAll();
    writeHash();
  }

  function undo() {
    if (!state.undo.length) { return; }
    state.redo.push(snapshot());
    restore(state.undo.pop());
    updateHistoryButtons();
  }

  function redo() {
    if (!state.redo.length) { return; }
    state.undo.push(snapshot());
    restore(state.redo.pop());
    updateHistoryButtons();
  }

  /* ---------- generation ---------- */
  function applyParams(next, name) {
    pushUndo(snapshot());
    state.params = SFX.params.coerce(next);
    if (name) { state.name = name; }
    state.editSnapshot = null;
    renderAll();
    writeHash();
  }

  function generate(name) {
    var preset = name || "random";
    applyParams(SFX.presets.make(preset, SFX.rng.newSeed()), preset);
    play();
  }

  function mutate() {
    var before = snapshot();
    state.params = SFX.presets.mutate(state.params, SFX.rng.newSeed());
    pushUndo(before);
    state.editSnapshot = null;
    renderAll();
    writeHash();
    play();
  }

  /* ---------- playback ---------- */
  function play() {
    ensureFullQuality();
    if (!state.preview) { return; }
    var samples = SFX.synth.dequantize(state.preview.pcm, state.preview.bits);
    if (!SFX.audio.play(samples, state.params.sample_rate, 1)) {
      toast("Web Audio unavailable");
    }
  }

  /* A: play the sound as it was before the last change */
  function comparePlay() {
    if (!state.compareParams) { toast("No previous sound yet"); return; }

    var p = state.compareParams;
    var r = SFX.synth.render(p, { oversampling: 8 });
    var q = SFX.synth.quantize(r.float, p.sample_size, { normalize: false, peak: r.peak });
    if (!SFX.audio.play(SFX.synth.dequantize(q.pcm, q.bits), p.sample_rate, 1)) {
      toast("Web Audio unavailable");
      return;
    }
    toast("Previous sound");
  }

  /* ---------- preferences ---------- */
  function saveGroupPref(name, open) {
    var groups = SFX.prefs.load().groups || {};
    if (groups[name] === open) { return; }
    groups[name] = open;
    SFX.prefs.save({ groups: groups });
  }

  /* ---------- rendering ---------- */
  function cancelFrame() {
    if (!state.frame) { return; }
    if (root.cancelAnimationFrame) { root.cancelAnimationFrame(state.frame); }
    else { root.clearTimeout(state.frame); }
    state.frame = 0;
  }

  function paramsSignature() {
    return JSON.stringify(SFX.params.serialize(state.params));
  }

  /* renderAll(force): renders the current parameters. Safe to call often — it
     bails out when nothing changed and cancels any queued frame, so an edit can
     never cause two renders for one change. */
  function renderAll(force, oversampling) {
    var os = oversampling || 8;
    cancelFrame();

    var signature = paramsSignature() + "@" + os;
    if (!force && state.rendered && signature === state.signature) {
      if (panel) { panel.sync(state.params); }
      return;
    }

    try {
      var p = state.params;
      var r = SFX.synth.render(p, { oversampling: os });
      state.rendered = r;
      state.preview = SFX.synth.quantize(r.float, p.sample_size, { normalize: false, peak: r.peak });
      state.signature = signature;

      if (panel) { panel.sync(p); }
      draw();
      updateStats();
      syncChips();
    } catch (err) {
      if (root.console && root.console.error) { root.console.error("8bitFX: render failed", err); }
      toast("Render failed — keeping the last sound");
    }
  }

  /* Long sounds are expensive to render at the full 8x oversampling, so live
     drags drop to 4x/2x; the commit path always renders at full quality. */
  function previewOversampling() {
    var k = SFX.params.toKnobs(state.params);
    var seconds = k.attack + k.sustain + k.decay;
    if (seconds > 1.2) { return 2; }
    if (seconds > 0.6) { return 4; }
    return 8;
  }

  /* A drag can leave a reduced-oversampling preview in `state.rendered`. Anything
     the user hears on purpose or saves must come from the full-quality render. */
  function ensureFullQuality() {
    if (state.rendered && state.rendered.oversampling !== 8) {
      renderAll(true, 8);
    }
  }

  function scheduleRender() {
    if (state.frame) { return; }
    if (root.requestAnimationFrame) {
      state.frame = root.requestAnimationFrame(function () {
        state.frame = 0;
        renderAll(false, previewOversampling());
      });
    } else {
      state.frame = root.setTimeout(function () {
        state.frame = 0;
        renderAll(false, previewOversampling());
      }, 16);
    }
  }

  function draw() {
    if (!els.canvas || !state.rendered) { return; }
    SFX.ui.drawWaveform(els.canvas, state.rendered.float, state.rendered.peak, state.canvasSize);
  }

  /* measured once per layout change instead of once per frame */
  function measureCanvas() {
    if (!els.canvas || !els.canvas.getBoundingClientRect) { return; }
    var rect = els.canvas.getBoundingClientRect();
    state.canvasSize = { width: rect.width, height: rect.height };
  }

  function updateStats() {
    var r = state.rendered, p = state.params;
    if (!r || !els.duration) { return; }
    var bytes = 44 + r.frames * (p.sample_size / 8);
    var clipped = state.preview.clipped;
    var significant = r.frames > 0 && clipped > r.frames * CLIP_RATIO;

    els.duration.textContent = Math.round(r.duration * 1000) + " ms";
    els.samples.textContent = String(r.frames);
    els.size.textContent = bytes < 1024 ? (bytes + " B") : ((bytes / 1024).toFixed(1) + " kB");
    els.clipped.textContent = String(clipped);
    els.clipHint.hidden = !significant;
    if (els.scopeEmpty) { els.scopeEmpty.hidden = (r.frames > 0); }
    if (els.capHint) { els.capHint.hidden = !r.capped; }
  }

  function writeHash() {
    var code = "#" + SFX.codec.encode(state.params);
    if (code === state.lastHash) { return; }
    state.lastHash = code;

    try {
      if (root.history && root.history.replaceState) {
        root.history.replaceState(null, "", code);
        return;
      }
    } catch (e) { /* file:// in some browsers */ }

    /* fallback that replaces the history entry instead of pushing a new one */
    try {
      var base = String(root.location.href).split("#")[0];
      if (root.location.replace) { root.location.replace(base + code); }
      else { root.location.hash = code; }
    } catch (e2) { /* ignore */ }
  }

  /* ---------- control handlers ---------- */
  function onInput(key, value) {
    if (!state.editSnapshot) { state.editSnapshot = snapshot(); }
    state.params[key] = value;
    scheduleRender();
  }

  function onCommit() {
    if (state.editSnapshot) {
      pushUndo(state.editSnapshot);
      state.editSnapshot = null;
    }
    renderAll();
    writeHash();
  }

  function changeSetting(fn) {
    pushUndo(snapshot());
    fn();
    renderAll();
    writeHash();
  }

  /* ---------- export ---------- */
  function exportWav() {
    var out = SFX.exporter.toWav(state.params, { normalize: state.normalize });
    download(new Blob([out.bytes], { type: "audio/wav" }), fileName("wav"));
    toast("WAV " + (out.byteLength / 1024).toFixed(1) + " kB" +
      (out.clipped ? " (clipped)" : ""));
  }

  function exportJson() {
    var json = JSON.stringify(SFX.params.serialize(state.params), null, 2);
    download(new Blob([json], { type: "application/json" }), fileName("json"));
    toast("JSON saved");
  }

  function importJson(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(String(reader.result)); }
      catch (e) { toast("Not valid JSON"); return; }
      if (!SFX.io.looksLikeSoundParams(data, SFX.params.byKey)) {
        toast("That JSON doesn't look like a sound");
        return;
      }
      applyParams(SFX.params.coerce(data), "loaded");
      play();
      toast("Sound loaded");
    };
    reader.onerror = function () { toast("Could not read file"); };
    reader.readAsText(file);
  }

  function copyJson() {
    copyText(JSON.stringify(SFX.params.serialize(state.params), null, 2), "JSON copied");
  }

  function copyLink() {
    var base = String(root.location.href).split("#")[0];
    copyText(base + "#" + SFX.codec.encode(state.params), "Link copied");
  }

  /* ---------- sound bank ---------- */
  function refreshBank() {
    var grid = $("bank-grid");
    if (!grid) { return; }
    SFX.ui.renderBank(grid, SFX.bank.all(), {
      load: function (entry) { applyParams(entry.params, entry.name); play(); },
      remove: function (entry) { SFX.bank.remove(entry.id); refreshBank(); }
    });
  }

  function nextBankName(base) {
    var list = SFX.bank.all(), used = {}, i, n = 1, name = base;
    for (i = 0; i < list.length; i++) { used[list[i].name] = true; }
    while (used[name]) { n++; name = base + " " + n; }
    return name;
  }

  function saveToBank() {
    var name = nextBankName(state.name);
    var entry = SFX.bank.add(state.params, name);
    if (!entry) { toast("Bank storage unavailable"); return; }
    refreshBank();
    toast("Saved " + name);
  }

  function clearBank() {
    if (!SFX.bank.all().length) { return; }
    SFX.bank.clear();
    refreshBank();
    toast("Bank cleared");
  }

  /* ---------- pack export (bank -> zip of WAVs) ---------- */
  function safeFileBase(name) {
    var clean = String(name || "").replace(/[^a-zA-Z0-9 _-]/g, "").replace(/\s+/g, "_");
    return clean || "sound";
  }

  function exportPack() {
    var list = SFX.bank.all();
    if (!list.length) { toast("Bank is empty - save a sound first"); return; }
    if (state.packing) { return; }

    var button = $("btn-pack");
    var files = [], index = 0;
    state.packing = true;
    if (button) { button.disabled = true; }

    function finish(message) {
      state.packing = false;
      if (button) { button.disabled = false; }
      toast(message);
    }

    /* one sound per task so the progress toast can paint between renders */
    function step() {
      try {
        var entry = list[index];
        var out = SFX.exporter.toWav(entry.params, { normalize: state.normalize });
        files.push({
          name: safeFileBase(entry.name) + "-" + out.bits + "bit-" +
                Math.round(out.sampleRate / 1000) + "k.wav",
          data: out.bytes
        });
        index++;
        toast("Packing " + index + " / " + list.length + "\u2026");

        if (index < list.length) { root.setTimeout(step, 0); return; }

        var bytes = SFX.zip.create(files);
        download(new Blob([bytes], { type: "application/zip" }), "8bitFX-pack.zip");
        finish(files.length + " WAVs packed (" + (bytes.length / 1024).toFixed(1) + " kB)");
      } catch (err) {
        if (root.console && root.console.error) { root.console.error("8bitFX: pack failed", err); }
        finish("Pack failed");
      }
    }

    toast("Packing 1 / " + list.length + "\u2026");
    root.setTimeout(step, 0);
  }

  /* ---------- batch variations ---------- */
  function renderBatch() {
    var grid = $("batch-grid");
    if (!grid) { return; }
    while (grid.firstChild) { grid.removeChild(grid.firstChild); }

    for (var i = 0; i < state.batch.length; i++) {
      (function (index) {
        var btn = doc.createElement("button");
        btn.type = "button";
        btn.className = "batch-tile";
        btn.textContent = String(index + 1);
        btn.setAttribute("aria-label", "Use variation " + (index + 1));
        btn.addEventListener("click", function () {
          applyParams(state.batch[index], state.name);
          play();
        });
        grid.appendChild(btn);
      }(i));
    }
  }

  function rollBatch() {
    var generator = SFX.presets.GENERATORS[state.name] ? state.name : "random";
    var seed = SFX.rng.newSeed();
    state.batch = [];
    for (var i = 0; i < 8; i++) {
      state.batch.push(SFX.presets.make(generator, (seed + i * 7919) >>> 0));
    }
    renderBatch();
    toast("8 variations of " + generator);
  }

  function showHelp() {
    var dlg = $("help-dialog");
    if (!dlg) { return; }
    if (typeof dlg.showModal === "function") { dlg.showModal(); }
    else { dlg.setAttribute("open", "open"); }
  }

  /* ---------- bindings ---------- */
  function syncChips() {
    var p = state.params;
    var presetRate = SFX.params.RATES.indexOf(p.sample_rate) !== -1;
    var chips = doc.querySelectorAll("#rate-chips input");
    var i;

    /* unchecked when a custom rate (e.g. 48 kHz from a file) is in use */
    for (i = 0; i < chips.length; i++) {
      chips[i].checked = presetRate && Number(chips[i].value) === p.sample_rate;
    }

    var legend = $("rate-legend");
    if (legend) {
      legend.textContent = presetRate
        ? "Sample rate"
        : "Sample rate \u2014 " + (Math.round(p.sample_rate / 100) / 10) + " kHz";
    }

    var bits = $("bits-" + p.sample_size);
    if (bits) { bits.checked = true; }
    var norm = $("chk-normalize");
    if (norm) { norm.checked = state.normalize; }
  }

  /* keyboard handling lives in js/shortcuts.js */

  function bind() {
    var i, list, el;

    $("btn-play").addEventListener("click", play);
    $("btn-generate").addEventListener("click", function () { generate("random"); });
    $("btn-mutate").addEventListener("click", mutate);
    els.undo.addEventListener("click", undo);
    if (els.redo) { els.redo.addEventListener("click", redo); }

    $("btn-wav").addEventListener("click", exportWav);
    $("btn-json").addEventListener("click", exportJson);
    $("btn-load").addEventListener("click", function () { $("file-input").click(); });
    $("btn-copy-json").addEventListener("click", copyJson);
    $("btn-copy-link").addEventListener("click", copyLink);
    $("btn-help").addEventListener("click", showHelp);

    var bankSave = $("btn-bank-save");
    if (bankSave) { bankSave.addEventListener("click", saveToBank); }
    var bankClear = $("btn-bank-clear");
    if (bankClear) { bankClear.addEventListener("click", clearBank); }
    var pack = $("btn-pack");
    if (pack) { pack.addEventListener("click", exportPack); }
    var batch = $("btn-batch");
    if (batch) { batch.addEventListener("click", rollBatch); }

    $("file-input").addEventListener("change", function () {
      var file = this.files && this.files[0];
      if (file) { importJson(file); }
      this.value = "";
    });

    list = doc.querySelectorAll("[data-preset]");
    for (i = 0; i < list.length; i++) {
      el = list[i];
      (function (btn) {
        btn.addEventListener("click", function () {
          generate(btn.getAttribute("data-preset"));
        });
      }(el));
    }

    list = doc.querySelectorAll("#rate-chips input");
    for (i = 0; i < list.length; i++) {
      el = list[i];
      (function (input) {
        input.addEventListener("change", function () {
          var rate = Number(input.value);
          changeSetting(function () { state.params.sample_rate = rate; });
        });
      }(el));
    }

    list = doc.querySelectorAll("#bits-chips input");
    for (i = 0; i < list.length; i++) {
      el = list[i];
      (function (input) {
        input.addEventListener("change", function () {
          var depth = Number(input.value);
          changeSetting(function () { state.params.sample_size = depth; });
        });
      }(el));
    }

    var norm = $("chk-normalize");
    if (norm) {
      norm.checked = state.normalize;
      norm.addEventListener("change", function () {
        state.normalize = norm.checked;   /* read at export time */
        SFX.prefs.save({ normalize: state.normalize });
      });
    }

    var vol = $("master-vol");
    if (vol) {
      vol.value = String(SFX.prefs.load().volume);
      var applyVolume = function () {
        var v = Number(vol.value);
        vol.style.setProperty("--fill", (v / 1.5) + "%");
        SFX.audio.setVolume(v / 100);
      };
      vol.addEventListener("input", applyVolume);
      vol.addEventListener("change", function () { SFX.prefs.save({ volume: Number(vol.value) }); });
      applyVolume();
    }

    SFX.shortcuts.bind({
      play: play,
      generate: function () { generate("random"); },
      mutate: mutate,
      undo: undo,
      redo: redo,
      compare: comparePlay,
      help: showHelp,
      setWave: function (index) {
        changeSetting(function () { state.params.wave_type = index; });
        play();
      }
    });

    function onResize() {
      measureCanvas();
      draw();
    }
    if (root.ResizeObserver && els.canvas) {
      var observer = new root.ResizeObserver(onResize);
      observer.observe(els.canvas);
    }
    if (root.addEventListener) { root.addEventListener("resize", onResize); }
  }

  /* ---------- in-app self check (?selftest=1) ---------- */
  function runSelfTest() {
    SFX.selftest.run({
      doc: doc,
      state: state,
      $: $,
      renderAll: renderAll,
      ensureFullQuality: ensureFullQuality,
      changeSetting: changeSetting,
      undo: undo,
      redo: redo
    });
  }





  /* ---------- boot ---------- */
  function init() {
    els.canvas = $("waveform");
    els.toast = $("toast");
    els.duration = $("stat-duration");
    els.samples = $("stat-samples");
    els.size = $("stat-size");
    els.clipped = $("stat-clipped");
    els.clipHint = $("clip-hint");
    els.capHint = $("cap-hint");
    els.scopeEmpty = $("scope-empty");
    els.undo = $("btn-undo");
    els.redo = $("btn-redo");

    state.normalize = SFX.prefs.load().normalize;

    var hash = String(root.location.hash || "").replace(/^#/, "");
    var restored = hash ? SFX.codec.decode(hash) : null;

    /* optional ?preset=laserShoot&rate=8000&bits=16 deep links */
    var search = String(root.location.search || "");
    var requested = null;
    var match = /[?&]preset=([a-zA-Z]+)/.exec(search);
    if (match && SFX.presets.GENERATORS[match[1]]) { requested = match[1]; }

    if (restored) {
      state.params = restored;
      state.name = "sound";
    } else if (requested) {
      state.params = SFX.presets.make(requested, SFX.rng.newSeed());
      state.name = requested;
    } else {
      state.params = SFX.presets.make("random", SFX.rng.newSeed());
      state.name = "random";
    }

    /* sample-rate / bit-depth overrides from the query string */
    var rateMatch = /[?&]rate=(\d+)/.exec(search);
    if (rateMatch) {
      var rate = Number(rateMatch[1]);
      if (rate >= SFX.params.RATE_MIN && rate <= SFX.params.RATE_MAX) {
        state.params.sample_rate = rate;
      }
    }
    var bitsMatch = /[?&]bits=(\d+)/.exec(search);
    if (bitsMatch) { state.params.sample_size = (Number(bitsMatch[1]) === 16) ? 16 : 8; }

    panel = SFX.ui.buildParams($("param-groups"), {
      onInput: onInput,
      onCommit: onCommit,
      onGroupToggle: saveGroupPref
    }, SFX.prefs.load().groups);

    bind();
    measureCanvas();
    syncChips();
    renderAll(true);
    refreshBank();
    writeHash();

    if (/[?&]selftest=1/.test(search)) { runSelfTest(); }
  }

  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this)));
