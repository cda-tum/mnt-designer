// Run with: node tests/frontend_smoke.cjs (no installed dependencies).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/mnt/designer/static/js/script.js"), "utf8");
const startupCode = source.slice(0, source.indexOf("  let selectedGateType")) + "globalThis.started = true; });";
for (const missing of ["ace", "ace/theme/chrome", "ace/mode/verilog", null]) {
  const startup = {
    document: {}, $: () => ({ ready: (callback) => callback() }), started: false,
    ace: missing === "ace" ? undefined : { require: (name) => name !== missing },
    updateMessageArea(_message, type) { assert.equal(type, "danger"); },
  };
  vm.runInNewContext(startupCode, startup);
  assert.equal(startup.started, missing === null, "missing verified Ace modules must stop initialization");
}
console.log("PASS: blocked Ace startup imports cannot fall back to unchecked downloads");

// Execute the actual editor handlers without loading Ace, Cytoscape, or a browser.
const editorCode = source.slice(source.indexOf("  let selectedGateType"), source.indexOf("  // Initialize Cytoscape instance"));
const importCode = source.slice(
  source.indexOf("  // Trigger file input when the import verilog button is clicked"),
  source.indexOf("  // Gate selection"),
);
const loadCode = source.slice(source.indexOf("  function loadEditor()"), source.indexOf("  function placeGateLocally"));
function createEditor() {
  const handlers = {}, pending = [], timers = new Map(), statuses = {};
  let code = "", changed = () => {}, timerId = 0, readOnly = false;
  const editor = {
    session: { setMode() {}, on(_event, callback) { changed = callback; } },
    setTheme() {}, setOptions() {}, focus() {},
    getReadOnly() { return readOnly; }, setReadOnly(value) { readOnly = value; },
    getValue() { return code; }, setValue(value) { code = value; changed(); },
  };
  const dollar = (selector) => ({
    on(event, callback) { handlers[selector + ":" + event] = callback; return this; },
    text(value) { statuses[selector] = value; return this; },
    attr() { return this; }, prop() { return this; },
  });
  dollar.ajax = (options) => pending.push(options);
  const context = {
    ace: { edit: () => editor }, $: dollar,
    document: { getElementById: () => ({ requestSubmit() {} }) },
    FormData: class { append() {} }, confirm: () => false, updateMessageArea() {},
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  };
  vm.createContext(context);
  vm.runInContext(editorCode + importCode + loadCode + "\nglobalThis.subject = { replaceEditorCode, loadEditor, get valid() { return valid_verilog; } };", context);
  const flush = () => { const queued = [...timers.values()]; timers.clear(); queued.forEach((fn) => fn()); };
  const complete = (request, data = { success: true }) => { request.success(data); request.complete?.(); };
  return { context, editor, pending, handlers, flush, complete, statuses };
}

for (const httpError of [false, true]) {
  for (const initialLoadDuringImport of [false, true]) {
    const { context, editor, pending, handlers, flush, complete } = createEditor();
    const saved = { success: true, code: "saved circuit" };
    context.subject.loadEditor();
    handlers["#import-verilog-file-input:change"].call({ files: [{}], value: "invalid.v" });
    if (initialLoadDuringImport) complete(pending[0], saved);
    if (httpError) {
      pending[1].error({ responseJSON: { error: "File too large" } }, "error", "HTTP 413");
      pending[1].complete();
    } else {
      complete(pending[1], { success: false, error: "Invalid Verilog" });
    }
    flush();
    assert.equal(pending[2].url, "/get_verilog_code", "failed import must restore an untouched editor, not reset the saved circuit");
    complete(pending[2], saved);
    if (!initialLoadDuringImport) complete(pending[0], { success: true, code: "stale circuit" });
    assert.equal(editor.getValue(), saved.code);
    assert.equal(context.subject.valid, true);
    assert.equal(pending.filter((request) => request.type === "POST").length, 1, "recovery must not write to the server");
  }
}

{
  const { context, editor, pending, handlers, complete } = createEditor();
  context.subject.loadEditor();
  handlers["#import-verilog-file-input:change"].call({ files: [{}], value: "invalid.v" });
  complete(pending[1], { success: false, error: "Invalid Verilog" });
  editor.setValue("new local circuit");
  complete(pending[2], { success: true, code: "saved circuit" });
  complete(pending[0], { success: true, code: "saved circuit" });
  assert.equal(editor.getValue(), "new local circuit", "recovery must not replace edits made after import failure");
}

{
  const { context, editor, pending, handlers, complete } = createEditor();
  context.subject.loadEditor();
  handlers["#import-verilog-file-input:change"].call({ files: [{}], value: "valid.v" });
  complete(pending[1], { success: true, code: "imported circuit" });
  complete(pending[0], { success: true, code: "stale circuit" });
  assert.equal(editor.getValue(), "imported circuit", "successful import must win over the initial load");
  assert.equal(pending.length, 2, "successful import must not trigger a recovery request");
}
console.log("PASS: failed imports preserve saved circuits during initial loading, and stale loads cannot replace edits/imports");

const { context, editor, pending, handlers, flush, complete, statuses } = createEditor();

context.subject.replaceEditorCode("first");
assert.equal(context.subject.valid, false);
flush();
assert.equal(pending.length, 1);
editor.setValue("second");
assert.equal(context.subject.valid, false);
flush();
assert.equal(pending.length, 1, "saves must not overlap");
complete(pending[0]);
assert.equal(context.subject.valid, false, "stale save must not validate newer edits");
assert.equal(pending.length, 2);
assert.equal(JSON.parse(pending[1].data).code, "second");
complete(pending[1]);
assert.equal(context.subject.valid, true);
assert.equal(statuses["#editor-status"], "Saved");
handlers["#load-example-button:click"]();
assert.equal(editor.getValue(), "second", "declining example replacement must preserve code");

context.subject.replaceEditorCode("");
handlers["#import-verilog-file-input:change"].call({ files: [{}], value: "invalid.v" });
assert.equal(pending[2].url, "/import_verilog_code");
complete(pending[2], { success: false, error: "Invalid Verilog" });
flush();
assert.equal(pending[3].url, "/reset_editor", "failed import must not discard a pending empty-editor reset");
complete(pending[3]);
assert.equal(context.subject.valid, false);
assert.equal(editor.getValue(), "");
console.log("PASS: serialized saves, immediate invalidation, stale replies, confirmation, and empty-editor recovery");

// Use the actual algorithm callbacks: invalid forms must stop before any request.
for (const [name, start, end] of [
  ["gold", "  // Gold Button Click Event", "  // Exact Algorithm Apply Button"],
  ["exact", "  // Exact Algorithm Apply Button", "  function toggleCustomRelocations"],
  ["optimization", '  // Event listener for the "Optimize" button', "  // Trigger file input when the import verilog button"],
]) {
  let formValid = false, callback, request;
  const values = {
    "#exact-num-threads": "1", "#exact-timeout": "1000",
    "#gold-timeout": "1000", "#gold-num-vertex-expansions": "4", "#optimization-timeout": "1000",
  };
  const dollar = (selector) => ({
    on(_event, handler) { callback = handler; },
    prop() { return this; }, text() { return this; },
    val() { return values[selector] ?? ""; },
  });
  dollar.ajax = (options) => { request = options; };
  vm.runInNewContext(source.slice(source.indexOf(start), source.indexOf(end)), {
    $: dollar, valid_verilog: true, updateMessageArea() {},
    document: { getElementById(id) { assert.equal(id, `${name}-params-form`); return { reportValidity: () => formValid }; } },
  });
  callback();
  assert.equal(request, undefined, `${name} must not submit an invalid form`);
  formValid = true;
  callback();
  assert.equal(request.url, `/apply_${name}`);
  if (name === "exact") {
    const params = JSON.parse(request.data);
    assert.equal(params.upper_bound_x, 1000, "only optional blank bounds use the default");
    assert.equal(params.upper_bound_y, 1000);
    assert.equal(params.timeout, 1000, "valid timeouts must be preserved");
  }
}
console.log("PASS: algorithm forms validate before submitting and preserve optional Exact defaults");

{
  let selected, message, errorHandler;
  const dollar = (selector) => {
    selected = selector;
    return { removeClass() { return this; }, addClass() { return this; }, text(value) { message = value; }, on() {} };
  };
  dollar.ajax = (options) => { errorHandler = options.error; };
  const feedback = { $: dollar };
  vm.createContext(feedback);
  vm.runInContext(source.slice(source.indexOf("  // Message area update function"), source.indexOf("  // Handle layout creation")), feedback);
  vm.runInContext('updateMessageArea("Visible failure", "danger")', feedback);
  assert.ok(selected.includes(".modal.show .modal-status"), "feedback must include the open dialog");
  assert.equal(message, "Visible failure");
  feedback.$ = Object.assign(() => ({ on(_event, callback) { callback(); } }), { ajax: dollar.ajax });
  feedback.updateMessageArea = (value) => { message = value; };
  vm.runInContext(source.slice(source.indexOf("  // Check Equivalence"), source.indexOf('  $("#equivalence-area .close-equivalence")')), feedback);
  errorHandler({ responseJSON: { error: "Network not found." } }, "error", "NOT FOUND");
  assert.equal(message, "Failed to check equivalence: Network not found.");
}
console.log("PASS: errors reach the visible dialog and preserve backend explanations");

// Data-mapped rendering must refresh wire direction, cleared tiles, and named gates.
{
  const rendering = {};
  vm.createContext(rendering);
  vm.runInContext(
    source.slice(source.indexOf("  function createTileNumberSVG("), source.indexOf("  // In handlePlaceGate function")) +
    source.slice(source.indexOf("  function updateGateLabel("), source.indexOf("  function deleteGate(")),
    rendering,
  );
  const data = { gateType: "BUF", tileNumber: 1, color: "#ffffff", label: "BUF" };
  const edges = [{ source: "left", target: "wire" }, { source: "wire", target: "bottom" }]
    .map((edge) => ({ data: (key) => edge[key] }));
  const node = {
    id: () => "wire", position: () => ({ x: 60, y: 60 }), connectedEdges: () => edges,
    data(key, value) {
      if (typeof key === "object") Object.assign(data, key);
      else if (arguments.length === 2) data[key] = value;
      else return data[key];
    },
  };
  rendering.cy = { getElementById: (id) => ({ position: () => id === "left" ? { x: 0, y: 60 } : { x: 60, y: 120 } }) };
  const image = (type, orientation) => `data:image/svg+xml;utf8,${encodeURIComponent(rendering.createTileNumberSVG(1, type, orientation))}`;
  rendering.updateGateLabel(node);
  assert.equal(data.image, image("buf", "LeftToBottom"));
  assert.equal(data.backgroundColor, "palegoldenrod");
  assert.equal(data.label, "");
  data.gateType = "";
  rendering.updateGateLabel(node);
  assert.equal(data.image, image(""), "cleared tiles must lose the wire image");
  assert.equal(data.backgroundColor, data.color);
  Object.assign(data, { gateType: "PI", label: "named input" });
  rendering.updateGateLabel(node);
  assert.equal(data.image, image("pi"));
  assert.equal(data.backgroundColor, "lightgreen");
  assert.equal(data.label, "named input", "repainting must preserve user-provided names");
}
console.log("PASS: data-mapped rendering preserves wire orientation, cleared tiles, and gate names");

const exportCode = source.slice(source.indexOf("  // Export Layout"), source.indexOf("  // Trigger file input when the import button is clicked"));
context.window = { location: { href: "/designer" } };
context.updateMessageArea = (message, type) => { statuses.message = message; statuses.type = type; };
vm.runInContext(exportCode, context);
const exportClick = handlers[Object.keys(handlers).find((key) => key.includes("#export-qca-layout-button"))];
context.subject.replaceEditorCode("unsaved circuit");
(async () => {
  for (const jsonError of [true, false]) {
    context.fetch = async (route) => {
      assert.equal(route, "/export_qca_layout");
      return { ok: jsonError, status: jsonError ? 200 : 500, headers: { get: () => jsonError ? "application/json" : "text/html" }, json: async () => ({ error: "Unsupported layout" }) };
    };
    const button = { id: "export-qca-layout-button", disabled: false };
    const request = exportClick.call(button);
    assert.equal(button.disabled, true);
    await request;
    assert.equal(button.disabled, false);
    assert.equal(statuses.type, "danger");
    assert.match(statuses.message, jsonError ? /Unsupported layout/ : /HTTP 500/);
    assert.equal(context.window.location.href, "/designer");
    assert.equal(editor.getValue(), "unsaved circuit", "failed export must preserve editor contents");
  }
  console.log("PASS: JSON and HTTP export failures preserve the page/editor and restore the export button");
})().catch((error) => { console.error(error); process.exitCode = 1; });
