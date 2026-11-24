/* 8bitFX — in-app self check (?selftest=1).
   Exercises the wiring unit tests can't reach — chips, history, permalinks, the
   preview-quality guard, export, preferences, the bank and the ZIP writer — and
   writes a report into the DOM so a headless browser (test.cmd) can read it.

   ctx: { doc, state, $, renderAll, ensureFullQuality, changeSetting, undo, redo } */
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

    check("panel built with 23 sliders and 2 switches", function () {
      var ranges = doc.querySelectorAll('#param-groups input[type="range"]').length;
      var toggles = doc.querySelectorAll('#param-groups input[type="checkbox"]').length;
      assert(ranges === 23, "sliders: " + ranges);
      assert(toggles === 2, "switches: " + toggles);
    });

    check("rate/depth chips follow the parameters", function () {
      ctx.changeSetting(function () {
        state.params.sample_rate = 22050;
        state.params.sample_size = 16;
      });
      assert($("rate-22050").checked, "22k chip not selected");
      assert($("bits-16").checked, "16 bit chip not selected");
      assert(state.rendered.sampleRate === 22050, "render ignored the new rate");
    });

    check("custom sample rate is reflected in the legend", function () {
      ctx.changeSetting(function () { state.params.sample_rate = 48000; });
      var legend = $("rate-legend");
      assert(legend && /48/.test(legend.textContent), "legend not updated");
      assert(doc.querySelectorAll("#rate-chips input:checked").length === 0,
        "a preset chip should not be selected for 48 kHz");

      ctx.changeSetting(function () { state.params.sample_rate = 44100; });
      assert(/^Sample rate$/.test($("rate-legend").textContent), "legend not restored");
    });

    check("undo then redo restores the format", function () {
      ctx.undo();
      assert(state.params.sample_rate !== 44100 || state.params.sample_size !== 16,
        "undo did not roll back");
      ctx.redo();
      assert(state.params.sample_rate === 22050 || state.params.sample_rate === 44100,
        "redo did not restore the rate (got " + state.params.sample_rate +
        ", redo stack " + state.redo.length + ", undo stack " + state.undo.length + ")");
    });

    check("permalink round-trips through the app", function () {
      var back = SFX.codec.decode(SFX.codec.encode(state.params));
      assert(back, "decode failed");
      assert(Math.abs(back.p_base_freq - state.params.p_base_freq) < 0.005, "base freq lost");
      assert(back.sample_rate === state.params.sample_rate, "rate lost");
      assert(back.sample_size === state.params.sample_size, "depth lost");
    });

    check("a reduced preview is upgraded before export", function () {
      ctx.renderAll(false, 2);
      assert(state.rendered.oversampling === 2, "preview was not reduced");
      ctx.ensureFullQuality();
      assert(state.rendered.oversampling === 8, "quality guard did not upgrade");
    });

    check("WAV export produces a valid header", function () {
      var exported = SFX.exporter.toWav(state.params, { normalize: state.normalize });
      var view = new DataView(exported.bytes.buffer);
      assert(view.getUint32(0, true) === 0x46464952, "not a RIFF file");
      assert(view.getUint32(24, true) === state.params.sample_rate, "wrong rate in header");
      assert(view.getUint16(34, true) === state.params.sample_size, "wrong depth in header");
      assert(exported.byteLength === 44 + exported.frames * (state.params.sample_size / 8),
        "wrong byte length");
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

    check("bank saves, lists and removes a sound", function () {
      SFX.bank.useStorage(memoryStorage());
      var entry = SFX.bank.add(state.params, "selftest");
      assert(entry, "bank.add failed");
      var list = SFX.bank.all();
      assert(list.length === 1, "expected one entry, got " + list.length);
      assert(list[0].name === "selftest", "entry not listed first");
      SFX.bank.remove(entry.id);
      assert(SFX.bank.all().length === 0, "entry not removed");
      SFX.bank.useStorage(null);
    });

    check("zip pack of one WAV is well formed", function () {
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
