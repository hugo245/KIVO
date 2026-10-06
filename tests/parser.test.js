"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parse, NodeType: N } = require("../packages/parser/src");

// Compact s-expression view of an expression, ignoring positions.
function sexp(node) {
  switch (node.type) {
    case N.NumberLiteral:
      return String(node.value);
    case N.Identifier:
      return node.name;
    case N.StringLiteral:
      return JSON.stringify(node.value);
    case N.BinaryExpression:
    case N.LogicalExpression:
      return `(${node.operator} ${sexp(node.left)} ${sexp(node.right)})`;
    case N.UnaryExpression:
      return `(${node.operator} ${sexp(node.argument)})`;
    case N.RangeExpression:
      return `(${node.inclusive ? ".." : "..<"} ${sexp(node.start)} ${sexp(node.end)})`;
    case N.CallExpression:
      return `(call ${sexp(node.callee)}${node.args.map((a) => " " + sexp(a)).join("")})`;
    case N.MemberExpression:
      return `(${node.optional ? "?." : "."} ${sexp(node.object)} ${node.property})`;
    case N.IndexExpression:
      return `([] ${sexp(node.object)} ${sexp(node.index)})`;
    default:
      return node.type;
  }
}

const expr = (src) => sexp(parse(src).body[0].expression);

test("variable declaration produces the expected AST", () => {
  const decl = parse("let age = 18").body[0];
  assert.equal(decl.type, N.VariableDeclaration);
  assert.equal(decl.kind, "let");
  assert.equal(decl.target.name, "age");
  assert.equal(decl.value.type, N.NumberLiteral);
  assert.equal(decl.value.value, 18);
});

test("operator precedence", () => {
  assert.equal(expr("5 + 2 * 3"), "(+ 5 (* 2 3))");
  assert.equal(expr("(5 + 2) * 3"), "(* (+ 5 2) 3)");
  assert.equal(expr("10 - 4 - 3"), "(- (- 10 4) 3)");
  assert.equal(expr("a or b and c"), "(or a (and b c))");
  assert.equal(expr("not a == b"), "(not (== a b))");
  assert.equal(expr("a + 1 > b * 2"), "(> (+ a 1) (* b 2))");
  assert.equal(expr("x ?? 0 + 1"), "(?? x (+ 0 1))");
  assert.equal(expr("a ?? b == c"), "(== (?? a b) c)");
  assert.equal(expr("1..n + 1"), "(.. 1 (+ n 1))");
  assert.equal(expr("-a * b"), "(* (- a) b)");
  assert.equal(expr("a.b(c)[0].d"), "(. ([] (call (. a b) c) 0) d)");
  assert.equal(expr("user?.name ?? \"x\""), '(?? (?. user name) "x")');
});

test("comparisons cannot be chained", () => {
  assert.throws(() => parse("a < b < c"), (e) => e.diagnostics[0].message === "Comparisons cannot be chained.");
});

test("functions, lambdas and parameters", () => {
  const fn = parse("async func add(a: int, b = 2, ...rest) -> int { return a }").body[0];
  assert.equal(fn.type, N.FunctionDeclaration);
  assert.equal(fn.async, true);
  assert.deepEqual(fn.params.map((p) => [p.name.name, p.typeAnnotation && p.typeAnnotation.name, Boolean(p.defaultValue), p.rest]), [["a", "int", false, false], ["b", null, true, false], ["rest", null, false, true]]);
  assert.equal(fn.returnType.name, "int");
  const arrow = parse("let d = x => x * 2").body[0].value;
  assert.equal(arrow.type, N.FunctionExpression);
  assert.equal(arrow.expression, true);
  const multi = parse("let f = (a, b) => { return a }").body[0].value;
  assert.equal(multi.params.length, 2);
  assert.equal(multi.expression, false);
});

test("if / else if / else, loops and jumps", () => {
  const s = parse("if a { b() } else if c { d() } else { e() }").body[0];
  assert.equal(s.alternate.type, N.IfStatement);
  assert.equal(s.alternate.alternate.type, N.Block);
  const loop = parse("for i, item in items { if item { break } }").body[0];
  assert.equal(loop.key.name, "i");
  assert.equal(loop.value.name, "item");
  assert.throws(() => parse("break"), (e) => e.diagnostics[0].message.includes("inside a loop"));
  assert.throws(() => parse("return 1"), (e) => e.diagnostics[0].message.includes("inside a function"));
});

test("arrays, objects and interpolated strings", () => {
  const arr = parse("let a = [\n  1,\n  2\n]").body[0].value;
  assert.equal(arr.elements.length, 2);
  const obj = parse('let o = {\n  name: "Hugo",\n  coins: 500\n  admin\n}').body[0].value;
  assert.deepEqual(obj.properties.map((p) => p.key), ["name", "coins", "admin"]);
  assert.equal(obj.properties[2].shorthand, true);
  const str = parse('let s = "Hi {user.name}!"').body[0].value;
  assert.equal(str.type, N.TemplateString);
  assert.equal(str.parts[1].type, N.MemberExpression);
});

test("classes, types and imports", () => {
  const cls = parse("class A extends B {\n  let x = 1\n  func init(x) { self.x = x }\n}").body[0];
  assert.equal(cls.superClass.name, "B");
  assert.equal(cls.fields[0].name.name, "x");
  assert.equal(cls.methods[0].name.name, "init");
  const type = parse("type User {\n  id: int\n  email?: string\n}").body[0];
  assert.equal(type.type, N.TypeDeclaration);
  assert.equal(type.fields[1].optional, true);
  const imp = parse('from "./utils.kivo" import a, b as c').body[0];
  assert.equal(imp.isPath, true);
  assert.deepEqual(imp.specifiers.map((s) => [s.imported, s.local.name]), [["a", "a"], ["b", "c"]]);
  const mod = parse("import math").body[0];
  assert.equal(mod.alias.name, "math");
});

test("assignments and destructuring", () => {
  const a = parse("user.coins += 5").body[0];
  assert.equal(a.type, N.AssignmentStatement);
  assert.equal(a.operator, "+=");
  const d = parse("let { name, coins: c } = user").body[0];
  assert.deepEqual(d.target.properties.map((p) => [p.key, p.value.name]), [["name", "name"], ["coins", "c"]]);
});

test("method chains may continue on the next line", () => {
  const s = parse("let users = db.users\n    .where(1)\n    .get()").body[0];
  assert.equal(sexp(s.value), "(call (. (call (. (. db users) where) 1) get))");
});

test("syntax errors explain themselves", () => {
  const cases = [
    ["if x > 1: print(x)", "braces"],
    ["for (item in items) {}", "parentheses"],
    ["var x = 1", '"let"'],
    ["function f() {}", '"func"'],
    ["let o = { a = 1 }", '":"'],
    ["if x = 1 {}", '"=="'],
  ];
  for (const [src, expected] of cases) {
    let err;
    try {
      parse(src);
    } catch (e) {
      err = e;
    }
    assert.ok(err && err.diagnostics, `expected an error for ${src}`);
    const d = err.diagnostics[0];
    assert.ok((d.message + " " + (d.hint || "")).includes(expected), `${src}: ${d.message} ${d.hint}`);
  }
});

test("error recovery collects several errors", () => {
  const { program, errors } = parse("let a = \nlet b = 2\nlet c = )\nlet d = 4", { recover: true });
  assert.equal(errors.length, 2);
  assert.deepEqual(program.body.map((s) => s.target.name), ["b", "d"]);
});
