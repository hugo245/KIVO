"use strict";

// Runtime representation of KIVO values:
//   null      -> null (undefined is normalised to null)
//   bool      -> boolean
//   number    -> number
//   string    -> string
//   array     -> Array
//   object    -> plain Object
//   func      -> Function (KIVO functions carry metadata under META)
//   class     -> KivoClass
//   instance  -> object created from a KivoClass prototype
//   range     -> Range
//   bytes     -> Buffer / Uint8Array
//   error     -> KivoError

const META = Symbol.for("kivo.meta");
const MODULE = Symbol.for("kivo.module");
const CLASS = Symbol.for("kivo.class");

class Range {
  constructor(start, end, inclusive) {
    this.start = start;
    this.end = end;
    this.inclusive = inclusive;
  }
  get last() {
    return this.inclusive ? this.end : this.end - 1;
  }
  get length() {
    return Math.max(0, Math.floor(this.last - this.start) + 1);
  }
  contains(n) {
    return typeof n === "number" && n >= this.start && n <= this.last && Number.isInteger(n - this.start);
  }
  *[Symbol.iterator]() {
    const last = this.last;
    for (let i = this.start; i <= last; i++) yield i;
  }
  toArray() {
    const out = [];
    const last = this.last;
    for (let i = this.start; i <= last; i++) out.push(i);
    return out;
  }
}

class KivoClass {
  constructor({ name, parent, fields, methods, initFields, file }) {
    this.name = name;
    this.parent = parent || null;
    this.ownFields = fields; // [{ name, constant }]
    this.methods = new Map(Object.entries(methods));
    this.initFields = initFields;
    this.file = file;
    const parentProto = parent ? parent.proto : Object.prototype;
    this.proto = Object.create(parentProto);
    Object.defineProperty(this.proto, CLASS, { value: this });
    this.fieldNames = new Set([...(parent ? parent.fieldNames : []), ...fields.map((f) => f.name)]);
    this.constants = new Set([...(parent ? parent.constants : []), ...fields.filter((f) => f.constant).map((f) => f.name)]);
    this.fieldTypes = new Map([...(parent ? parent.fieldTypes : []), ...fields.filter((f) => f.type).map((f) => [f.name, f.type])]);
  }
  findMethod(name) {
    for (let c = this; c; c = c.parent) {
      const m = c.methods.get(name);
      if (m) return m;
    }
    return null;
  }
  allMethodNames() {
    const names = new Set();
    for (let c = this; c; c = c.parent) for (const k of c.methods.keys()) names.add(k);
    return [...names];
  }
  isSubclassOf(other) {
    for (let c = this; c; c = c.parent) if (c === other) return true;
    return false;
  }
}

// User-declared structural type: `type User { id: int, name: string }`
class KivoType {
  constructor(name, fields) {
    this.name = name;
    this.fields = fields; // [{ name, type, optional }]
  }
}

function classOf(value) {
  return value !== null && typeof value === "object" ? value[CLASS] || null : null;
}

function isPlainObject(v) {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function isBytes(v) {
  return v instanceof Uint8Array;
}

function isPromise(v) {
  return v !== null && typeof v === "object" && typeof v.then === "function" && !(MODULE in v) && !isPlainObject(v);
}

function typeName(v) {
  if (v === null || v === undefined) return "null";
  switch (typeof v) {
    case "boolean":
      return "bool";
    case "number":
      return "number";
    case "string":
      return "string";
    case "function":
      return "func";
    default:
      break;
  }
  if (Array.isArray(v)) return "array";
  if (v instanceof KivoClass) return "class";
  if (v instanceof KivoType) return "type";
  if (v instanceof Range) return "range";
  if (isBytes(v)) return "bytes";
  if (v instanceof Error) return "error";
  if (v[MODULE]) return "module";
  const cls = classOf(v);
  if (cls) return cls.name;
  if (isPromise(v)) return "async result";
  return "object";
}

// Article + type, for messages: "a number", "an array", "null"
function describeType(v) {
  const t = typeName(v);
  if (t === "null") return "null";
  if (classOf(v)) return `a ${t} instance`;
  if (t === "async result") return "an async result";
  return (/^[aeiou]/.test(t) ? "an " : "a ") + t;
}

function quote(s) {
  return JSON.stringify(s);
}

function formatNumber(n) {
  if (Number.isNaN(n)) return "nan";
  if (n === Infinity) return "inf";
  if (n === -Infinity) return "-inf";
  if (Object.is(n, -0)) return "0";
  return String(n);
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Human readable representation of a value. Strings are quoted when nested.
function repr(v, nested = false, seen = new Set()) {
  if (v === null || v === undefined) return "null";
  switch (typeof v) {
    case "string":
      return nested ? quote(v) : v;
    case "number":
      return formatNumber(v);
    case "boolean":
      return String(v);
    case "function": {
      const meta = v[META];
      const name = (meta && meta.name) || v.name || "";
      return name ? `<func ${name.replace(/^k\$/, "")}>` : "<func>";
    }
    default:
      break;
  }
  if (v instanceof Range) return `${v.start}${v.inclusive ? ".." : "..<"}${v.end}`;
  if (v instanceof KivoClass) return `<class ${v.name}>`;
  if (v instanceof KivoType) return `<type ${v.name}>`;
  if (isBytes(v)) return `<bytes ${v.length}>`;
  if (v instanceof Error) return `${v.kind || "Error"}: ${v.message}`;
  if (v[MODULE]) return `<module ${v[MODULE]}>`;
  if (isPromise(v)) return "<pending async result — use await>";
  if (seen.has(v)) return Array.isArray(v) ? "[...]" : "{...}";
  seen.add(v);
  try {
    if (Array.isArray(v)) {
      return "[" + v.map((x) => repr(x, true, seen)).join(", ") + "]";
    }
    const cls = classOf(v);
    const keys = Object.keys(v);
    const body = keys.map((k) => `${IDENT_RE.test(k) ? k : quote(k)}: ${repr(v[k], true, seen)}`).join(", ");
    if (cls) return `${cls.name} {${body ? " " + body + " " : ""}}`;
    if (v instanceof Map) return "{" + [...v].map(([k, x]) => `${repr(k, true, seen)}: ${repr(x, true, seen)}`).join(", ") + "}";
    return body ? `{ ${body} }` : "{}";
  } finally {
    seen.delete(v);
  }
}

// Structural equality for arrays and plain objects; identity for everything else.
function equals(a, b, seen) {
  if (a === b) return true;
  if (a === undefined) a = null;
  if (b === undefined) b = null;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object" || typeof b !== "object") {
    return false;
  }
  if (a instanceof Range && b instanceof Range) return a.start === b.start && a.last === b.last;
  if (isBytes(a) && isBytes(b)) return a.length === b.length && a.every((x, i) => x === b[i]);
  const arrays = Array.isArray(a);
  if (arrays !== Array.isArray(b)) return false;
  if (!arrays && !(isPlainObject(a) && isPlainObject(b))) return false;
  seen = seen || new Map();
  if (seen.get(a) === b) return true;
  seen.set(a, b);
  if (arrays) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!equals(a[i], b[i], seen)) return false;
    return true;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!equals(a[k], b[k], seen)) return false;
  }
  return true;
}

module.exports = {
  META,
  MODULE,
  CLASS,
  Range,
  KivoClass,
  KivoType,
  classOf,
  isPlainObject,
  isBytes,
  isPromise,
  typeName,
  describeType,
  repr,
  equals,
  formatNumber,
};
