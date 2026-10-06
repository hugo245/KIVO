"use strict";

// Runs every program in tests/programs and compares its output with the .out file,
// and checks that every program in tests/programs/errors fails with the expected messages.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { cli } = require("./helpers");

const DIR = path.join(__dirname, "programs");

for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith(".kivo") && !f.endsWith(".test.kivo"))) {
  test(`program ${file}`, () => {
    const expected = fs.readFileSync(path.join(DIR, file.replace(/\.kivo$/, ".out")), "utf8");
    const r = cli(["run", file], { cwd: DIR });
    assert.equal(r.stderr, "");
    assert.equal(r.code, 0);
    assert.equal(r.stdout, expected);
  });
}

for (const file of fs.readdirSync(path.join(DIR, "errors")).filter((f) => f.endsWith(".kivo"))) {
  test(`error program ${file}`, () => {
    const source = fs.readFileSync(path.join(DIR, "errors", file), "utf8");
    const expectations = source.split("\n").filter((l) => l.startsWith("// expect: ")).map((l) => l.slice("// expect: ".length));
    const r = cli(["run", path.join("errors", file)], { cwd: DIR });
    assert.equal(r.code, 1);
    for (const e of expectations) assert.ok(r.stderr.includes(e), `missing "${e}" in:\n${r.stderr}`);
    // errors never leak JavaScript internals
    assert.doesNotMatch(r.stderr, /at Object\.|node:internal|TypeError: Cannot read|\$rt|k\$/);
  });
}

test("the first milestone: hello.kivo", () => {
  const r = cli(["run", "hello.kivo"], { cwd: DIR });
  assert.equal(r.stdout, "Hello Hugo\nHello Hugo\nHello Hugo\n");
});

test("kivo <file> works without the run command", () => {
  const r = cli(["hello.kivo"], { cwd: DIR });
  assert.equal(r.stdout, "Hello Hugo\nHello Hugo\nHello Hugo\n");
});
