/* 8bitFX — parameter panel + oscilloscope drawing. */
(function (root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.SFX = root.SFX || {};
  root.SFX.ui = api;
}(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this), function (root) {
  "use strict";

  var WAVE_LABELS = ["Square", "Saw", "Sine", "Noise"];
  var PRESET_LABELS = {
    pickupCoin: "Pickup / Coin", laserShoot: "Laser / Shoot", explosion: "Explosion",
    powerUp: "Power-Up", hitHurt: "Hit / Hurt", jump: "Jump", blipSelect: "Blip / Select",
    synth: "Synth", tone: "Tone", random: "Random"
  };

  function P() { return root.SFX.params; }

  /* slider position (0..1000) <-> parameter value, honouring each knob's curve */
  function toSlider(def, value) {
    var t;
    if (def.signed) {
      var s = value < 0 ? -1 : 1;
      t = (s * Math.pow(Math.abs(value), 1 / def.curve) + 1) / 2;
    } else {
      t = Math.pow(Math.max(0, value), 1 / def.curve);
    }
    if (!isFinite(t)) { t = 0; }
    return Math.round(Math.max(0, Math.min(1, t)) * 1000);
  }

  function fromSlider(def, slider) {
    var t = Math.max(0, Math.min(1000, slider)) / 1000;
    if (def.signed) {
      var u = t * 2 - 1;
      return (u < 0 ? -1 : 1) * Math.pow(Math.abs(u), def.curve);
    }
    return Math.pow(t, def.curve);
  }

  function buildWaves(host, handlers, prefix) {
    var wrap = document.createElement("div");
    wrap.className = "waves";
    var inputs = [];
    var w, id, input, label;

    prefix = prefix || "";

    for (w = 0; w < 4; w++) {
      id = prefix + "wave-" + w;
      input = document.createElement("input");
      input.type = "radio";
      input.name = prefix + "wave_type";
      input.id = id;
      input.value = String(w);
      label = document.createElement("label");
      label.setAttribute("for", id);
      label.textContent = WAVE_LABELS[w];
      (function (value) {
        input.addEventListener("change", function () {
          handlers.onInput("wave_type", value);
          handlers.onCommit();
        });
      }(w));
      wrap.appendChild(input);
      wrap.appendChild(label);
      inputs.push(input);
    }
    host.appendChild(wrap);
    return { type: "wave", inputs: inputs };
  }

  function buildRow(host, def, handlers, prefix) {
    var row = document.createElement("div");
    row.className = "row";

    var id = (prefix || "") + "p-" + def.key;
    var label = document.createElement("label");
    label.setAttribute("for", id);
    label.textContent = def.label;

    var out = document.createElement("output");
    out.id = (prefix || "") + "out-" + def.key;
    out.setAttribute("for", id);
    out.textContent = "\u2014";

    var input = document.createElement("input");
    input.type = "range";
    input.id = id;
    input.min = "0";
    input.max = "1000";
    input.step = "1";
    input.setAttribute("aria-label", def.label);
    input.setAttribute("aria-describedby", out.id);
    input.addEventListener("input", function () {
      handlers.onInput(def.key, fromSlider(def, Number(input.value)));
    });
    input.addEventListener("change", function () { handlers.onCommit(); });
    input.addEventListener("dblclick", function () {
      input.value = String(toSlider(def, def.def));
      handlers.onInput(def.key, def.def);
      handlers.onCommit();
    });

    row.appendChild(label);
    row.appendChild(out);
    row.appendChild(input);
    host.appendChild(row);

    return { type: "range", def: def, input: input, out: out };
  }

  function buildSwitch(host, def, handlers, prefix) {
    var row = document.createElement("div");
    row.className = "row row-switch";

    var id = (prefix || "") + "sw-" + def.key;
    var label = document.createElement("label");
    label.setAttribute("for", id);
    label.textContent = def.label;

    var out = document.createElement("output");
    out.id = (prefix || "") + "out-" + def.key;
    out.setAttribute("for", id);
    out.textContent = "\u2014";

    var input = document.createElement("input");
    input.type = "checkbox";
    input.id = id;
    input.setAttribute("aria-describedby", out.id);
    input.addEventListener("change", function () {
      handlers.onInput(def.key, input.checked ? 1 : 0);
      handlers.onCommit();
    });

    row.appendChild(label);
    row.appendChild(out);
    row.appendChild(input);
    host.appendChild(row);

    return { type: "switch", def: def, input: input, out: out };
  }

  /* Every control for one section, in always-open group blocks.
     handlers = { input(index, key, value), commit() } */
  function buildControls(host, index, handlers, prefix) {
    var api = P();
    var controls = {};
    var bodies = {};
    var i, d, name, block, heading, body;

    for (i = 0; i < api.GROUPS.length; i++) {
      name = api.GROUPS[i];
      block = document.createElement("section");
      block.className = "group-block";
      heading = document.createElement("h3");
      heading.textContent = name;
      block.appendChild(heading);
      body = document.createElement("div");
      body.className = "group-body";
      block.appendChild(body);
      bodies[name] = body;
      host.appendChild(block);
    }

    var local = {
      onInput: function (key, value) { handlers.input(index, key, value); },
      onCommit: function () { handlers.commit(); }
    };

    for (i = 0; i < api.DEFS.length; i++) {
      d = api.DEFS[i];
      if (!bodies[d.group]) { continue; }
      if (d.type === "wave") {
        controls[d.key] = buildWaves(bodies[d.group], local, prefix);
      } else if (d.type === "switch") {
        controls[d.key] = buildSwitch(bodies[d.group], d, local, prefix);
      } else {
        controls[d.key] = buildRow(bodies[d.group], d, local, prefix);
      }
    }

    function sync(p) {
      var key, c, slider, text, on;
      var knobs = api.toKnobsCoerced(p);

      for (key in controls) {
        if (!controls.hasOwnProperty(key)) { continue; }
        c = controls[key];

        if (c.type === "wave") {
          if (p.wave_type >= 0 && p.wave_type < 4) { c.inputs[p.wave_type].checked = true; }
        } else if (c.type === "switch") {
          on = !!p[key];
          if (c.input.checked !== on) { c.input.checked = on; }
          text = api.format(key, p, knobs);
          if (c.out.textContent !== text) { c.out.textContent = text; }
        } else {
          slider = toSlider(c.def, p[key]);
          if (c.input.value !== String(slider)) { c.input.value = String(slider); }
          c.input.style.setProperty("--fill", (slider / 10) + "%");
          text = api.format(key, p, knobs);
          if (c.out.textContent !== text) { c.out.textContent = text; }
          if (c.input.getAttribute("aria-valuetext") !== text) {
            c.input.setAttribute("aria-valuetext", text);
          }
        }
      }
    }

    return { controls: controls, sync: sync };
  }

  /* A complete synth window: header, its own waveform, then every parameter.
     handlers = { input, commit, rename, preset, mutate, play, toggle } */
  function buildSectionPanel(container, index, handlers) {
    var presets = root.SFX.presets;
    var panel = document.createElement("section");
    panel.className = "section-panel";
    panel.setAttribute("data-section", String(index));

    var head = document.createElement("header");
    head.className = "section-head";

    var include = document.createElement("label");
    include.className = "section-include";
    include.title = "Include this section in the master mix";

    var box = document.createElement("input");
    box.type = "checkbox";
    box.setAttribute("aria-label", "Include section " + (index + 1) + " in the mix");
    box.addEventListener("change", function () { handlers.toggle(index, box.checked); });

    var badge = document.createElement("span");
    badge.className = "section-badge";
    badge.textContent = String(index + 1);

    include.appendChild(box);
    include.appendChild(badge);

    var nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "section-name";
    nameInput.maxLength = 24;
    nameInput.setAttribute("aria-label", "Section " + (index + 1) + " name");
    nameInput.addEventListener("change", function () { handlers.rename(index, nameInput.value); });

    var preset = document.createElement("select");
    preset.className = "section-preset";
    preset.setAttribute("aria-label", "Load a preset into section " + (index + 1));

    var blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "Preset\u2026";
    preset.appendChild(blank);

    var g, key, opt;
    for (g = 0; g < presets.names.length; g++) {
      key = presets.names[g];
      opt = document.createElement("option");
      opt.value = key;
      opt.textContent = PRESET_LABELS[key] || key;
      preset.appendChild(opt);
    }
    preset.addEventListener("change", function () {
      if (!preset.value) { return; }
      handlers.preset(index, preset.value);
      preset.value = "";
    });

    var mutate = document.createElement("button");
    mutate.type = "button";
    mutate.className = "section-icon";
    mutate.textContent = "\u2733";
    mutate.title = "Mutate section " + (index + 1);
    mutate.setAttribute("aria-label", "Mutate section " + (index + 1));
    mutate.addEventListener("click", function () { handlers.mutate(index); });

    var play = document.createElement("button");
    play.type = "button";
    play.className = "section-icon";
    play.textContent = "\u25B6";
    play.title = "Play section " + (index + 1);
    play.setAttribute("aria-label", "Play section " + (index + 1));
    play.addEventListener("click", function () { handlers.play(index); });

    head.appendChild(include);
    head.appendChild(nameInput);
    head.appendChild(preset);
    head.appendChild(mutate);
    head.appendChild(play);

    var canvas = document.createElement("canvas");
    canvas.className = "section-wave";
    canvas.width = 420;
    canvas.height = 90;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Section " + (index + 1) + " waveform");

    var body = document.createElement("div");
    body.className = "section-body";

    panel.appendChild(head);
    panel.appendChild(canvas);
    panel.appendChild(body);
    container.appendChild(panel);

    var built = buildControls(body, index, handlers, "s" + (index + 1) + "-");

    return {
      canvas: canvas,
      sync: function (view) {
        built.sync(view.params);
        if (nameInput.value !== view.name) { nameInput.value = view.name; }
        if (box.checked !== !!view.enabled) { box.checked = !!view.enabled; }
        panel.className = "section-panel" +
          (view.enabled ? "" : " is-muted") +
          (view.focus ? " is-focus" : "");
      }
    };
  }

  /* Bank strip: name + delete per entry. handlers = { load(entry), remove(entry) } */
  function renderBank(container, entries, handlers) {
    while (container.firstChild) { container.removeChild(container.firstChild); }

    if (!entries.length) {
      var empty = document.createElement("p");
      empty.className = "bank-empty";
      empty.textContent = "Saved sounds appear here";
      container.appendChild(empty);
      return;
    }

    function tile(entry) {
      var row = document.createElement("div");
      row.className = "bank-tile";

      var load = document.createElement("button");
      load.type = "button";
      load.className = "bank-load";
      load.textContent = entry.name;
      load.title = "Load " + entry.name;
      load.addEventListener("click", function () { handlers.load(entry); });

      var del = document.createElement("button");
      del.type = "button";
      del.className = "bank-del";
      del.setAttribute("aria-label", "Delete " + entry.name);
      del.textContent = "\u00D7";
      del.addEventListener("click", function () { handlers.remove(entry); });

      row.appendChild(load);
      row.appendChild(del);
      return row;
    }

    for (var i = 0; i < entries.length; i++) {
      container.appendChild(tile(entries[i]));
    }
  }


  /* Oscilloscope: min/max envelope per pixel column, snapped to whole pixels
     so it reads like a chunky 8-bit screen. */
  function drawWaveform(canvas, samples, peak, size) {
    if (!canvas) { return; }
    var dpr = root.devicePixelRatio || 1;
    var cssW, cssH;

    if (size && size.width > 0 && size.height > 0) {
      cssW = Math.round(size.width);
      cssH = Math.round(size.height);
    } else {
      var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
      cssW = Math.max(1, Math.round((rect && rect.width) || canvas.width || 600));
      cssH = Math.max(1, Math.round((rect && rect.height) || canvas.height || 260));
    }

    var w = Math.round(cssW * dpr);
    var h = Math.round(cssH * dpr);

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    var g = canvas.getContext("2d");
    g.clearRect(0, 0, w, h);

    var mid = Math.round(h / 2);
    g.strokeStyle = "rgba(70,255,166,0.16)";
    g.lineWidth = Math.max(1, Math.round(dpr));
    g.beginPath();
    g.moveTo(0, mid + 0.5);
    g.lineTo(w, mid + 0.5);
    g.stroke();

    if (!samples || !samples.length) { return; }

    var amp = Math.max(0.0001, peak || 0);
    var scale = (h * 0.46) / amp;
    var perCol = samples.length / w;
    var x, start, end, min, max, j, y1, y2;

    g.strokeStyle = "#46ffa6";
    g.beginPath();
    for (x = 0; x < w; x++) {
      start = Math.floor(x * perCol);
      end = Math.floor((x + 1) * perCol);
      if (end <= start) { end = start + 1; }
      min = 1; max = -1;
      for (j = start; j < end && j < samples.length; j++) {
        if (samples[j] < min) { min = samples[j]; }
        if (samples[j] > max) { max = samples[j]; }
      }
      if (min > max) { continue; }
      y1 = Math.round(mid - max * scale);
      y2 = Math.round(mid - min * scale);
      if (y1 === y2) { y2 = y1 + 1; }
      g.moveTo(x + 0.5, y1);
      g.lineTo(x + 0.5, y2);
    }
    g.stroke();
  }

  return {
    buildSectionPanel: buildSectionPanel,
    drawWaveform: drawWaveform,
    renderBank: renderBank,
    toSlider: toSlider,
    fromSlider: fromSlider,
    WAVE_LABELS: WAVE_LABELS
  };
}));
