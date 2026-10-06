"use strict";

// Global functions available in every KIVO file without an import.

const fs = require("fs");
const { native } = require("./native");
const { Range, KivoClass, isPlainObject, isBytes, typeName, describeType, repr, classOf } = require("./values");
const { rtError, typeError, KivoError } = require("./errors");
const io = require("./io");

function parseNumber(text) {
  const t = text.trim();
  if (/^[+-]?(\d[\d_]*(\.\d+)?([eE][+-]?\d+)?|\.\d+)$/.test(t)) return Number(t.replace(/_/g, ""));
  if (/^0x[0-9a-fA-F]+$/.test(t)) return parseInt(t, 16);
  if (/^0b[01]+$/.test(t)) return parseInt(t.slice(2), 2);
  return null;
}

function toNumber(v, fname) {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseNumber(v);
    if (n === null) {
      throw rtError(`Cannot convert ${repr(v.length > 40 ? v.slice(0, 40) + "…" : v, true)} to a number.`, `To check first, use toNumber(), which returns null for invalid input:\n\n    let n = text.toNumber() ?? 0`);
    }
    return n;
  }
  if (typeof v === "boolean") {
    throw typeError(`${fname}() cannot convert a bool.`, "Write the conversion explicitly:\n\n    let n = if flag { 1 } else { 0 }".replace("if flag { 1 } else { 0 }", "0\n    if flag {\n        n = 1\n    }"));
  }
  throw typeError(`${fname}() cannot convert ${describeType(v)}.`, v === null ? "The value is null. Provide a default first:\n\n    number(value ?? \"0\")" : null);
}

function keysOf(obj, fname) {
  if (isPlainObject(obj) || classOf(obj)) return Object.keys(obj);
  throw typeError(`${fname}() needs an object, but got ${describeType(obj)}.`);
}

let stdinBuffer = "";
function readLineSync() {
  const buf = Buffer.alloc(1);
  let line = "";
  if (stdinBuffer) {
    const nl = stdinBuffer.indexOf("\n");
    if (nl >= 0) {
      line = stdinBuffer.slice(0, nl);
      stdinBuffer = stdinBuffer.slice(nl + 1);
      return line.replace(/\r$/, "");
    }
    line = stdinBuffer;
    stdinBuffer = "";
  }
  const bytes = [];
  while (true) {
    let n;
    try {
      n = fs.readSync(0, buf, 0, 1, null);
    } catch (e) {
      if (e.code === "EAGAIN") continue;
      if (e.code === "EOF") break;
      throw e;
    }
    if (n === 0) {
      if (bytes.length === 0 && line === "") return null;
      break;
    }
    if (buf[0] === 10) break;
    bytes.push(buf[0]);
  }
  return (line + Buffer.from(bytes).toString("utf8")).replace(/\r$/, "");
}

const builtins = {
  print: native("print(...values) -> void", "Prints values to the console, separated by spaces.", (...values) => {
    io.write(values.map((v) => (typeof v === "string" ? v : repr(v))).join(" ") + "\n");
  }),
  len: native("len(value: string | array | object) -> int", "Number of characters in a string, items in an array, or keys in an object.", (v) => {
    if (typeof v === "string" || Array.isArray(v) || isBytes(v)) return v.length;
    if (v instanceof Range) return v.length;
    if (isPlainObject(v)) return Object.keys(v).length;
    throw typeError(`len() works on strings, arrays and objects, but got ${describeType(v)}.`);
  }),
  type: native("type(value) -> string", 'Name of the value\'s type: "string", "number", "bool", "array", "object", "func", "null", or a class name.', (v) => typeName(v)),
  string: native("string(value) -> string", "Converts any value to text.", (v) => (typeof v === "string" ? v : repr(v))),
  number: native("number(value: string | number) -> number", "Converts text to a number. Throws an error if the text is not a number.", (v) => toNumber(v, "number")),
  int: native("int(value: string | number) -> int", "Converts to a whole number, dropping any fraction.", (v) => {
    const n = toNumber(v, "int");
    if (!Number.isFinite(n)) throw rtError(`int() cannot convert ${repr(n)}.`);
    return Math.trunc(n);
  }),
  keys: native("keys(object: object) -> [string]", "The property names of an object.", (o) => keysOf(o, "keys")),
  values: native("values(object: object) -> array", "The property values of an object.", (o) => keysOf(o, "values").map((k) => o[k])),
  has: native("has(object: object, key: string) -> bool", "Returns true if the object has the property key.", (o, k) => {
    if (typeof k !== "string") throw typeError(`has() needs a string key, but got ${describeType(k)}.`);
    return keysOf(o, "has").includes(k);
  }),
  remove: native("remove(object: object, key: string) -> bool", "Removes a property from an object. Returns true if it existed.", (o, k) => {
    if (!isPlainObject(o)) throw typeError(`remove() needs an object, but got ${describeType(o)}.`, Array.isArray(o) ? "For arrays use items.remove(value) or items.removeAt(index)." : null);
    if (typeof k !== "string") throw typeError(`remove() needs a string key, but got ${describeType(k)}.`);
    if (!Object.prototype.hasOwnProperty.call(o, k)) return false;
    delete o[k];
    return true;
  }),
  range: native("range(start: int, end: int, step?: int) -> [int]", "An array of numbers from start up to (not including) end.", (a, b, step = 1) => {
    for (const [v, n] of [[a, "start"], [b, "end"], [step, "step"]]) {
      if (!Number.isInteger(v)) throw typeError(`range() ${n} must be a whole number, but got ${describeType(v)}.`);
    }
    if (step === 0) throw rtError("range() step cannot be 0.");
    const out = [];
    if (step > 0) for (let i = a; i < b; i += step) out.push(i);
    else for (let i = a; i > b; i += step) out.push(i);
    return out;
  }),
  assert: native("assert(condition: bool, message?: string) -> void", "Throws an error if condition is false.", (c, message) => {
    if (typeof c !== "boolean") throw typeError(`assert() needs true or false, but got ${describeType(c)}.`);
    if (!c) throw new KivoError(message === undefined ? "Assertion failed." : String(message), { kind: "AssertionError" });
  }),
  input: native("input(prompt?: string) -> string?", "Reads one line of text typed by the user (null at end of input).", (prompt) => {
    if (prompt !== undefined) io.write(typeof prompt === "string" ? prompt : repr(prompt));
    return readLineSync();
  }),
  isinstance: native("isinstance(value, cls: class) -> bool", "Returns true if value is an instance of the class (or a subclass).", (v, cls) => {
    if (!(cls instanceof KivoClass)) throw typeError(`isinstance() needs a class as its second argument, but got ${describeType(cls)}.`);
    const c = classOf(v);
    return c !== null && c.isSubclassOf(cls);
  }),
};

module.exports = { builtins, parseNumber, toNumber };
