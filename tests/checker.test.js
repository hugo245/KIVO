"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { analyze } = require("../packages/core/src");

const messages = (src) => analyze(src, null).diagnostics.map((d) => d.message);
const first = (src) => analyze(src, null).diagnostics[0];

test("unknown variables get suggestions", () => {
  const d = first('let user = { name: "Hugo" }\nprint(uesr.name)');
  assert.equal(d.message, 'Unknown variable "uesr".');
  assert.equal(d.hint, 'Did you mean "user"?');
  assert.equal(d.line, 2);
  assert.equal(d.column, 7);
});

test("names from other languages get specific advice", () => {
  assert.match(first("print(undefined)").hint, /null/);
  assert.match(first("let x = nil").hint, /null/);
  assert.match(first("console.log(1)").hint, /print/);
  assert.match(first("import math\nprint(maths.pi)").hint || "", /math/);
});

test("constants, functions and imports cannot be reassigned", () => {
  assert.deepEqual(messages("const a = 1\na = 2"), ['"a" is a constant and cannot be reassigned.']);
  assert.deepEqual(messages("func f() {}\nf = 2"), ['"f" is a function and cannot be reassigned.']);
});

test("duplicate declarations and use before declaration", () => {
  assert.match(messages("let a = 1\nlet a = 2")[0], /already declared/);
  assert.match(messages("print(x)\nlet x = 1")[0], /used before it is declared/);
  assert.deepEqual(messages("func f() { return later }\nlet later = 1\nf()"), []);
  assert.deepEqual(messages("print(f())\nfunc f() { return 1 }"), []);
});

test("argument counts are checked for known functions", () => {
  assert.deepEqual(messages("func f(a, b = 1) {}\nf()"), ["f expects 1 to 2 arguments, but is called with 0."]);
  assert.deepEqual(messages("len()"), ["len expects 1 argument, but is called with 0."]);
  assert.deepEqual(messages("import math\nmath.sqrt(1, 2)"), ["math.sqrt expects 1 argument, but is called with 2."]);
  assert.deepEqual(messages("class P { func init(n) {} }\nP()"), ["P expects 1 argument, but is called with 0."]);
});

test("modules and module members are checked", () => {
  assert.deepEqual(messages("import maths"), ['Unknown module "maths".']);
  assert.deepEqual(messages("import math\nmath.sqr(4)"), ['Module "math" has no member "sqr".']);
  assert.deepEqual(messages("from fs import reed"), ['"fs" has no export named "reed".']);
});

test("literal values are checked against type annotations", () => {
  assert.deepEqual(messages('let x: int = "hi"'), ['"x" must be int, but this is a string.']);
  assert.deepEqual(messages("let x: int = 1.5"), ['"x" must be int, but this is a float.']);
  assert.deepEqual(messages("let x: float = 1\nlet y: string? = null\nlet z: [int] = [1, 2]"), []);
  assert.deepEqual(messages('func f(a: int) {}\nf("1")'), ['Parameter "a" of f must be int, but this is a string.']);
  assert.deepEqual(messages('func f() -> void { return 1 }'), ['"f" is declared to return void, so it cannot return a value.']);
  assert.deepEqual(messages("let x: Strng = 1"), ['Unknown type "Strng".']);
});

test("obvious type errors between literals", () => {
  assert.deepEqual(messages('let x = "5" + 2'), ['Cannot use "+" with a string and an int.']);
  assert.deepEqual(messages('let x = "a" + "b"\nlet y = 1 + 2.5'), []);
});

test("self fields and methods are checked inside classes", () => {
  assert.deepEqual(messages("class P {\n let name\n func f() { self.nmae = 1 }\n}"), ['P has no field or method "nmae".']);
  assert.deepEqual(messages("class A { let x }\nclass B extends A { func f() { return self.x } }"), []);
});

test("valid programs produce no diagnostics", () => {
  const src = `
import math
from json import parse

const appName = "Demo"

class Player {
    let name
    let coins = 0
    func init(name) { self.name = name }
    func add(n: int) { self.coins += n }
}

func main() {
    let p = Player("Hugo")
    p.add(5)
    for i in 1..3 {
        print("{appName} {p.name} {i} {math.sqrt(16)}")
    }
    let data = parse("[1]")
    let double = x => x * 2
    print(double(data[0]))
}

main()
`;
  assert.deepEqual(messages(src), []);
});
