"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { cli } = require("./helpers");

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kivo-test-"));
}

test("kivo --version and help", () => {
  assert.equal(cli(["--version"]).stdout.trim(), "KIVO 0.1.0");
  const help = cli(["help"]).stdout;
  for (const cmd of ["run", "dev", "check", "fmt", "test", "build", "new"]) assert.ok(help.includes(cmd), cmd);
  const bad = cli(["chek"]);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /Did you mean "kivo check"\?/);
});

test("kivo check reports success and errors", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "good.kivo"), 'print("ok")\n');
  fs.writeFileSync(path.join(dir, "bad.kivo"), "let user = 1\nprint(uesr)\n");
  let r = cli(["check", "good.kivo"], { cwd: dir });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /✓ parsed good\.kivo/);
  assert.match(r.stdout, /✓ no errors/);
  r = cli(["check", "bad.kivo"], { cwd: dir });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /Unknown variable "uesr"/);
  assert.match(r.stdout, /Did you mean "user"\?/);
});

test("kivo fmt formats files and --check reports", () => {
  const dir = tmp();
  const file = path.join(dir, "ugly.kivo");
  fs.writeFileSync(file, 'if x>5{print("hi")}\n');
  let r = cli(["fmt", "--check", "ugly.kivo"], { cwd: dir });
  assert.equal(r.code, 1);
  r = cli(["fmt", "ugly.kivo"], { cwd: dir });
  assert.equal(r.code, 0);
  assert.equal(fs.readFileSync(file, "utf8"), 'if x > 5 {\n    print("hi")\n}\n');
  r = cli(["fmt", "--check", "ugly.kivo"], { cwd: dir });
  assert.equal(r.code, 0);
});

test("kivo new creates a project that runs, tests and builds", () => {
  const dir = tmp();
  let r = cli(["new", "my-app"], { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
  const project = path.join(dir, "my-app");
  for (const f of ["kivo.toml", "src/main.kivo", "src/greeting.kivo", "tests/greeting.test.kivo"]) assert.ok(fs.existsSync(path.join(project, f)), f);

  r = cli(["run"], { cwd: project });
  assert.equal(r.stdout, "Hello, World!\n");
  r = cli([], { cwd: project });
  assert.equal(r.stdout, "Hello, World!\n");

  r = cli(["test"], { cwd: project });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /✓ greets by name/);
  assert.match(r.stdout, /1 passed/);

  r = cli(["build"], { cwd: project });
  assert.equal(r.code, 0, r.stderr);
  const bundle = path.join(project, "dist", "my-app.js");
  assert.ok(fs.existsSync(bundle));
  // the bundle runs with plain node, from anywhere, without the KIVO toolchain
  const elsewhere = tmp();
  fs.copyFileSync(bundle, path.join(elsewhere, "app.js"));
  const out = spawnSync(process.execPath, ["app.js"], { cwd: elsewhere, encoding: "utf8" });
  assert.equal(out.stdout, "Hello, World!\n");
});

test("built programs keep KIVO error messages", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "main.kivo"), "let user = null\nprint(user.name)\n");
  const r = cli(["build", "main.kivo"], { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
  const out = spawnSync(process.execPath, [path.join(dir, "dist", "main.js")], { cwd: dir, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  assert.equal(out.status, 1);
  assert.match(out.stderr, /main\.kivo:2:12/);
  assert.match(out.stderr, /"user" is null, so "name" cannot be accessed\./);
});

test("program arguments are passed through", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "args.kivo"), "import process\nprint(process.args)\n");
  const r = cli(["run", "args.kivo", "a", "b"], { cwd: dir });
  assert.equal(r.stdout, '["a", "b"]\n');
});

test("local packages are imported by name", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "kivo.toml"), '[project]\nname = "pkgs"\n\n[run]\nentry = "main.kivo"\n');
  fs.mkdirSync(path.join(dir, "packages", "greeter", "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "packages", "greeter", "src", "main.kivo"), 'export func hello(n) {\n    return "hi {n}"\n}\n');
  fs.writeFileSync(path.join(dir, "main.kivo"), 'import greeter\nprint(greeter.hello("pkg"))\n');
  const r = cli(["run"], { cwd: dir });
  assert.equal(r.stdout, "hi pkg\n", r.stderr);
});
