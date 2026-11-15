"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "Arabic PDF Form Maker.html"), "utf8");

function scriptContaining(marker) {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const script = scripts.find((s) => s.includes(marker));
  assert(script, `Could not find script containing ${marker}`);
  return script;
}

const pdfContext = { self: {}, console, setTimeout, clearTimeout };
pdfContext.globalThis = pdfContext;
vm.createContext(pdfContext);
vm.runInContext(scriptContaining("pdf-lib.min.js.map"), pdfContext, { timeout: 15000 });
const PDFLib = pdfContext.PDFLib || pdfContext.self.PDFLib;
assert(PDFLib && PDFLib.PDFDocument, "Embedded pdf-lib did not load");

const assetScript = scriptContaining("var AF_WORKER_B64");
const assetMatch = assetScript.match(/var AF_ASSETS=(\{[\s\S]*\});\s*$/);
assert(assetMatch, "Could not extract AF_ASSETS");
const AF_ASSETS = vm.runInContext(`(${assetMatch[1]})`, pdfContext);

const coreModule = { exports: {} };
pdfContext.module = coreModule;
pdfContext.exports = coreModule.exports;
pdfContext.Buffer = Buffer;
vm.runInContext(scriptContaining("Arabic PDF Form Maker - core logic"), pdfContext);
const AFCore = coreModule.exports;

// Compile the browser UI independently. DOM behavior is exercised manually; this
// catches accidental syntax errors without needing a browser dependency.
new vm.Script(scriptContaining("Arabic PDF Form Maker - user interface"));

function testNormalization() {
  const result = AFCore.normalizeModel([
    { page: 0, type: "radio", rect: [10, 10, 20, 20], groupId: 7, mark: "dot", choiceValue: "same" },
    { page: 0, type: "check", rect: [30, 10, 40, 20], groupId: 7, mark: "tick", choiceValue: "same" },
    { page: 9, type: "text", rect: [0, 0, 10, 10] },
    { page: 0, type: "text", rect: [20, 20, 10, 10] }
  ], { 7: { mode: "one", mark: "dot", required: true } }, 1);
  assert.strictEqual(result.fields.length, 2, "invalid fields should be skipped");
  assert(result.fields.every((f) => f.type === "radio"), "group mode should be authoritative");
  assert.notStrictEqual(result.fields[0].choiceValue, result.fields[1].choiceValue, "radio export values must be unique");
  assert(result.warnings.some((w) => /invalid page or rectangle/.test(w)));
}

function testExistingClassification() {
  const rect = [10, 20, 30, 40];
  assert.strictEqual(AFCore.classifyExistingAnnotation({ subtype: "Widget", rect, fieldType: "Tx" }).type, "text");
  assert.strictEqual(AFCore.classifyExistingAnnotation({ subtype: "Widget", rect, fieldType: "Btn", checkBox: true }).type, "check");
  assert.strictEqual(AFCore.classifyExistingAnnotation({ subtype: "Widget", rect, fieldType: "Btn", radioButton: true }).type, "radio");
  assert.strictEqual(AFCore.classifyExistingAnnotation({ subtype: "Widget", rect, fieldType: "Btn", pushButton: true }).editable, false);
  assert.strictEqual(AFCore.classifyExistingAnnotation({ subtype: "Widget", rect, fieldType: "Ch" }).editable, false);
  assert.strictEqual(AFCore.classifyExistingAnnotation({ subtype: "Widget", rect, fieldType: "Sig" }).editable, false);
  assert.strictEqual(AFCore.classifyExistingAnnotation({ subtype: "Link", rect, fieldType: "Tx" }), null);
}

function syntheticRegions() {
  const W = 90, H = 45, data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([255, 255, 255, 255], i * 4);
  const ink = (x, y) => data.set([0, 0, 0, 255], (y * W + x) * 4);
  for (let x = 8; x <= 21; x++) { ink(x, 8); ink(x, 21); }
  for (let y = 8; y <= 21; y++) { ink(8, y); ink(21, y); }
  const cx = 48, cy = 20, radius = 11;
  for (let y = cy - radius - 1; y <= cy + radius + 1; y++) {
    for (let x = cx - radius - 1; x <= cx + radius + 1; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d >= radius - 1.5 && d <= radius + 1.5) ink(x, y);
    }
  }
  return AFCore.detectRegions(data, W, H, 1);
}

async function testPdfWriting() {
  const source = await PDFLib.PDFDocument.create();
  source.addPage(); source.addPage();
  const bytes = await source.save({ useObjectStreams: false });
  const fields = [
    { page: 0, type: "text", rect: [200, 440, 370, 465], label: "RTL", size: 10 },
    { page: 0, type: "text", rect: [20, 400, 190, 425], label: "LTR", size: 10, ltr: true, required: true },
    { page: 0, type: "check", rect: [340, 350, 354, 364], mark: "tick", choiceValue: "a" },
    { page: 0, type: "check", rect: [310, 350, 324, 364], mark: "cross", choiceValue: "b", required: true },
    { page: 0, type: "check", rect: [280, 350, 294, 364], mark: "dot", choiceValue: "c", groupId: 2 },
    { page: 0, type: "radio", rect: [340, 300, 354, 314], mark: "dot", choiceValue: "first", groupId: 1 },
    { page: 1, type: "radio", rect: [340, 440, 354, 454], mark: "dot", choiceValue: "second", groupId: 1 },
    { page: 1, type: "radio", rect: [300, 400, 314, 414], mark: "dot", choiceValue: "only", groupId: 3 }
  ];
  const groups = {
    1: { mode: "one", mark: "dot", required: true, label: "Choose one" },
    2: { mode: "several", mark: "dot" },
    3: { mode: "one", mark: "dot" }
  };
  const built = await AFCore.buildForm(bytes, fields, { tint: true, groups }, PDFLib, AF_ASSETS);
  assert(built.bytes.length > bytes.length, "output should contain form resources");
  assert(built.warnings.some((w) => /only one button/.test(w)), "singleton radio group should warn");

  const output = await PDFLib.PDFDocument.load(built.bytes);
  const form = output.getForm();
  const all = form.getFields();
  const radios = all.filter((f) => f instanceof PDFLib.PDFRadioGroup);
  const checks = all.filter((f) => f instanceof PDFLib.PDFCheckBox);
  const texts = all.filter((f) => f instanceof PDFLib.PDFTextField);
  assert.strictEqual(radios.length, 2);
  assert.strictEqual(checks.length, 3);
  assert.strictEqual(texts.length, 2);
  const spanning = radios.find((r) => r.getOptions().length === 2);
  assert(spanning, "two-page radio group should expose both choices");
  assert.deepStrictEqual([...spanning.getOptions()].sort(), ["first", "second"]);
  spanning.select("second");
  assert.strictEqual(spanning.getSelected(), "second");
  assert(checks.some((c) => /ar_group_/.test(c.getName())), "grouped checkbox should have a related flat name");

  const ltr = texts.find((t) => t.getName() === "ar_text_2");
  assert(ltr, "LTR field not found");
  const dict = ltr.acroField.dict;
  assert.strictEqual(dict.lookup(PDFLib.PDFName.of("Q")).asNumber(), 0);
  assert.strictEqual(dict.lookup(PDFLib.PDFName.of("Ff")).asNumber() & 2, 2);
  assert.strictEqual(dict.has(PDFLib.PDFName.of("AA")), false, "LTR field must not have the RTL format action");
  const checkOne = checks.find((c) => c.getName() === "ar_check_1");
  const checkRefTag = checkOne.acroField.ref.toString().replace(/^(\d+)\s+0\s+R$/, "$1R");

  const patched = await AFCore.buildForm(built.bytes, [], {
    groups: {},
    existingEdits: [
      { page: 0, fieldName: "ar_text_1", originalRect: [200, 440, 370, 465], rect: [190, 430, 380, 470], setRect: true, setRequired: true, setLabel: true, label: "Edited existing text", required: true },
      { page: 0, refTag: checkRefTag, fieldName: "deliberately_wrong", originalRect: [0, 0, 1, 1], rect: [335, 345, 355, 365], setRect: true, setRequired: true, setLabel: true, label: "Edited existing check", required: true },
      { page: 0, fieldName: spanning.getName(), originalRect: [340, 300, 354, 314], rect: [330, 290, 350, 310], setRect: true, setRequired: true, label: "must not be written", required: true }
    ]
  }, PDFLib, AF_ASSETS);
  const patchedDoc = await PDFLib.PDFDocument.load(patched.bytes);
  const patchedForm = patchedDoc.getForm();
  assert.strictEqual(patchedForm.getFields().length, all.length, "editing existing widgets must not duplicate fields");
  const patchedText = patchedForm.getTextField("ar_text_1").acroField.dict;
  const patchedTextRect = patchedText.lookup(PDFLib.PDFName.of("Rect"));
  assert.deepStrictEqual([0, 1, 2, 3].map((i) => patchedTextRect.lookup(i).asNumber()), [190, 430, 380, 470]);
  assert.strictEqual(patchedText.lookup(PDFLib.PDFName.of("TU")).decodeText(), "Edited existing text");
  assert.strictEqual(patchedText.lookup(PDFLib.PDFName.of("Ff")).asNumber() & 2, 2);
  assert.strictEqual(patchedForm.getCheckBox("ar_check_1").acroField.dict.lookup(PDFLib.PDFName.of("Ff")).asNumber() & 2, 2);
  const patchedRadio = patchedForm.getRadioGroup(spanning.getName()).acroField;
  assert.strictEqual(patchedRadio.dict.lookup(PDFLib.PDFName.of("Ff")).asNumber(), 49152 | 2, "radio flags must be kept and Required added");
  assert.strictEqual(patchedRadio.dict.lookup(PDFLib.PDFName.of("TU")).decodeText(), "Choose one", "a Required-only edit must not touch the tooltip");
  const radioRects = patchedRadio.getWidgets().map((w) => { const r = w.getRectangle(); return [r.x, r.y, r.x + r.width, r.y + r.height]; });
  assert.deepStrictEqual([...radioRects], [[330, 290, 350, 310], [340, 440, 354, 454]], "only the edited radio button may move");
  assert.strictEqual(patchedForm.getCheckBox("ar_check_1").acroField.dict.lookup(PDFLib.PDFName.of("TU")).decodeText(), "Edited existing check");
  if (process.env.AF_WRITE_FIXTURE) {
    const fixtureDir = path.join(__dirname, "..", "tmp", "pdfs");
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.writeFileSync(path.join(fixtureDir, "existing-fields-edited.pdf"), patched.bytes);
  }

  const secondPass = await AFCore.buildForm(built.bytes, [
    { page: 0, type: "text", rect: [20, 40, 180, 60], ltr: true, choiceValue: "again" }
  ], { groups: {} }, PDFLib, AF_ASSETS);
  const reopened = await PDFLib.PDFDocument.load(secondPass.bytes);
  const names = reopened.getForm().getFields().map((f) => f.getName());
  assert.strictEqual(new Set(names).size, names.length, "a second pass must not collide with existing names");
}

const N = (s) => PDFLib.PDFName.of(s);
const val = (dict, key) => { const v = dict.lookup(N(key)); return v === undefined ? undefined : v.decodeText ? v.decodeText() : v.asNumber(); };
const rectOf = (dict) => [0, 1, 2, 3].map((i) => dict.lookup(N("Rect")).lookup(i).asNumber());
const blank = async (pages = 1) => { const d = await PDFLib.PDFDocument.create(); for (let i = 0; i < pages; i++) d.addPage(); return d.save({ useObjectStreams: false }); };
const streamText = (doc, ref) => Buffer.from(PDFLib.decodePDFRawStream(doc.context.lookup(ref)).decode()).toString("latin1");

/* A form laid out the way Acrobat writes "form.name": each field is one merged
   field + widget dictionary whose /Parent is only a container. */
async function hierarchicalPdf() {
  const d = await PDFLib.PDFDocument.create(); const p = d.addPage(); const x = d.context;
  const parent = x.obj({ T: PDFLib.PDFString.of("form"), TU: PDFLib.PDFString.of("Section tip"), Kids: [] }); const pref = x.register(parent);
  const refs = {};
  const add = (t, rect, ff, tu) => {
    const o = { Type: "Annot", Subtype: "Widget", FT: "Tx", T: PDFLib.PDFString.of(t), Rect: rect, P: p.ref, Parent: pref, DA: PDFLib.PDFString.of("/Helv 10 Tf 0 g") };
    if (ff != null) o.Ff = ff; if (tu) o.TU = PDFLib.PDFString.of(tu);
    const r = x.register(x.obj(o)); parent.lookup(N("Kids")).push(r); p.node.addAnnot(r); refs[t] = r;
  };
  add("name", [50, 700, 250, 720], 4096, "Name tip"); add("city", [50, 650, 250, 670], null, "City tip");
  d.catalog.set(N("AcroForm"), x.obj({ Fields: [pref] }));
  return { bytes: await d.save({ useObjectStreams: false }), refs };
}

async function testHierarchicalOwner() {
  const { bytes, refs } = await hierarchicalPdf();
  const meta = await AFCore.readExistingMeta(bytes, PDFLib);
  const tag = refs.name.objectNumber + "R";
  assert.strictEqual(meta[tag].label, "Name tip");
  assert.strictEqual(meta[tag].ownerKey, tag, "a merged field owns itself, not its container");
  const res = await AFCore.buildForm(bytes, [], { groups: {}, existingEdits: [
    { page: 0, refTag: tag, fieldName: "form.name", originalRect: [50, 700, 250, 720], setRequired: true, required: true, setLabel: true, label: "" }] }, PDFLib, AF_ASSETS);
  const form = (await PDFLib.PDFDocument.load(res.bytes)).getForm();
  const name = form.getTextField("form.name").acroField.dict, city = form.getTextField("form.city").acroField.dict;
  assert.strictEqual(val(name, "Ff"), 4096 | 2, "target keeps multiline and gains Required");
  assert.strictEqual(val(name, "TU"), undefined, "an emptied tooltip is removed from the target");
  assert.deepStrictEqual(rectOf(name), [50, 700, 250, 720], "a metadata edit must not move the field");
  assert.strictEqual(val(city, "Ff"), undefined); assert.strictEqual(val(city, "TU"), "City tip");
  assert.strictEqual(form.getTextField("form.city").isRequired(), false, "sibling must not become required");
  const container = name.lookup(N("Parent"));
  assert.strictEqual(val(container, "Ff"), undefined, "container must not get flags");
  assert.strictEqual(val(container, "TU"), "Section tip", "container tooltip must survive");
  assert.strictEqual(res.warnings.length, 0, JSON.stringify(res.warnings));
}

async function testEditOnlySaveAddsNothing() {
  const { bytes, refs } = await hierarchicalPdf();
  const res = await AFCore.buildForm(bytes, [], { groups: {}, existingEdits: [
    { page: 0, refTag: refs.city.objectNumber + "R", rect: [60, 640, 260, 660], setRect: true, label: "ignored", required: true }] }, PDFLib, AF_ASSETS);
  assert(res.bytes.length < bytes.length + 2000, "an edit-only save must not embed the font");
  const doc = await PDFLib.PDFDocument.load(res.bytes);
  assert.strictEqual(doc.catalog.has(N("Names")), false, "no document script may be added");
  assert.strictEqual(doc.catalog.has(N("AA")), false, "no close action may be added");
  const af = doc.catalog.lookup(N("AcroForm"));
  assert.strictEqual(af.has(N("DR")), false); assert.strictEqual(af.has(N("DA")), false);
  const city = doc.getForm().getTextField("form.city").acroField.dict;
  assert.deepStrictEqual(rectOf(city), [60, 640, 260, 660]);
  assert.strictEqual(val(city, "TU"), "City tip", "a geometry-only edit must keep the tooltip");
  assert.strictEqual(val(city, "Ff"), undefined, "a geometry-only edit must not write flags");
}

async function testMultiWidgetAndUnmatched() {
  const d = await PDFLib.PDFDocument.create(); const p1 = d.addPage(), p2 = d.addPage();
  const tf = d.getForm().createTextField("same"); tf.addToPage(p1, { x: 50, y: 700, width: 100, height: 20 }); tf.addToPage(p2, { x: 50, y: 600, width: 100, height: 20 });
  tf.acroField.dict.set(N("TU"), PDFLib.PDFString.of("Shared tip"));
  const dd = d.getForm().createDropdown("choice"); dd.addToPage(p1, { x: 50, y: 500, width: 100, height: 20 });
  const bytes = await d.save({ useObjectStreams: false });
  const widgetRects = (await PDFLib.PDFDocument.load(bytes)).getForm().getTextField("same").acroField.getWidgets().map((w) => rectOf(w.dict));
  const meta = await AFCore.readExistingMeta(bytes, PDFLib), entries = Object.keys(meta).map((k) => meta[k]);
  const same = entries.filter((m) => m.label === "Shared tip");
  assert.strictEqual(same.length, 2, "both widgets must report the tooltip stored on their field");
  assert.strictEqual(same[0].ownerKey, same[1].ownerKey, "widgets of one field on different pages share one owner");
  assert.strictEqual(new Set(entries.map((m) => m.ownerKey)).size, 2);
  const res = await AFCore.buildForm(bytes, [], { groups: {}, existingEdits: [
    { page: 1, fieldName: "same", originalRect: widgetRects[1], setRequired: true, required: true },
    { page: 0, fieldName: "nobody", originalRect: [1, 1, 2, 2], rect: [5, 5, 50, 50], setRect: true },
    { page: 7, fieldName: "same", setRequired: true, required: true },
    { page: 0, fieldName: "same", originalRect: widgetRects[0], rect: [10, 10, 5, 5], setRect: true }] }, PDFLib, AF_ASSETS);
  assert.strictEqual(res.warnings.length, 3, "unmatched, bad page and bad rectangle each warn: " + JSON.stringify(res.warnings));
  const form = (await PDFLib.PDFDocument.load(res.bytes)).getForm();
  assert.strictEqual(form.getTextField("same").isRequired(), true);
  assert.strictEqual(val(form.getTextField("same").acroField.dict, "TU"), "Shared tip");
  assert.deepStrictEqual([...form.getTextField("same").acroField.getWidgets().map((w) => rectOf(w.dict))], [...widgetRects], "rejected edits must not move anything");
  assert(form.getDropdown("choice"), "unsupported field types stay in the PDF untouched");
  assert.strictEqual(form.getFields().length, 2);
}

async function testRepeatPasses() {
  const first = await AFCore.buildForm(await blank(2), [
    { page: 0, type: "text", rect: [200, 440, 370, 465] },
    { page: 0, type: "check", rect: [340, 350, 354, 364], groupId: 1, choiceValue: "choice_3" }], { groups: { 1: { mode: "several" } } }, PDFLib, AF_ASSETS);
  const second = await AFCore.buildForm(first.bytes, [
    { page: 1, type: "text", rect: [200, 440, 370, 465] },
    { page: 1, type: "check", rect: [340, 350, 354, 364], groupId: 1, choiceValue: "choice_3" },
    { page: 1, type: "check", rect: [300, 350, 314, 364], groupId: 1, choiceValue: "choice_4" }], { groups: { 1: { mode: "several" } } }, PDFLib, AF_ASSETS);
  assert(second.bytes.length - first.bytes.length < 20000, "the font must not be embedded a second time (grew " + (second.bytes.length - first.bytes.length) + " bytes)");
  const names = (await PDFLib.PDFDocument.load(second.bytes)).getForm().getFields().map((f) => f.getName()).sort();
  assert.deepStrictEqual([...names], ["ar_group_1_choice_3", "ar_group_2_choice_3", "ar_group_2_choice_4", "ar_text_1", "ar_text_2"],
    "a later session's checkbox group must get its own prefix");
}

async function testRadioStructureAndMarks() {
  const built = await AFCore.buildForm(await blank(), [
    { page: 0, type: "radio", rect: [340, 300, 354, 314], groupId: 1, choiceValue: "Off", mark: "constructor", label: "ignored: the group has its own tooltip" },
    { page: 0, type: "radio", rect: [300, 300, 314, 314], groupId: 1, choiceValue: "b", mark: "cross" },
    { page: 0, type: "check", rect: [340, 350, 354, 364], mark: "tick", required: true }],
    { groups: { 1: { mode: "one", label: "Group tip", mark: "toString" } } }, PDFLib, AF_ASSETS);
  const doc = await PDFLib.PDFDocument.load(built.bytes), form = doc.getForm();
  const rg = form.getFields().find((f) => f instanceof PDFLib.PDFRadioGroup), parent = rg.acroField.dict;
  assert.deepStrictEqual([...rg.getOptions()].sort(), ["b", "choice_Off"], "the name Off is reserved for the unselected state");
  assert.strictEqual(val(parent, "Ff"), 49152); assert.strictEqual(val(parent, "TU"), "Group tip");
  assert.strictEqual(parent.lookup(N("FT")).toString(), "/Btn"); assert.strictEqual(parent.lookup(N("V")).toString(), "/Off");
  assert(/ZaDb/.test(val(parent, "DA")), "radio parent needs its own default appearance");
  const fieldRefs = doc.catalog.lookup(N("AcroForm")).lookup(N("Fields")).asArray().map(String);
  const annots = doc.getPages()[0].node.lookup(N("Annots")).asArray().map(String);
  rg.acroField.getWidgets().forEach((w) => {
    const ref = String(doc.context.getObjectRef(w.dict));
    assert(annots.includes(ref), "radio widget must be a page annotation");
    assert(!fieldRefs.includes(ref), "radio widget must not be a top-level field");
    assert.strictEqual(String(w.dict.get(N("Parent"))), String(rg.acroField.ref));
    assert.strictEqual(w.dict.lookup(N("AS")).toString(), "/Off");
    assert.strictEqual(w.dict.has(N("T")), false);
  });
  const ap = (w, state) => streamText(doc, w.dict.lookup(N("AP")).lookup(N("N")).get(N(state)));
  const [w1, w2] = rg.acroField.getWidgets();
  assert(/ c f Q/.test(ap(w1, "choice_Off")), "an unknown mark name falls back to the radio default, a filled dot");
  assert.strictEqual(ap(w1, "Off").trim(), "", "the off state of a non-required radio is empty");
  assert.strictEqual((ap(w2, "b").match(/ l S/g) || []).length, 2, "a cross is two strokes");
  const noTip = await AFCore.buildForm(await blank(), [
    { page: 0, type: "radio", rect: [340, 300, 354, 314], groupId: 1, choiceValue: "a", label: "Choice A" },
    { page: 0, type: "radio", rect: [300, 300, 314, 314], groupId: 1, choiceValue: "b", label: "Choice B" }],
    { groups: { 1: { mode: "one" } } }, PDFLib, AF_ASSETS);
  const bare = (await PDFLib.PDFDocument.load(noTip.bytes)).getForm().getFields()[0].acroField;
  assert.strictEqual(bare.dict.has(N("TU")), false, "a member's tooltip must never become the radio group's tooltip");
  bare.getWidgets().forEach((w) => assert.strictEqual(w.dict.has(N("TU")), false));
  const cb = form.getCheckBox("ar_check_1").acroField.getWidgets()[0];
  assert(/0\.72 0\.05 0\.05 RG/.test(ap(cb, "Off")) && / re S/.test(ap(cb, "Off")), "required outline is drawn in the off state");
  assert(/ l S Q/.test(ap(cb, "Yes")) && / re S/.test(ap(cb, "Yes")), "on state has outline and tick");
}

/* Acrobat draws nothing for an unselected box unless the field does, so a box
   placed where the page prints none must carry its own outline in every state. */
async function testOwnOutline() {
  const built = await AFCore.buildForm(await blank(), [
    { page: 0, type: "check", rect: [340, 350, 354, 364], outline: true },
    { page: 0, type: "check", rect: [300, 350, 314, 364] },
    { page: 0, type: "check", rect: [260, 350, 274, 364], outline: true, required: true },
    { page: 0, type: "radio", rect: [340, 300, 354, 314], groupId: 1, choiceValue: "a", outline: true },
    { page: 0, type: "radio", rect: [300, 300, 314, 314], groupId: 1, choiceValue: "b" },
    { page: 0, type: "text", rect: [100, 400, 250, 420], outline: true }],
    { groups: { 1: { mode: "one" } } }, PDFLib, AF_ASSETS);
  const doc = await PDFLib.PDFDocument.load(built.bytes), form = doc.getForm();
  const ap = (w, state) => streamText(doc, w.dict.lookup(N("AP")).lookup(N("N")).get(N(state)));
  const widget = (name) => form.getCheckBox(name).acroField.getWidgets()[0];
  const bc = (w) => { const mk = w.dict.lookup(N("MK")), c = mk && mk.lookup(N("BC")); return c ? [0, 1, 2].map((i) => c.lookup(i).asNumber()).join(" ") : null; };
  const grey = "0.3 0.33 0.38", red = "0.72 0.05 0.05";
  const own = widget("ar_check_1"), plain = widget("ar_check_2"), req = widget("ar_check_3");
  assert(ap(own, "Off").includes(grey + " RG") && / re S/.test(ap(own, "Off")), "unselected checkbox draws its square");
  assert(ap(own, "Yes").includes(grey + " RG") && / l S Q/.test(ap(own, "Yes")), "selected checkbox draws square and mark");
  assert.strictEqual(bc(own), grey, "border colour is declared so a viewer that redraws the box keeps it");
  assert.strictEqual(ap(plain, "Off").trim(), "", "a box on a printed square stays empty"); assert.strictEqual(bc(plain), null);
  assert(ap(req, "Off").includes(red + " RG") && !ap(req, "Off").includes(grey), "Required red replaces the grey outline");
  const [r1, r2] = form.getFields().find((f) => f instanceof PDFLib.PDFRadioGroup).acroField.getWidgets();
  assert(ap(r1, "Off").includes(grey + " RG") && / c S Q/.test(ap(r1, "Off")), "unselected radio button draws its circle");
  assert(ap(r1, "a").includes(grey + " RG") && / c f Q/.test(ap(r1, "a")), "selected radio button draws circle and dot");
  assert.strictEqual(ap(r2, "Off").trim(), ""); assert.strictEqual(bc(r1), grey); assert.strictEqual(bc(r2), null);
  // Every appearance stream must be made only of numbers and known operators, in a
  // valid order: a missing space such as "G1.68" would make a viewer drop the drawing.
  const wellFormed = (s) => {
    const arity = { q: 0, Q: 0, G: 1, g: 1, RG: 3, rg: 3, w: 1, J: 1, j: 1, m: 2, l: 2, c: 6, re: 4, S: 0, f: 0, cm: 6 };
    let operands = 0, depth = 0;
    for (const tok of s.trim().split(/\s+/).filter(Boolean)) {
      if (/^-?\d+(\.\d+)?$/.test(tok)) { operands++; continue; }
      assert(tok in arity, "unknown operator '" + tok + "' in: " + s);
      assert.strictEqual(operands, arity[tok], "operator " + tok + " has " + operands + " operands in: " + s);
      operands = 0;
      if (tok === "q") depth++;
      if (tok === "Q") assert(--depth >= 0, "Q without a matching q in: " + s);
    }
    assert.strictEqual(operands, 0, "trailing operands in: " + s);
    assert.strictEqual(depth, 0, "q without a matching Q in: " + s);
  };
  assert.throws(() => wellFormed("Q q 1 w "), /without a matching q/, "the checker must reject a restore before a save");
  assert.throws(() => wellFormed("q q 1 w Q "), /without a matching Q/);
  assert.throws(() => wellFormed("q 0.1 G1.68 w Q "), /unknown operator/);
  const marks = await AFCore.buildForm(await blank(), ["tick", "cross", "dot"].map((mark, i) => (
    { page: 0, type: "check", rect: [40 + i * 30, 350, 54 + i * 30, 364], mark, outline: true, required: i === 2 })).concat(
    ["tick", "cross", "dot"].map((mark, i) => ({ page: 0, type: "radio", rect: [40 + i * 30, 300, 58 + i * 30, 314], mark, groupId: 1, choiceValue: mark, outline: true }))),
    { groups: { 1: { mode: "one", required: true } } }, PDFLib, AF_ASSETS);
  const mdoc = await PDFLib.PDFDocument.load(marks.bytes); let streams = 0;
  mdoc.getForm().getFields().forEach((f) => f.acroField.getWidgets().forEach((w) => {
    const n = w.dict.lookup(N("AP")).lookup(N("N")), box = rectOf(w.dict), bs = w.dict.lookup(N("BS"));
    assert.strictEqual(bs.lookup(N("W")).asNumber(), 1, "border width matches the 1-unit line drawn in the appearance");
    assert.strictEqual(bs.lookup(N("S")).toString(), "/S", "border style is solid");
    n.keys().forEach((k) => { const s = streamText(mdoc, n.get(k)); wellFormed(s); streams++;
      const bb = mdoc.context.lookup(n.get(k)).dict.lookup(N("BBox"));
      assert.deepStrictEqual([0, 1, 2, 3].map((i) => bb.lookup(i).asNumber()), [0, 0, box[2] - box[0], box[3] - box[1]], "BBox is the whole widget"); if (k.toString() !== "/Off") assert(/^q 0\.1 [Gg] /.test(s.replace(/^q 1 0 0 1 [\d.]+ [\d.]+ cm /, "").replace(/^q [\d. ]+RG 1 w .*? S Q /, "")), "mark is near-black: " + s); });
  }));
  assert.strictEqual(streams, 12, "three checkboxes and three radio buttons, two states each");
  // a radio button dragged 18 wide x 14 tall still draws a circle: a 14-unit square shifted 2 units right
  const wide = mdoc.getForm().getFields().find((f) => f instanceof PDFLib.PDFRadioGroup).acroField.getWidgets()[2];
  const wideN = wide.dict.lookup(N("AP")).lookup(N("N")), off = streamText(mdoc, wideN.get(N("Off"))),
        on = streamText(mdoc, wideN.get(wideN.keys().find((k) => k.toString() !== "/Off")));
  assert(off.startsWith("q 1 0 0 1 2 0 cm "), "ring is centred in the wider field: " + off);
  const xs = [...off.replace("q 1 0 0 1 2 0 cm ", "").matchAll(/(-?[\d.]+) (-?[\d.]+) (?:m|c) /g)].flatMap((m) => [[+m[1], +m[2]]]);
  const span = (i) => Math.max(...xs.map((p) => p[i])) - Math.min(...xs.map((p) => p[i]));
  assert.strictEqual(span(0), span(1), "ring is as wide as it is tall"); assert.strictEqual(span(0), 13);
  assert(on.startsWith("q 1 0 0 1 2 0 cm ") && on.length > off.length, "the mark is drawn inside the same centred square: " + on);
  const tx = form.getTextField("ar_text_1").acroField.getWidgets()[0];
  assert(!streamText(doc, tx.dict.lookup(N("AP")).get(N("N"))).includes(grey), "the outline option does not apply to text fields");
}

function ringBitmap(pt, scale, cw, ch, sw) {
  const W = Math.ceil(60 * scale), H = W, data = new Uint8ClampedArray(W * H * 4).fill(255);
  const a = cw * pt * scale / 2, b = ch * pt * scale / 2, t = sw * pt * scale, cx = W / 2, cy = H / 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = ((x - cx) / a) ** 2 + ((y - cy) / b) ** 2, o = ((x - cx) / (a + t)) ** 2 + ((y - cy) / (b + t)) ** 2;
    if (i >= 1 && o <= 1) data.set([0, 0, 0, 255], (y * W + x) * 4);
  }
  return AFCore.detectRegions(data, W, H, scale).filter((r) => r.type === "radio");
}

function testDetectionNegatives() {
  assert.strictEqual(ringBitmap(9, 3, 1, 1, 0.067).length, 1, "a printed 9pt circle is a radio candidate");
  assert.strictEqual(ringBitmap(7, 3, 1, 1, 0.085).length, 1, "a printed 7pt circle is a radio candidate");
  assert.strictEqual(ringBitmap(22, 3, 1, 1, 0.03).length, 1, "a 22pt circle is a radio candidate");
  assert.strictEqual(ringBitmap(14, 3, 0.51, 0.606, 0.09).length, 0, "the bowl of a 14pt capital O is not");
  assert.strictEqual(ringBitmap(16, 3, 0.51, 0.606, 0.09).length, 0, "the bowl of a 16pt capital O is not");
  assert.strictEqual(ringBitmap(20, 3, 0.36, 0.40, 0.085).length, 0, "the bowl of a 20pt lowercase o is not");
  const regions = [{ type: "radio", x: 100, y: 100, w: 8, h: 8 }, { type: "radio", x: 300, y: 100, w: 8, h: 8 },
                   { type: "radio", x: 100, y: 200, w: 8, h: 8 }, { type: "check", x: 100, y: 100, w: 8, h: 8 }];
  const kept = AFCore.dropRadiosOnText(regions, [
    { str: "INFORMATION", x: 60, y: 110, w: 120, h: 14 },          // covers the first candidate
    { str: "o", x: 298, y: 109, w: 10, h: 12 },                    // a lone symbol-font circle: not evidence
    { str: "○ نعم", x: 95, y: 209, w: 60, h: 12 }]);   // a text run that contains its own circle
  assert.deepStrictEqual([...kept.map((r) => r.type + "@" + r.x + "," + r.y)], ["radio@300,100", "radio@100,200", "check@100,100"]);
}

function testNormalizationHardening() {
  const many = AFCore.normalizeModel([1, 2, 3].map((g) => ({ page: 0, type: "radio", rect: [0, 0, 10, 10], groupId: g })), {}, 1);
  assert.strictEqual(many.warnings.filter((w) => /only one button/.test(w)).length, 1, "single-button groups are reported in one line");
  const odd = AFCore.normalizeModel([{ page: 0, type: "check", rect: [0, 0, 10, 10], mark: "constructor", label: { a: 1 }, size: 900, groupId: "__proto__" }], { 0: {}, "-1": {}, x: {} }, 1);
  assert.strictEqual(odd.fields[0].mark, "tick"); assert.strictEqual(odd.fields[0].label, ""); assert.strictEqual(odd.fields[0].size, 10);
  assert.strictEqual(odd.fields[0].groupId, null); assert.deepStrictEqual(Object.keys(odd.groups), []);
}

(async () => {
  testNormalization();
  testNormalizationHardening();
  testDetectionNegatives();
  await testHierarchicalOwner();
  await testEditOnlySaveAddsNothing();
  await testMultiWidgetAndUnmatched();
  await testRepeatPasses();
  await testRadioStructureAndMarks();
  await testOwnOutline();
  testExistingClassification();
  const detected = syntheticRegions();
  assert(detected.some((r) => r.type === "check"), "synthetic square was not detected");
  assert(detected.some((r) => r.type === "radio"), `synthetic circle was not detected: ${JSON.stringify(detected)}`);
  await testPdfWriting();
  console.log("All Arabic PDF Form Maker core tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
