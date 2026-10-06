"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const ls = require("../packages/language-service/src");

// "|" marks the cursor
function at(src) {
  const offset = src.indexOf("|");
  return [src.slice(0, offset) + src.slice(offset + 1), offset];
}
const labels = (items) => items.map((i) => i.label);

test("completes keywords, builtins and variables", () => {
  const [src, off] = at('let name = "x"\npri|');
  const items = ls.completions(src, off, null);
  assert.ok(labels(items).includes("print"));
  assert.ok(labels(items).includes("name"));
  assert.ok(labels(items).includes("func"));
  const math = items.find((i) => i.label === "math");
  assert.equal(math.autoImport, "import math");
});

test("completes object properties, module members and methods", () => {
  let [src, off] = at('let user = { name: "Hugo", coins: 500 }\nprint(user.|)');
  assert.deepEqual(labels(ls.completions(src, off, null)), ["name", "coins"]);
  [src, off] = at("import fs\nfs.|");
  assert.ok(labels(ls.completions(src, off, null)).includes("read"));
  [src, off] = at('let s = "abc"\ns.up|');
  assert.ok(labels(ls.completions(src, off, null)).includes("upper"));
  [src, off] = at("let items = [1, 2]\nitems.|");
  assert.ok(labels(ls.completions(src, off, null)).includes("map"));
  [src, off] = at("let users = [{ name: \"a\", coins: 1 }]\nfor user in users {\n    print(user.|)\n}");
  assert.deepEqual(labels(ls.completions(src, off, null)), ["name", "coins"]);
  [src, off] = at("class P {\n    let name\n    func hi() {\n        self.|\n    }\n}");
  assert.deepEqual(labels(ls.completions(src, off, null)), ["name", "hi"]);
  [src, off] = at("import web\nlet app = web.app()\napp.get(\"/\", func(req, res) {\n    res.|\n})");
  assert.ok(labels(ls.completions(src, off, null)).includes("json"));
});

test("completes imports and types", () => {
  let [src, off] = at("import |");
  assert.ok(labels(ls.completions(src, off, null)).includes("web"));
  [src, off] = at("from json import |");
  assert.deepEqual(labels(ls.completions(src, off, null)), ["parse", "stringify", "pretty"]);
  [src, off] = at("let x: |");
  assert.ok(labels(ls.completions(src, off, null)).includes("string"));
});

test("hover shows signatures and docs", () => {
  let [src, off] = at('pr|int("hi")');
  let h = ls.hover(src, off, null);
  assert.match(h.contents, /func print\(\.\.\.values\) -> void/);
  assert.match(h.contents, /Prints values/);
  [src, off] = at("// Adds two numbers.\nfunc add(a: int, b: int) -> int {\n    return a + b\n}\nad|d(1, 2)");
  h = ls.hover(src, off, null);
  assert.match(h.contents, /func add\(a: int, b: int\) -> int/);
  assert.match(h.contents, /Adds two numbers\./);
});

test("signature help, definitions, symbols and diagnostics", () => {
  let [src, off] = at("func add(a, b) {}\nadd(1, |");
  const sig = ls.signatureHelp(src, off, null);
  assert.equal(sig.label, "func add(a, b)");
  assert.equal(sig.activeParameter, 1);

  [src, off] = at("let total = 1\nprint(tot|al)");
  const def = ls.definition(src, off, null);
  assert.equal(def.line, 1);

  const symbols = ls.documentSymbols("func a() {}\nclass B {\n    let x\n}\nlet c = 1", null);
  assert.deepEqual(symbols.map((s) => s.name), ["a", "B", "c"]);

  const diags = ls.diagnostics("let user = 1\nprint(uesr)", null);
  assert.equal(diags.length, 1);
  assert.equal(diags[0].message, 'Unknown variable "uesr".');
  assert.equal(diags[0].hint, 'Did you mean "user"?');
  assert.equal(src.length > 0, true);
});

test("incomplete code still gets useful analysis", () => {
  const src = 'let user = { name: "x" }\nfunc f() {\n    print(user.';
  const items = ls.completions(src, src.length, null);
  assert.deepEqual(labels(items), ["name"]);
  const diags = ls.diagnostics(src, null);
  assert.ok(diags.length >= 1);
  assert.ok(diags.every((d) => d.kind === "syntax"), "no bogus name errors while a statement is incomplete");
});

test("folding ranges", () => {
  const ranges = ls.foldingRanges("func a() {\n    x\n}\n// one\n// two\n");
  assert.deepEqual(ranges.map((r) => [r.startLine, r.endLine]), [[0, 1], [3, 4]]);
  const regions = ls.foldingRanges("// region setup\nlet a = 1\nlet b = 2\n// endregion\n");
  assert.deepEqual(regions.map((r) => [r.startLine, r.endLine, r.kind]), [[0, 3, "region"]]);
});
