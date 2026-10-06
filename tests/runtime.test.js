"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { run } = require("./helpers");

async function output(src) {
  const r = await run(src);
  if (r.error) throw new Error(r.error);
  return r.output.trimEnd();
}

async function error(src) {
  const r = await run(src);
  assert.ok(r.error, `expected an error for:\n${src}\noutput: ${r.output}`);
  return r.error;
}

test("variables and arithmetic", async () => {
  assert.equal(await output("let a = 5\nlet b = 2\nprint(a + b * 3, (a + b) * 3, a / b, a % b)"), "11 21 2.5 1");
  assert.equal(await output("let x = 1\nx += 2\nx *= 3\nprint(x)"), "9");
});

test("no implicit type conversion", async () => {
  assert.match(await error('let a = "5"\nprint(a + 2)'), /Cannot add a string and a number/);
  assert.match(await error('let a = "5"\nprint(a * 2)'), /Cannot multiply a string by a number/);
  assert.match(await error('let a = 1\nlet b = "1"\nprint(a < b)'), /Cannot compare a number with a string/);
  assert.equal(await output('print(number("5") + 2, "5" == 5, 1 == 1.0)'), "7 false true");
});

test("conditions must be booleans", async () => {
  assert.match(await error('let s = "x"\nif s { }'), /a condition must be true or false/);
  assert.match(await error("let n = null\nwhile n { }"), /if n != null/);
  assert.match(await error("let a = 1\nprint(a and true)"), /a condition must be true or false/);
});

test("functions: closures, defaults, rest, recursion, arity", async () => {
  assert.equal(await output("func f(a, b = 10) { return a + b }\nprint(f(1), f(1, 2))"), "11 3");
  assert.equal(await output("func f(...xs) { return len(xs) }\nprint(f(), f(1, 2, 3))"), "0 3");
  assert.equal(await output("func make() {\n let n = 0\n return () => { n += 1\n return n }\n}\nlet c = make()\nc()\nprint(c())"), "2");
  assert.equal(await output("func fact(n) {\n if n <= 1 { return 1 }\n return n * fact(n - 1)\n}\nprint(fact(12))"), "479001600");
  assert.match(await error("let f = (a, b) => a\nf(1)"), /expects 2 arguments, but was called with 1/);
});

test("first-class functions and callbacks", async () => {
  assert.equal(await output("let double = x => x * 2\nprint([1, 2, 3].map(double))"), "[2, 4, 6]");
  assert.equal(await output("func apply(f, x) { return f(x) }\nprint(apply(func(v) { return v + 1 }, 1))"), "2");
  assert.equal(await output("print([3, 1, 2].sort(), [1, 2, 3, 4].filter(x => x % 2 == 0), [1, 2].map((x, i) => x * i))"), "[1, 2, 3] [2, 4] [0, 2]");
});

test("arrays and objects", async () => {
  assert.equal(await output("let a = [1, 2]\na.push(3)\nprint(a, len(a), a[2], a.contains(2))"), "[1, 2, 3] 3 3 true");
  assert.equal(await output('let o = { name: "Hugo" }\no.age = 18\nprint(o, keys(o), o["name"], o["x"])'), '{ name: "Hugo", age: 18 } ["name", "age"] Hugo null');
  assert.match(await error("let a = [1]\nprint(a[1])"), /Index 1 is out of range — "a" has 1 item/);
  assert.match(await error('let o = { name: "x" }\nprint(o.nam)'), /Did you mean "name"/);
  assert.equal(await output("print([1, [2]] == [1, [2]], { a: [1] } == { a: [1] })"), "true true");
});

test("strings and interpolation", async () => {
  assert.equal(await output('let u = { name: "Hugo", coins: 5 }\nprint("Hello {u.name}, you have {u.coins + 1} coins")'), "Hello Hugo, you have 6 coins");
  assert.equal(await output('print("a-b-c".split("-").join("+"), "Hi".upper(), "  x ".trim(), "abc".length)'), "a+b+c HI x 3");
  assert.equal(await output('print("{[1, 2]} {null} {true} {1.5}")'), "[1, 2] null true 1.5");
});

test("null safety", async () => {
  assert.equal(await output("let u = null\nprint(u?.name, u?.name ?? \"Unknown\", u?.a?.b?.c)"), "null Unknown null");
  assert.equal(await output('let u = { name: "x" }\nprint(u?.missing ?? "default", u?.name)'), "default x");
  assert.equal(await output("let f = null\nprint(f?.(1))"), "null");
  assert.match(await error("let user = null\nprint(user.name)"), /"user" is null, so "name" cannot be accessed/);
});

test("ranges and loops", async () => {
  assert.equal(await output("let s = 0\nfor i in 1..10 { s += i }\nprint(s)"), "55");
  assert.equal(await output("let out = []\nfor i in 0..<3 { out.push(i) }\nprint(out)"), "[0, 1, 2]");
  assert.equal(await output("for k, v in { a: 1 } { print(k, v) }"), "a 1");
  assert.equal(await output("let r = 2..4\nprint(r, r.toArray(), r.contains(3), len(r))"), "2..4 [2, 3, 4] true 3");
  assert.match(await error('let n = "3"\nfor i in 1..n { }'), /Ranges need numbers, but got a string/);
});

test("classes", async () => {
  const src = `
class Animal {
    let name
    func init(name) { self.name = name }
    func speak() { return "..." }
    func describe() { return "{self.name} says {self.speak()}" }
}
class Dog extends Animal {
    func speak() { return "Woof" }
}
let d = Dog("Rex")
print(d.describe(), type(d), isinstance(d, Animal))
`;
  assert.equal(await output(src), "Rex says Woof Dog true");
  assert.match(await error("class P { let a }\nlet p = P()\nlet k = \"b\"\np[k] = 1"), /P has no field "b"/);
  assert.match(await error("class P {}\nlet p = P()\nprint(p.x)"), /P has no field or method "x"/);
});

test("errors: try, catch, throw, finally", async () => {
  assert.equal(await output('try { throw "boom" } catch e { print(e.message, e.kind) }'), "boom Error");
  assert.equal(await output('try { throw { message: "m", code: 1 } } catch e { print(e.message, e.value.code) }'), "m 1");
  assert.equal(await output('let log = []\ntry { log.push(1) } finally { log.push(2) }\nprint(log)'), "[1, 2]");
  assert.equal(await output("try { let x = null\nx.y } catch e { print(e.kind) }"), "RuntimeError");
  assert.match(await error('throw "Something went wrong"'), /Uncaught error: Something went wrong/);
});

test("type annotations are enforced at runtime", async () => {
  assert.match(await error('func f(a: int) { return a }\nlet v = "1"\nf(v)'), /Parameter "a" of f must be int, but got a string \("1"\)/);
  assert.match(await error('func f() -> int { return "x" }\nlet r = f()'), /The return value of f must be int/);
  assert.match(await error('let x: int = 1\nlet s = "a"\nx = s'), /"x" must be int/);
  assert.equal(await output("type P { x: int\ny?: int }\nlet p: P = { x: 1 }\nprint(P({ x: 2, y: 3 }).y)"), "3");
  assert.match(await error('type P { x: int }\nlet v = { x: "1" }\nP(v)'), /field "x" should be int, but is a string/);
});

test("division by zero is an error, not infinity", async () => {
  assert.match(await error("let z = 0\nprint(1 / z)"), /Division by zero/);
});

test("async functions and await", async () => {
  assert.equal(await output("import time\nasync func f(x) {\n await time.sleep(1)\n return x * 2\n}\nprint(await f(21))"), "42");
  assert.match(await error("import time\nasync func f() { return { a: 1 } }\nlet r = f()\nprint(r.a)"), /async result that has not finished yet/);
});

test("standard library basics", async () => {
  assert.equal(await output("import math\nprint(math.sqrt(9), math.round(2.345, 2), math.max(1, 3), math.floor(-1.5))"), "3 2.35 3 -2");
  assert.equal(await output('import json\nlet t = json.stringify({ a: [1, null] })\nprint(t, json.parse(t).a[0])'), '{"a":[1,null]} 1');
  assert.match(await error('import json\njson.parse("\\{bad")'), /Invalid JSON/);
  assert.equal(await output('import crypto\nlet h = crypto.hashPassword("pw")\nprint(crypto.verifyPassword("pw", h), crypto.verifyPassword("no", h), len(crypto.sha256("x")))'), "true false 64");
  assert.equal(await output("import random\nlet n = random.int(1, 3)\nprint(n >= 1 and n <= 3, len(random.uuid()))"), "true 36");
  assert.equal(await output('import path\nprint(path.basename("/a/b/c.kivo", ".kivo"), path.extname("x.json"))'), "c .json");
});

test("prototype pollution is not possible through objects or JSON", async () => {
  assert.equal(await output('import json\nlet o = json.parse("\\{\\"__proto__\\": \\{\\"polluted\\": true}}")\nlet e = {}\nprint(has(e, "polluted"), keys(o))'), 'false ["__proto__"]');
  assert.equal(await output('let o = {}\no["__proto__"] = { x: 1 }\nlet p = {}\nprint(has(p, "x"))'), "false");
});
