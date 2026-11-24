/* 8bitFX — application wiring: state, rendering, export, shortcuts. */
(function (root) {
  "use strict";

  var SFX = root.SFX;
  var doc = root.document;

  var state = {
    sections: [],                 /* three independent parameter sets */
    enabled: [true, false, false],/* included in the master mix */
    focus: 0,                     /* panel targeted by the keyboard shortcuts */
    batchTarget: 0,
    names: ["Section 1", "Section 2", "Section 3"],
    layers: [null, null, null],   /* per-section render cache */
    layerKeys: ["", "", ""],
    rendered: null,               /* the mix — big scope + master play */
    preview: null,                /* quantised mix */
    normalize: true,
    undo: [],
    redo: [],
    batch: [],
    comparePatch: null,           /* the patch before the current edit, for A/B */
    packing: false,
    editSnapshot: null,
    frame: 0,
    toastTimer: 0,
    signature: "",
    lastHash: "",
    canvasSize: null
  };

  var SECTION_COUNT = 3;
  var UNDO_DEPTH = 60;
  var TOAST_MS = 1800;
  var CLIP_RATIO = 0.005;   /* warn about clipping above this fraction of frames */

  var panels = [];
  var els = {};

  function $(id) { return doc.getElementById(id); }

  /* ---------- patch helpers ---------- */
  function activeParams() { return state.sections[state.focus] || state.sections[0]; }

  function eachSection(fn) {
    for (var i = 0; i < SECTION_COUNT; i++) { fn(state.sections[i], i); }
  }

  function patch() { return { sections: state.sections, enabled: state.enabled }; }

  function sectionSignature(p) { return JSON.stringify(SFX.params.serialize(p)); }

  function patchSignature() {
    return state.sections.map(sectionSignature).join("|") + "#" + state.enabled.join(",");
  }

  function toast(message) {
    if (!els.toast) { return; }
    els.toast.textContent = message;
    els.toast.className = "toast show";
    if (state.toastTimer) { root.clearTimeout(state.toastTimer); }
    state.toastTimer = root.setTimeout(function () {
      els.toast.className = "toast";
    }, TOAST_MS);
  }

  function fileName(ext) {
    return SFX.io.fileName(state.names[state.focus], state.sections[0], ext);
  }

  function download(blob, name) { SFX.io.download(blob, name); }

  function copyText(text, okMessage) { SFX.io.copyText(text, okMessage, toast); }

  /* ---------- undo / redo ---------- */
  function snapshot() {
    return JSON.stringify({
      focus: state.focus,
      names: state.names,
      enabled: state.enabled,
      sections: state.sections.map(SFX.params.serialize)
    });
  }

  /* normalise any patch-ish object into state */
  function acceptPatch(data, keepNames) {
    var api = SFX.params;
    var sections = (data && data.sections) || [data];
    var enabled = (data && data.enabled) || [true, false, false];
    var i;

    state.sections = [];
    for (i = 0; i < SECTION_COUNT; i++) {
      state.sections.push(api.coerce(sections[i] || sections[0]));
    }
    state.enabled = [];
    for (i = 0; i < SECTION_COUNT; i++) { state.enabled.push(!!enabled[i]); }
    if (!keepNames) { state.names = ["Section 1", "Section 2", "Section 3"]; }
    state.focus = 0;
    state.layers = [null, null, null];
    state.layerKeys = ["", "", ""];
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

    /* remember the "before" patch so A can compare against it */
    try {
      var entry = JSON.parse(serialized);
      state.comparePatch = entry.sections
        ? { sections: entry.sections, enabled: entry.enabled || [true, false, false] }
        : { sections: [entry.params || entry], enabled: [true, false, false] };
    } catch (e) { /* ignore */ }

    updateHistoryButtons();
  }

  function restore(serialized) {
    var entry = JSON.parse(serialized);

    if (entry.sections) {
      state.sections = entry.sections.map(SFX.params.coerce);
      state.enabled = (entry.enabled || [true, false, false]).slice(0, SECTION_COUNT);
      if (entry.names) { state.names = entry.names.slice(); }
      if (typeof entry.focus === "number") {
        state.focus = Math.max(0, Math.min(SECTION_COUNT - 1, entry.focus));
      }
    } else {
      acceptPatch({ sections: [entry.params || entry], enabled: [true, false, false] }, true);
    }

    state.editSnapshot = null;
    renderAll(true, 8);
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
  function applyTo(index, next, name) {
    pushUndo(snapshot());
    state.sections[index] = SFX.params.coerce(next);
    if (name) { state.names[index] = name; }
    state.editSnapshot = null;
    renderAll();
    writeHash();
  }

  function applyPreset(index, name) {
    applyTo(index, SFX.presets.make(name, SFX.rng.newSeed()), name);
    playSection(index);
  }

  function generate(name) {
    applyPreset(state.focus, name || "random");
  }

  function mutateSection(index) {
    var before = snapshot();
    state.sections[index] = SFX.presets.mutate(state.sections[index], SFX.rng.newSeed());
    pushUndo(before);
    state.editSnapshot = null;
    renderAll();
    writeHash();
    playSection(index);
  }

  function mutate() { mutateSection(state.focus); }

  function renameSection(index, value) {
    var clean = String(value || "").replace(/\s+/g, " ").trim().slice(0, 24);
    if (!clean || clean === state.names[index]) {
      syncPanels();
      return;
    }
    pushUndo(snapshot());
    state.names[index] = clean;
    syncPanels();
    writeHash();
  }

  /* fill all three sections with different random presets and mix them */
  function rollAll() {
    pushUndo(snapshot());

    for (var i = 0; i < SECTION_COUNT; i++) {
      var pick = SFX.presets.names[Math.floor(Math.random() * SFX.presets.names.length)];
      state.sections[i] = SFX.presets.make(pick, SFX.rng.newSeed());
      state.names[i] = pick;
      state.enabled[i] = true;
    }

    state.editSnapshot = null;
    renderAll(true, 8);
    writeHash();
    play();
    toast("Rolled three sections");
  }

  /* ---------- playback ---------- */
  function play() {
    ensureFullQuality();
    if (!state.preview) { toast("Enable a section first"); return; }
    var samples = SFX.synth.dequantize(state.preview.pcm, state.preview.bits);
    if (!SFX.audio.play(samples, state.sections[0].sample_rate, 1)) {
      toast("Web Audio unavailable");
    }
  }

  /* a section card's ▶ plays that section on its own, whatever its mix checkbox says */
  function playSection(index) {
    var p = state.sections[index];
    if (!p) { return; }

    var r = SFX.synth.render(p, { oversampling: 8 });
    var q = SFX.synth.quantize(r.float, p.sample_size, { normalize: false, peak: r.peak });
    if (!SFX.audio.play(SFX.synth.dequantize(q.pcm, q.bits), p.sample_rate, 1)) {
      toast("Web Audio unavailable");
    }
  }

  /* A: play the patch as it was before the last change */
  function comparePlay() {
    var previous = state.comparePatch;
    if (!previous) { toast("No previous sound yet"); return; }

    var rendered = SFX.exporter.renderPatch(previous, { oversampling: 8 });
    if (!rendered.mixed.frames) { toast("Previous patch had no enabled sections"); return; }

    var q = SFX.synth.quantize(rendered.mixed.float, rendered.params.sample_size,
      { normalize: false, peak: rendered.mixed.peak });
    if (!SFX.audio.play(SFX.synth.dequantize(q.pcm, q.bits), rendered.params.sample_rate, 1)) {
      toast("Web Audio unavailable");
      return;
    }
    toast("Previous sound");
  }

  /* ---------- preferences ---------- */

  /* ---------- rendering ---------- */
  function cancelFrame() {
    if (!state.frame) { return; }
    if (root.cancelAnimationFrame) { root.cancelAnimationFrame(state.frame); }
    else { root.clearTimeout(state.frame); }
    state.frame = 0;
  }

  function paramsSignature() {
    return patchSignature();
  }

  /* renderAll(force): renders the three sections (each cached on its own
     signature), mixes the enabled ones, then redraws everything. Bails out when
     nothing changed and cancels any queued frame, so one edit = one render. */
  function renderAll(force, oversampling) {
    var os = oversampling || 8;
    cancelFrame();

    var signature = paramsSignature() + "@" + os;
    if (!force && state.rendered && signature === state.signature) {
      syncPanels();
      return;
    }

    try {
      var renders = [], i, key, layer;

      for (i = 0; i < SECTION_COUNT; i++) {
        key = sectionSignature(state.sections[i]) + "@" + os;
        if (state.layerKeys[i] !== key || !state.layers[i]) {
          state.layers[i] = SFX.synth.render(state.sections[i], { oversampling: os });
          state.layerKeys[i] = key;
        }
        renders.push(state.layers[i]);
      }

      var mixed = SFX.mix.combine(renders, state.enabled);
      state.rendered = mixed;
      state.renderOS = os;
      state.preview = mixed.frames
        ? SFX.synth.quantize(mixed.float, state.sections[0].sample_size,
            { normalize: false, peak: mixed.peak })
        : null;
      state.signature = signature;

      syncPanels();
      draw();
      updateStats();
      syncChips();
    } catch (err) {
      if (root.console && root.console.error) { root.console.error("8bitFX: render failed", err); }
      toast("Render failed — keeping the last sound");
    }
  }

  /* Longest enabled section decides the preview quality while dragging. */
  function previewOversampling() {
    var longest = 0, i, k;

    for (i = 0; i < SECTION_COUNT; i++) {
      if (!state.enabled[i]) { continue; }
      k = SFX.params.toKnobsCoerced(state.sections[i]);
      longest = Math.max(longest, k.attack + k.sustain + k.decay);
    }

    if (longest > 1.2) { return 2; }
    if (longest > 0.6) { return 4; }
    return 8;
  }

  /* A drag can leave a reduced-oversampling preview in `state.rendered`. Anything
     the user hears on purpose or saves must come from the full-quality render. */
  function ensureFullQuality() {
    if (state.rendered && state.renderOS !== 8) {
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
    if (!els.canvas) { return; }
    if (state.rendered) {
      SFX.ui.drawWaveform(els.canvas, state.rendered.float, state.rendered.peak, state.canvasSize);
    }
    drawSectionScopes();
  }

  function drawSectionScopes() {
    for (var i = 0; i < panels.length; i++) {
      var layer = state.layers[i];
      SFX.ui.drawWaveform(panels[i].canvas, layer ? layer.float : null, layer ? layer.peak : 1);
    }
  }

  /* measured once per layout change instead of once per frame */
  function measureCanvas() {
    if (!els.canvas || !els.canvas.getBoundingClientRect) { return; }
    var rect = els.canvas.getBoundingClientRect();
    state.canvasSize = { width: rect.width, height: rect.height };
  }

  function updateStats() {
    var r = state.rendered;
    if (!r || !els.duration) { return; }

    var p = state.sections[0];
    var bytes = 44 + r.frames * (p.sample_size / 8);
    var clipped = state.preview ? state.preview.clipped : 0;
    var significant = r.frames > 0 && clipped > r.frames * CLIP_RATIO;
    var capped = false, i;

    for (i = 0; i < SECTION_COUNT; i++) {
      if (state.enabled[i] && state.layers[i] && state.layers[i].capped) { capped = true; }
    }

    els.duration.textContent = Math.round(r.duration * 1000) + " ms";
    els.samples.textContent = String(r.frames);
    els.size.textContent = bytes < 1024 ? (bytes + " B") : ((bytes / 1024).toFixed(1) + " kB");
    els.clipped.textContent = String(clipped);
    els.clipHint.hidden = !significant;
    if (els.scopeEmpty) {
      els.scopeEmpty.hidden = (r.frames > 0);
      els.scopeEmpty.textContent = "No sections enabled \u2014 tick a box";
    }
    if (els.capHint) { els.capHint.hidden = !capped; }
  }

  function writeHash() {
    var code = "#" + SFX.codec.encodePatch(patch());
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
  function onInput(index, key, value) {
    if (!state.editSnapshot) { state.editSnapshot = snapshot(); }
    state.sections[index][key] = value;
    state.focus = index;
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
  function patchJson() {
    return {
      format: "8bitfx-layers",
      version: 2,
      name: state.names[state.focus],
      enabled: state.enabled,
      sections: state.sections.map(SFX.params.serialize)
    };
  }

  function exportWav() {
    if (!state.rendered || !state.rendered.frames) {
      toast("Enable a section first");
      return;
    }
    var out = SFX.exporter.toWavPatch(patch(), { normalize: state.normalize });
    download(new Blob([out.bytes], { type: "audio/wav" }), fileName("wav"));
    toast("WAV " + (out.byteLength / 1024).toFixed(1) + " kB" +
      (out.clipped ? " (clipped)" : ""));
  }

  function exportJson() {
    var json = JSON.stringify(patchJson(), null, 2);
    download(new Blob([json], { type: "application/json" }), fileName("json"));
    toast("Patch saved");
  }

  function importJson(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(String(reader.result)); }
      catch (e) { toast("Not valid JSON"); return; }

      if (data && data.format === "8bitfx-layers" && data.sections) {
        pushUndo(snapshot());
        acceptPatch(data);
        renderAll(true, 8);
        writeHash();
        play();
        toast("Patch loaded");
        return;
      }

      if (!SFX.io.looksLikeSoundParams(data, SFX.params.byKey)) {
        toast("That JSON doesn't look like a sound");
        return;
      }
      applyTo(state.focus, SFX.params.coerce(data), "loaded");
      play();
      toast("Section loaded");
    };
    reader.onerror = function () { toast("Could not read file"); };
    reader.readAsText(file);
  }

  function copyJson() {
    copyText(JSON.stringify(patchJson(), null, 2), "Patch copied");
  }

  function copyLink() {
    var base = String(root.location.href).split("#")[0];
    copyText(base + "#" + SFX.codec.encodePatch(patch()), "Link copied");
  }

  /* ---------- sound bank ---------- */
  function refreshBank() {
    var grid = $("bank-grid");
    if (!grid) { return; }
    SFX.ui.renderBank(grid, SFX.bank.all(), {
      load: function (entry) {
        pushUndo(snapshot());
        acceptPatch(entry.patch || entry.params);
        state.names[0] = entry.name;
        renderAll(true, 8);
        writeHash();
        play();
      },
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
    var name = nextBankName(state.names[state.focus]);
    var entry = SFX.bank.add(patch(), name);
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
        var out = SFX.exporter.toWavPatch(entry.patch, { normalize: state.normalize });
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
          applyTo(state.batchTarget, state.batch[index], state.names[state.batchTarget]);
          playSection(state.batchTarget);
        });
        grid.appendChild(btn);
      }(i));
    }
  }

  function rollBatch() {
    var generator = SFX.presets.GENERATORS[state.names[state.batchTarget]]
      ? state.names[state.batchTarget]
      : "random";
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

  /* ---------- sections ---------- */
  function toggleSection(index, on) {
    if (state.enabled[index] === !!on) { return; }
    pushUndo(snapshot());
    state.enabled[index] = !!on;
    renderAll(true, 8);
    writeHash();
    if (!state.rendered.frames) { toast("No sections enabled"); }
  }

  function syncPanels() {
    for (var i = 0; i < panels.length; i++) {
      panels[i].sync({
        params: state.sections[i],
        name: state.names[i],
        enabled: state.enabled[i],
        focus: i === state.focus
      });
    }
  }

  /* whatever you touch becomes the panel that G / M / 1-4 act on */
  function trackFocus(event) {
    var node = event.target;

    while (node && node !== doc.body) {
      if (node.getAttribute && node.getAttribute("data-section") !== null) {
        var index = Number(node.getAttribute("data-section"));
        if (index >= 0 && index < SECTION_COUNT && index !== state.focus) {
          state.focus = index;
          syncPanels();
        }
        return;
      }
      node = node.parentNode;
    }
  }

  function setBatchTarget(index) {
    state.batchTarget = Math.max(0, Math.min(SECTION_COUNT - 1, index));

    var chips = doc.querySelectorAll("#batch-target .target-chip");
    for (var i = 0; i < chips.length; i++) {
      var on = Number(chips[i].getAttribute("data-target")) === state.batchTarget;
      chips[i].className = "target-chip" + (on ? " is-on" : "");
    }
  }

  /* ---------- bindings ---------- */
  function syncChips() {
    var p = state.sections[0] || SFX.params.defaults(0);
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
    if ($("btn-roll-all")) { $("btn-roll-all").addEventListener("click", rollAll); }
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

    var targets = doc.querySelectorAll("#batch-target .target-chip");
    for (i = 0; i < targets.length; i++) {
      el = targets[i];
      (function (chip) {
        chip.addEventListener("click", function () {
          setBatchTarget(Number(chip.getAttribute("data-target")));
        });
      }(el));
    }

    doc.addEventListener("focusin", trackFocus);
    doc.addEventListener("pointerdown", trackFocus);

    $("file-input").addEventListener("change", function () {
      var file = this.files && this.files[0];
      if (file) { importJson(file); }
      this.value = "";
    });

    list = doc.querySelectorAll("#rate-chips input");
    for (i = 0; i < list.length; i++) {
      el = list[i];
      (function (input) {
        input.addEventListener("change", function () {
          var rate = Number(input.value);
          changeSetting(function () {
            eachSection(function (section) { section.sample_rate = rate; });
          });
        });
      }(el));
    }

    list = doc.querySelectorAll("#bits-chips input");
    for (i = 0; i < list.length; i++) {
      el = list[i];
      (function (input) {
        input.addEventListener("change", function () {
          var depth = Number(input.value);
          changeSetting(function () {
            eachSection(function (section) { section.sample_size = depth; });
          });
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
        changeSetting(function () { activeParams().wave_type = index; });
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
      redo: redo,
      toggleSection: toggleSection
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
    var restored = hash ? SFX.codec.decodePatch(hash) : null;

    /* optional ?preset=laserShoot&rate=8000&bits=16 deep links */
    var search = String(root.location.search || "");
    var requested = null;
    var match = /[?&]preset=([a-zA-Z]+)/.exec(search);
    if (match && SFX.presets.GENERATORS[match[1]]) { requested = match[1]; }

    if (restored) {
      acceptPatch(restored);
      state.names[0] = "sound";
    } else {
      var preset = requested || "random";
      var base = SFX.presets.make(preset, SFX.rng.newSeed());
      var s;

      state.sections = [];
      for (s = 0; s < SECTION_COUNT; s++) {
        state.sections.push(s === 0 ? base : SFX.params.clone(base));
      }
      state.enabled = [true, false, false];
      state.names = [preset, "Section 2", "Section 3"];
      state.focus = 0;
    }

    /* sample-rate / bit-depth overrides apply to every section */
    var rateMatch = /[?&]rate=(\d+)/.exec(search);
    if (rateMatch) {
      var rate = Number(rateMatch[1]);
      if (rate >= SFX.params.RATE_MIN && rate <= SFX.params.RATE_MAX) {
        eachSection(function (section) { section.sample_rate = rate; });
      }
    }
    var bitsMatch = /[?&]bits=(\d+)/.exec(search);
    if (bitsMatch) {
      var depth = (Number(bitsMatch[1]) === 16) ? 16 : 8;
      eachSection(function (section) { section.sample_size = depth; });
    }

    var container = $("section-panels");
    panels = [];
    for (var pi = 0; pi < SECTION_COUNT; pi++) {
      panels.push(SFX.ui.buildSectionPanel(container, pi, {
        input: onInput,
        commit: onCommit,
        rename: renameSection,
        preset: applyPreset,
        mutate: mutateSection,
        play: playSection,
        toggle: toggleSection
      }));
    }

    bind();
    measureCanvas();
    syncChips();
    setBatchTarget(0);
    syncPanels();
    renderAll(true, 8);
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
