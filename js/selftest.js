/* 8bitFX — in-app self check (?selftest=1).
   Exercises the wiring unit tests can't reach — section cards, mixing, history,
   permalinks, preferences, the bank and the ZIP writer — and writes a report into
   the DOM so a headless browser (test.cmd) can read it.

   ctx: { doc, state, $, renderAll, ensureFullQuality, changeSetting, undo, redo,
          toggleSection } */
(function (root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.SFX = root.SFX || {};
  root.SFX.selftest = api;
}(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this), function (root) {
  "use strict";

  function memoryStorage() {
    return {
      data: {},
      getItem: function (key) { return this.data[key] === undefined ? null : this.data[key]; },
      setItem: function (key, value) { this.data[key] = String(value); },
      removeItem: function (key) { delete this.data[key]; }
    };
  }

  function run(ctx) {
    var SFX = root.SFX;
    var doc = ctx.doc;
    var state = ctx.state;
    var $ = ctx.$;
    var out = [];

    function check(name, fn) {
      try {
        var detail = fn();
        out.push({ name: name, ok: true, detail: detail ? String(detail) : "" });
      } catch (e) {
        out.push({ name: name, ok: false, detail: String((e && e.message) || e) });
      }
    }

    function assert(cond, message) {
      if (!cond) { throw new Error(message || "assertion failed"); }
    }

    function approx(actual, expected, tolerance, message) {
      if (!(Math.abs(actual - expected) <= tolerance)) {
        throw new Error((message || "out of range") + " (got " + actual +
          ", expected " + expected + ")");
      }
    }

    check("three parameter windows, each fully populated", function () {
      var panels = doc.querySelectorAll("#section-panels .section-panel");
      var ranges = doc.querySelectorAll("#section-panels input[type='range']").length;
      var toggles = doc.querySelectorAll("#section-panels input[type='checkbox']").length;
      var radios = doc.querySelectorAll("#section-panels input[type='radio']").length;
      var waves = doc.querySelectorAll("#section-panels canvas").length;
      var presets = doc.querySelectorAll("#section-panels select").length;

      assert(panels.length === 3, "panels: " + panels.length);
      assert(ranges === 69, "sliders: " + ranges);
      assert(toggles === 9, "switches + include boxes: " + toggles);
      assert(radios === 12, "waveform radios: " + radios);
      assert(waves === 3, "section scopes: " + waves);
      assert(presets === 3, "preset selects: " + presets);
      assert(doc.querySelectorAll("canvas").length === 4, "expected 4 canvases in total");
      return panels.length + " panels, " + ranges + " sliders";
    });

    check("rate/depth chips follow the (shared) format", function () {
      ctx.changeSetting(function () {
        state.sections.forEach(function (section) {
          section.sample_rate = 22050;
          section.sample_size = 16;
        });
      });
      assert($("rate-22050").checked, "22k chip not selected");
      assert($("bits-16").checked, "16 bit chip not selected");
      assert(state.rendered.sampleRate === 22050, "mix ignored the new rate");
      assert(state.sections[2].sample_rate === 22050, "all sections should share the rate");
    });

    check("custom sample rate is reflected in the legend", function () {
      ctx.changeSetting(function () {
        state.sections.forEach(function (section) { section.sample_rate = 48000; });
      });
      var legend = $("rate-legend");
      assert(legend && /48/.test(legend.textContent), "legend not updated");
      assert(doc.querySelectorAll("#rate-chips input:checked").length === 0,
        "a preset chip should not be selected for 48 kHz");

      ctx.changeSetting(function () {
        state.sections.forEach(function (section) { section.sample_rate = 44100; });
      });
      assert(/^Sample rate$/.test($("rate-legend").textContent), "legend not restored");
    });

    check("each panel is bound to its own section", function () {
      var original = state.sections[1].p_base_freq;
      state.sections[1].p_base_freq = 0.99;
      ctx.renderAll(true, 8);

      var one = Number($("s1-p-p_base_freq").value);
      var two = Number($("s2-p-p_base_freq").value);
      assert(two > 900, "panel 2 did not follow section 2 (" + two + ")");
      assert(one < two, "panel 1 should still show section 1 (" + one + ")");

      state.sections[1].p_base_freq = original;
      ctx.renderAll(true, 8);
      return "panels stay independent";
    });

    check("undo then redo restores the format", function () {
      assert(state.sections[0].sample_rate === 44100, "expected 44.1 kHz before undo");

      ctx.undo();
      assert(state.sections[0].sample_rate === 48000, "undo did not restore 48 kHz");
      assert(state.sections[2].sample_rate === 48000, "all sections should follow the undo");

      ctx.redo();
      assert(state.sections[0].sample_rate === 44100, "redo did not restore 44.1 kHz");
      return "48 kHz -> 44.1 kHz restored";
    });

    check("permalink round-trips the whole patch", function () {
      var code = SFX.codec.encodePatch({ sections: state.sections, enabled: state.enabled });
      assert(code.charAt(0) === "4", "expected a v4 payload");

      var back = SFX.codec.decodePatch(code);
      assert(back && back.sections.length === 3, "sections lost");
      assert(back.enabled[0] === state.enabled[0] && back.enabled[1] === state.enabled[1],
        "enabled flags lost");
      approx(back.sections[0].p_base_freq, state.sections[0].p_base_freq, 0.005,
        "section 1 mismatch");
      approx(back.sections[2].p_env_decay, state.sections[2].p_env_decay, 0.005,
        "section 3 mismatch");
    });

    check("a reduced preview is upgraded before export", function () {
      ctx.renderAll(false, 2);
      assert(state.renderOS === 2, "preview was not reduced");
      ctx.ensureFullQuality();
      assert(state.renderOS === 8, "quality guard did not upgrade");
    });

    check("WAV export matches the mix", function () {
      var exported = SFX.exporter.toWavPatch(
        { sections: state.sections, enabled: state.enabled }, { normalize: state.normalize });
      var view = new DataView(exported.bytes.buffer);
      assert(view.getUint32(0, true) === 0x46464952, "not a RIFF file");
      assert(view.getUint32(24, true) === state.sections[0].sample_rate, "wrong rate");
      assert(view.getUint16(34, true) === state.sections[0].sample_size, "wrong depth");
      assert(exported.frames === state.rendered.frames,
        "export length differs from the mix (" + exported.frames + " vs " + state.rendered.frames + ")");
    });

    check("enabling a second section changes the mix", function () {
      ctx.renderAll(true, 8);
      var before = { frames: state.rendered.frames, count: state.rendered.count };
      assert(before.count === 1, "expected one enabled section, got " + before.count);

      ctx.toggleSection(1, true);
      assert(state.enabled[1] === true, "section 2 not enabled");
      assert(state.rendered.count === 2, "mix did not include section 2");
      assert(state.rendered.frames >= before.frames, "mix lost duration");

      ctx.toggleSection(1, false);
      assert(state.rendered.count === 1, "section 2 not disabled again");
      return "count 1 -> 2 -> 1";
    });

    check("panel checkboxes and per-panel scopes are live", function () {
      var panel2 = doc.querySelectorAll("#section-panels .section-panel")[1];
      var box = panel2.querySelector(".section-include input");

      ctx.renderAll(true, 8);
      assert(box.checked === false, "panel 2 box should follow the disabled state");

      var ev = doc.createEvent("HTMLEvents");
      ev.initEvent("change", true, false);

      box.checked = true;
      box.dispatchEvent(ev);
      assert(state.enabled[1] === true, "ticking the box did not enable section 2");
      assert(state.rendered.count === 2, "mix ignored the ticked box");

      var canvases = doc.querySelectorAll("#section-panels canvas");
      var drawn = 0, c, data, n;
      for (var i = 0; i < canvases.length; i++) {
        c = canvases[i];
        data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
        for (n = 3; n < data.length; n += 4) {
          if (data[n] !== 0) { drawn++; break; }
        }
      }
      assert(canvases.length === 3, "expected three section scopes");
      assert(drawn === 3, "only " + drawn + " of 3 section scopes drew anything");

      box.checked = false;
      box.dispatchEvent(ev);
      assert(state.enabled[1] === false, "unticking the box did not disable section 2");
      return "3 scopes drawn, checkbox wiring live";
    });

    check("disabling every section empties the mix", function () {
      ctx.toggleSection(0, false);
      assert(state.rendered.frames === 0, "mix should be empty");
      assert(state.preview === null, "preview should be null");

      ctx.toggleSection(0, true);
      assert(state.rendered.frames > 0, "mix did not come back");
      return "empty mix handled";
    });

    check("preferences round-trip", function () {
      SFX.prefs.useStorage(memoryStorage());
      SFX.prefs.save({ normalize: false, volume: 40, groups: { Tone: false } });
      var prefs = SFX.prefs.load();
      assert(prefs.normalize === false, "normalize not stored");
      assert(prefs.volume === 40, "volume not stored");
      assert(prefs.groups.Tone === false, "group state not stored");
      SFX.prefs.useStorage(null);
    });

    check("viewport metrics", function () {
      return "innerWidth=" + (root.innerWidth || 0) +
        " scrollWidth=" + doc.documentElement.scrollWidth +
        " dpr=" + (root.devicePixelRatio || 1);
    });

    check("no horizontal overflow", function () {
      var docEl = doc.documentElement;
      var width = root.innerWidth || 0;
      if (!width || docEl.scrollWidth <= width + 1) { return; }

      var nodes = doc.querySelectorAll("body *"), offenders = [], i, el;
      for (i = 0; i < nodes.length && offenders.length < 6; i++) {
        el = nodes[i];
        if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2) {
          offenders.push((el.id || el.className || el.tagName) + " " +
            el.scrollWidth + ">" + el.clientWidth);
        }
      }
      assert(false, "page " + docEl.scrollWidth + "px in " + width + "px: " + offenders.join(" | "));
    });

    check("every visible control is labelled", function () {
      var items = doc.querySelectorAll("input, select, textarea"), bad = [], i, el, id, labelled;
      for (i = 0; i < items.length; i++) {
        el = items[i];
        if (el.type === "hidden" || el.hidden) { continue; }
        id = el.id;
        labelled = !!el.getAttribute("aria-label") ||
          (!!id && !!doc.querySelector('label[for="' + id + '"]')) ||
          (!!el.parentNode && el.parentNode.tagName === "LABEL");
        if (!labelled) { bad.push(id || (el.tagName + ":" + el.type)); }
      }
      assert(bad.length === 0, "unlabelled: " + bad.join(", "));
    });

    check("no duplicate element ids", function () {
      var nodes = doc.querySelectorAll("[id]"), seen = {}, dupes = [], i, id;
      for (i = 0; i < nodes.length; i++) {
        id = nodes[i].id;
        if (seen[id]) { dupes.push(id); } else { seen[id] = 1; }
      }
      assert(dupes.length === 0, "duplicates: " + dupes.join(", "));
    });

    check("bank saves a patch and lists it", function () {
      SFX.bank.useStorage(memoryStorage());
      var entry = SFX.bank.add({ sections: state.sections, enabled: state.enabled }, "selftest");
      assert(entry && entry.patch.sections.length === 3, "patch not stored");

      var list = SFX.bank.all();
      assert(list.length === 1 && list[0].name === "selftest", "entry not listed");
      assert(list[0].patch.enabled[0] === state.enabled[0], "flags lost");
      approx(list[0].patch.sections[1].p_base_freq, state.sections[1].p_base_freq, 1e-9,
        "section 2 not stored verbatim");

      SFX.bank.remove(entry.id);
      assert(SFX.bank.all().length === 0, "entry not removed");
      SFX.bank.useStorage(null);
    });

    check("zip pack of one patch is well formed", function () {
      var wav = SFX.wav.encode(new Uint8Array(64), { sampleRate: 8000, bits: 8 });
      var bytes = SFX.zip.create([{ name: "a.wav", data: new Uint8Array(wav.buffer) }]);
      var view = new DataView(bytes.buffer);
      assert(view.getUint32(0, true) === 0x04034b50, "missing local header");
      var eocd = bytes.length - 22;
      assert(view.getUint32(eocd, true) === 0x06054b50, "missing EOCD");
      assert(view.getUint16(eocd + 10, true) === 1, "wrong entry count");
    });

    var failed = 0, i;
    for (i = 0; i < out.length; i++) { if (!out[i].ok) { failed++; } }

    var report = doc.createElement("pre");
    report.id = "selftest";
    report.textContent = "SELFTEST " + (failed ? "FAILED" : "OK") + "\n" +
      JSON.stringify({ passed: out.length - failed, failed: failed, checks: out }, null, 2);
    doc.body.appendChild(report);

    if (root.console && root.console.log) { root.console.log("8bitFX selftest", out); }

    return { passed: out.length - failed, failed: failed };
  }

  return { run: run };
}));
