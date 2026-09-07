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
vm.runInContext(editorCode + importCode + "\nglobalThis.subject = { replaceEditorCode, get valid() { return valid_verilog; } };", context);
const flush = () => { const queued = [...timers.values()]; timers.clear(); queued.forEach((fn) => fn()); };
const complete = (request, data = { success: true }) => { request.success(data); request.complete(); };

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
assert.equal(code, "second", "declining example replacement must preserve code");

context.subject.replaceEditorCode("");
handlers["#import-verilog-file-input:change"].call({ files: [{}], value: "invalid.v" });
assert.equal(pending[2].url, "/import_verilog_code");
complete(pending[2], { success: false, error: "Invalid Verilog" });
flush();
assert.equal(pending[3].url, "/reset_editor", "failed import must not discard a pending empty-editor reset");
complete(pending[3]);
assert.equal(context.subject.valid, false);
assert.equal(code, "");
console.log("PASS: serialized saves, immediate invalidation, stale replies, confirmation, and empty-editor recovery");

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
    assert.equal(code, "unsaved circuit", "failed export must preserve editor contents");
  }
  console.log("PASS: JSON and HTTP export failures preserve the page/editor and restore the export button");
})().catch((error) => { console.error(error); process.exitCode = 1; });
