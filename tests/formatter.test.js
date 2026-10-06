"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { format } = require("../packages/formatter/src");

test("formats the README example", () => {
  assert.equal(format('if x>5{print("hi")}'), 'if x > 5 {\n    print("hi")\n}\n');
});

test("normalizes spacing, indentation and blank lines", () => {
  const src = "let   a=1\n\n\n\nfunc   add(a,b){return a+b}\nlet o={name:\"Hugo\",coins:500}\nlet d = x=>x*2\n";
  assert.equal(format(src), 'let a = 1\n\nfunc add(a, b) {\n    return a + b\n}\n\nlet o = { name: "Hugo", coins: 500 }\nlet d = x => x * 2\n');
});

test("keeps comments", () => {
  const src = "// top\nlet a = 1 // trailing\n/* block */\nfunc f() {\n    // inside\n    return 1\n}\n";
  const out = format(src);
  for (const c of ["// top", "// trailing", "/* block */", "// inside"]) assert.ok(out.includes(c), c);
  assert.ok(out.includes("let a = 1 // trailing"));
});

test("keeps multi-line literals multi-line", () => {
  const src = "let users = [\n\"Hugo\",\n\"Alex\"\n]\n";
  assert.equal(format(src), 'let users = [\n    "Hugo",\n    "Alex"\n]\n');
});

test("keeps parentheses that matter and strings verbatim", () => {
  assert.equal(format('print((1+2)*3, "a {b+1}\\n")'), 'print((1 + 2) * 3, "a {b+1}\\n")\n');
});

test("formats classes, callbacks and control flow", () => {
  const src = 'class P{let name\nfunc init(n){self.name=n}}\napp.get("/",func(req,res){res.json({ok:true})})\ntry{a()}catch e{b(e)}\nfor i in 1..3{print(i)}\n';
  assert.equal(
    format(src),
    'class P {\n    let name\n\n    func init(n) {\n        self.name = n\n    }\n}\n\napp.get("/", func(req, res) {\n    res.json({ ok: true })\n})\ntry {\n    a()\n} catch e {\n    b(e)\n}\nfor i in 1..3 {\n    print(i)\n}\n'
  );
});

test("is idempotent on every example and test program", () => {
  const dirs = [path.join(__dirname, "..", "examples"), path.join(__dirname, "programs")];
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else if (e.name.endsWith(".kivo") && !d.endsWith("errors")) files.push(path.join(d, e.name));
    }
  };
  dirs.forEach(walk);
  assert.ok(files.length > 10);
  for (const f of files) {
    const once = format(fs.readFileSync(f, "utf8"));
    assert.equal(format(once), once, f);
  }
});

test("refuses to format code with syntax errors", () => {
  assert.throws(() => format("let = 5"));
});
