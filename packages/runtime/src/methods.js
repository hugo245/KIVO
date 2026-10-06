"use strict";

// Methods available on built-in values: "text".upper(), items.map(f), ...
// Each entry: { sig, doc, fn(self, args, loc), min, max }

const { Range, isPlainObject, describeType, repr, equals, typeName } = require("./values");
const { rtError, typeError } = require("./errors");
const { parseSignature } = require("./signature");

let core = null; // injected (invoke, cond, ...) to avoid a require cycle

function def(sig, doc, fn) {
  const { min, max } = parseSignature(sig);
  return { sig, doc, fn, min, max };
}

function needString(v, what) {
  if (typeof v !== "string") throw typeError(`${what} must be a string, but got ${describeType(v)}.`);
  return v;
}

function needInt(v, what) {
  if (!Number.isInteger(v)) throw typeError(`${what} must be a whole number, but got ${describeType(v)}${typeof v === "number" ? " (" + v + ")" : ""}.`);
  return v;
}

function needFunc(v, what) {
  if (typeof v !== "function") throw typeError(`${what} must be a function, but got ${describeType(v)}.`, "    items.map(item => item * 2)");
  return v;
}

function needBool(v, what) {
  if (typeof v !== "boolean") {
    throw typeError(`${what} must return true or false, but returned ${describeType(v)}${typeof v === "number" || typeof v === "string" ? " (" + repr(v, true) + ")" : ""}.`, "Write a comparison, for example:\n\n    items.filter(x => x > 10)");
  }
  return v;
}

function clampIndex(i, len) {
  if (i < 0) return Math.max(0, len + i);
  return Math.min(i, len);
}

// ------------------------------------------------------------------ strings

const string = {
  upper: def("upper() -> string", "Returns the text in UPPERCASE.", (s) => s.toUpperCase()),
  lower: def("lower() -> string", "Returns the text in lowercase.", (s) => s.toLowerCase()),
  trim: def("trim() -> string", "Removes whitespace from both ends.", (s) => s.trim()),
  trimStart: def("trimStart() -> string", "Removes whitespace from the start.", (s) => s.trimStart()),
  trimEnd: def("trimEnd() -> string", "Removes whitespace from the end.", (s) => s.trimEnd()),
  split: def("split(separator?: string) -> [string]", "Splits the text into an array. Without a separator, splits on whitespace.", (s, [sep]) => {
    if (sep === undefined || sep === null) return s.trim() === "" ? [] : s.trim().split(/\s+/);
    return s.split(needString(sep, "The separator"));
  }),
  lines: def("lines() -> [string]", "Splits the text into lines.", (s) => (s === "" ? [] : s.replace(/\r?\n$/, "").split(/\r?\n/))),
  chars: def("chars() -> [string]", "Returns an array of the characters in the text.", (s) => Array.from(s)),
  contains: def("contains(text: string) -> bool", "Returns true if the text contains the given text.", (s, [t]) => s.includes(needString(t, "The argument"))),
  startsWith: def("startsWith(prefix: string) -> bool", "Returns true if the text starts with prefix.", (s, [t]) => s.startsWith(needString(t, "The prefix"))),
  endsWith: def("endsWith(suffix: string) -> bool", "Returns true if the text ends with suffix.", (s, [t]) => s.endsWith(needString(t, "The suffix"))),
  indexOf: def("indexOf(text: string) -> int", "Position of the first occurrence of text, or -1.", (s, [t]) => s.indexOf(needString(t, "The argument"))),
  count: def("count(text: string) -> int", "Counts how often text occurs.", (s, [t]) => {
    needString(t, "The argument");
    if (t === "") return s.length + 1;
    return s.split(t).length - 1;
  }),
  replace: def("replace(old: string, new: string) -> string", "Replaces every occurrence of old with new.", (s, [a, b]) => s.split(needString(a, "The text to replace")).join(needString(b, "The replacement"))),
  replaceFirst: def("replaceFirst(old: string, new: string) -> string", "Replaces the first occurrence of old with new.", (s, [a, b]) => {
    needString(a, "The text to replace");
    needString(b, "The replacement");
    const i = s.indexOf(a);
    return i < 0 ? s : s.slice(0, i) + b + s.slice(i + a.length);
  }),
  slice: def("slice(start: int, end?: int) -> string", "Part of the text from start up to (not including) end. Negative numbers count from the end.", (s, [a, b]) => {
    needInt(a, "start");
    if (b !== undefined && b !== null) needInt(b, "end");
    return s.slice(clampIndex(a, s.length), b === undefined || b === null ? s.length : clampIndex(b, s.length));
  }),
  repeat: def("repeat(times: int) -> string", "Repeats the text.", (s, [n]) => {
    needInt(n, "times");
    if (n < 0) throw rtError("repeat() needs a number of 0 or more.");
    return s.repeat(n);
  }),
  padStart: def("padStart(length: int, fill?: string) -> string", "Pads the start until the text has the given length.", (s, [n, f]) => s.padStart(needInt(n, "length"), f === undefined ? " " : needString(f, "fill"))),
  padEnd: def("padEnd(length: int, fill?: string) -> string", "Pads the end until the text has the given length.", (s, [n, f]) => s.padEnd(needInt(n, "length"), f === undefined ? " " : needString(f, "fill"))),
  reverse: def("reverse() -> string", "Returns the text reversed.", (s) => Array.from(s).reverse().join("")),
  isEmpty: def("isEmpty() -> bool", "Returns true if the text is \"\".", (s) => s.length === 0),
  isBlank: def("isBlank() -> bool", "Returns true if the text is empty or only whitespace.", (s) => s.trim().length === 0),
  at: def("at(index: int) -> string?", "Character at index, or null if out of range. Negative indexes count from the end.", (s, [i]) => {
    needInt(i, "index");
    const c = s.at(i);
    return c === undefined ? null : c;
  }),
  toNumber: def("toNumber() -> number?", "Parses the text as a number, or returns null if it is not a number.", (s) => {
    const t = s.trim();
    if (t === "" || !/^[+-]?(\d[\d_]*(\.\d+)?([eE][+-]?\d+)?|\.\d+|0x[0-9a-fA-F]+)$/.test(t)) return null;
    return Number(t.replace(/_/g, ""));
  }),
  bytes: def("bytes() -> bytes", "Encodes the text as UTF-8 bytes.", (s) => Buffer.from(s, "utf8")),
};

// ------------------------------------------------------------------ arrays

function compareValues(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  throw typeError(`Cannot sort ${describeType(a)} and ${describeType(b)} together.`, "Sort by a key that is a number or a string:\n\n    users.sort(user => user.name)");
}

function numbersOnly(arr, what) {
  for (const v of arr) {
    if (typeof v !== "number") throw typeError(`${what}() needs an array of numbers, but it contains ${describeType(v)}${typeof v === "string" ? " (" + repr(v, true) + ")" : ""}.`);
  }
}

const array = {
  push: def("push(...items) -> void", "Adds items to the end of the array.", (a, items) => {
    a.push(...items);
  }),
  pop: def("pop() -> any", "Removes and returns the last item (null if empty).", (a) => (a.length ? a.pop() : null)),
  shift: def("shift() -> any", "Removes and returns the first item (null if empty).", (a) => (a.length ? a.shift() : null)),
  unshift: def("unshift(...items) -> void", "Adds items to the start of the array.", (a, items) => {
    a.unshift(...items);
  }),
  insert: def("insert(index: int, item) -> void", "Inserts item at index.", (a, [i, v]) => {
    needInt(i, "index");
    if (i < 0 || i > a.length) throw rtError(`insert index ${i} is out of range (0 to ${a.length}).`);
    a.splice(i, 0, v);
  }),
  removeAt: def("removeAt(index: int) -> any", "Removes the item at index and returns it.", (a, [i]) => {
    needInt(i, "index");
    if (i < 0 || i >= a.length) throw rtError(`removeAt index ${i} is out of range — the array has ${a.length} items.`);
    return a.splice(i, 1)[0];
  }),
  remove: def("remove(item) -> bool", "Removes the first item equal to item. Returns true if something was removed.", (a, [v]) => {
    const i = a.findIndex((x) => equals(x, v));
    if (i < 0) return false;
    a.splice(i, 1);
    return true;
  }),
  clear: def("clear() -> void", "Removes all items.", (a) => {
    a.length = 0;
  }),
  contains: def("contains(item) -> bool", "Returns true if the array contains item.", (a, [v]) => a.some((x) => equals(x, v))),
  indexOf: def("indexOf(item) -> int", "Index of the first item equal to item, or -1.", (a, [v]) => a.findIndex((x) => equals(x, v))),
  join: def("join(separator?: string) -> string", "Joins the items into one string.", (a, [sep]) => a.map((x) => (typeof x === "string" ? x : repr(x))).join(sep === undefined ? "" : needString(sep, "The separator"))),
  map: def("map(fn: func(item, index)) -> array", "Returns a new array with fn applied to every item.", (a, [f], l) => {
    needFunc(f, "map's argument");
    const out = new Array(a.length);
    for (let i = 0; i < a.length; i++) out[i] = core.invoke(f, [a[i], i], l);
    return out;
  }),
  filter: def("filter(fn: func(item, index) -> bool) -> array", "Returns the items for which fn returns true.", (a, [f], l) => {
    needFunc(f, "filter's argument");
    const out = [];
    for (let i = 0; i < a.length; i++) if (needBool(core.invoke(f, [a[i], i], l), "The filter function")) out.push(a[i]);
    return out;
  }),
  find: def("find(fn: func(item) -> bool) -> any", "Returns the first item for which fn returns true, or null.", (a, [f], l) => {
    needFunc(f, "find's argument");
    for (let i = 0; i < a.length; i++) if (needBool(core.invoke(f, [a[i], i], l), "The find function")) return a[i];
    return null;
  }),
  findIndex: def("findIndex(fn: func(item) -> bool) -> int", "Index of the first item for which fn returns true, or -1.", (a, [f], l) => {
    needFunc(f, "findIndex's argument");
    for (let i = 0; i < a.length; i++) if (needBool(core.invoke(f, [a[i], i], l), "The findIndex function")) return i;
    return -1;
  }),
  any: def("any(fn: func(item) -> bool) -> bool", "Returns true if fn returns true for at least one item.", (a, [f], l) => {
    needFunc(f, "any's argument");
    for (let i = 0; i < a.length; i++) if (needBool(core.invoke(f, [a[i], i], l), "The any function")) return true;
    return false;
  }),
  all: def("all(fn: func(item) -> bool) -> bool", "Returns true if fn returns true for every item.", (a, [f], l) => {
    needFunc(f, "all's argument");
    for (let i = 0; i < a.length; i++) if (!needBool(core.invoke(f, [a[i], i], l), "The all function")) return false;
    return true;
  }),
  count: def("count(fn?: func(item) -> bool) -> int", "Number of items (for which fn returns true).", (a, [f], l) => {
    if (f === undefined) return a.length;
    needFunc(f, "count's argument");
    let n = 0;
    for (let i = 0; i < a.length; i++) if (needBool(core.invoke(f, [a[i], i], l), "The count function")) n++;
    return n;
  }),
  each: def("each(fn: func(item, index)) -> void", "Calls fn for every item.", (a, [f], l) => {
    needFunc(f, "each's argument");
    for (let i = 0; i < a.length; i++) core.invoke(f, [a[i], i], l);
  }),
  reduce: def("reduce(fn: func(total, item), initial) -> any", "Combines all items into one value, starting from initial.", (a, [f, init], l) => {
    needFunc(f, "reduce's first argument");
    let acc = init;
    for (let i = 0; i < a.length; i++) acc = core.invoke(f, [acc, a[i], i], l);
    return acc;
  }),
  sort: def("sort(key?: func(item)) -> array", "Returns a sorted copy. Pass a key function (item => item.name) or a compare function ((a, b) => a - b).", (a, [f], l) => {
    const copy = a.slice();
    if (f === undefined || f === null) return copy.sort(compareValues);
    needFunc(f, "sort's argument");
    const meta = f[Symbol.for("kivo.meta")];
    if (meta && meta.min >= 2) {
      return copy.sort((x, y) => {
        const r = core.invoke(f, [x, y], l);
        if (typeof r !== "number") throw typeError(`The compare function must return a number, but returned ${describeType(r)}.`, "Return a negative number, 0 or a positive number:\n\n    items.sort((a, b) => a.price - b.price)");
        return r;
      });
    }
    const keyed = copy.map((x) => [core.invoke(f, [x], l), x]);
    keyed.sort((p, q) => compareValues(p[0], q[0]));
    return keyed.map((p) => p[1]);
  }),
  reverse: def("reverse() -> array", "Returns a reversed copy.", (a) => a.slice().reverse()),
  slice: def("slice(start: int, end?: int) -> array", "Copy of the items from start up to (not including) end. Negative numbers count from the end.", (a, [s, e]) => {
    needInt(s, "start");
    if (e !== undefined && e !== null) needInt(e, "end");
    return a.slice(clampIndex(s, a.length), e === undefined || e === null ? a.length : clampIndex(e, a.length));
  }),
  concat: def("concat(...arrays) -> array", "Returns a new array with the other arrays appended.", (a, others) => {
    for (const o of others) if (!Array.isArray(o)) throw typeError(`concat() needs arrays, but got ${describeType(o)}.`);
    return a.concat(...others);
  }),
  first: def("first() -> any", "The first item, or null if empty.", (a) => (a.length ? a[0] : null)),
  last: def("last() -> any", "The last item, or null if empty.", (a) => (a.length ? a[a.length - 1] : null)),
  isEmpty: def("isEmpty() -> bool", "Returns true if the array has no items.", (a) => a.length === 0),
  sum: def("sum() -> number", "Adds up all numbers.", (a) => {
    numbersOnly(a, "sum");
    return a.reduce((x, y) => x + y, 0);
  }),
  min: def("min() -> number?", "Smallest number, or null if empty.", (a) => {
    numbersOnly(a, "min");
    return a.length ? Math.min(...a) : null;
  }),
  max: def("max() -> number?", "Largest number, or null if empty.", (a) => {
    numbersOnly(a, "max");
    return a.length ? Math.max(...a) : null;
  }),
  average: def("average() -> number?", "Average of all numbers, or null if empty.", (a) => {
    numbersOnly(a, "average");
    return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  }),
  unique: def("unique() -> array", "Copy without duplicate items.", (a) => {
    const out = [];
    for (const v of a) if (!out.some((x) => equals(x, v))) out.push(v);
    return out;
  }),
  flat: def("flat() -> array", "Flattens one level of nested arrays.", (a) => a.flat(1)),
  groupBy: def("groupBy(key: func(item)) -> object", "Groups items into an object by the (string) key fn returns.", (a, [f], l) => {
    needFunc(f, "groupBy's argument");
    const out = {};
    for (let i = 0; i < a.length; i++) {
      let k = core.invoke(f, [a[i], i], l);
      if (typeof k !== "string") {
        if (typeof k === "number" || typeof k === "boolean") k = String(k);
        else throw typeError(`The groupBy key must be a string, but was ${describeType(k)}.`);
      }
      if (!Object.prototype.hasOwnProperty.call(out, k)) Object.defineProperty(out, k, { value: [], writable: true, enumerable: true, configurable: true });
      out[k].push(a[i]);
    }
    return out;
  }),
  copy: def("copy() -> array", "Returns a shallow copy.", (a) => a.slice()),
};

// ------------------------------------------------------------------ ranges & bytes

const range = {
  toArray: def("toArray() -> [int]", "All numbers in the range as an array.", (r) => r.toArray()),
  contains: def("contains(n: number) -> bool", "Returns true if n is in the range.", (r, [n]) => r.contains(n)),
  map: def("map(fn: func(n)) -> array", "Applies fn to every number in the range.", (r, args, l) => array.map.fn(r.toArray(), args, l)),
  filter: def("filter(fn: func(n) -> bool) -> array", "Numbers in the range for which fn returns true.", (r, args, l) => array.filter.fn(r.toArray(), args, l)),
  each: def("each(fn: func(n)) -> void", "Calls fn for every number in the range.", (r, args, l) => array.each.fn(r.toArray(), args, l)),
  sum: def("sum() -> number", "Adds up all numbers in the range.", (r) => r.toArray().reduce((x, y) => x + y, 0)),
};

const bytes = {
  text: def("text(encoding?: string) -> string", "Decodes the bytes as text (default utf8).", (b, [enc]) => Buffer.from(b).toString(enc === undefined ? "utf8" : needString(enc, "encoding"))),
  hex: def("hex() -> string", "The bytes as a hexadecimal string.", (b) => Buffer.from(b).toString("hex")),
  base64: def("base64() -> string", "The bytes as a base64 string.", (b) => Buffer.from(b).toString("base64")),
  slice: def("slice(start: int, end?: int) -> bytes", "Part of the bytes.", (b, [s, e]) => Buffer.from(b).subarray(needInt(s, "start"), e === undefined ? b.length : needInt(e, "end"))),
  toArray: def("toArray() -> [int]", "The bytes as an array of numbers.", (b) => Array.from(b)),
};

function tableFor(v) {
  if (typeof v === "string") return string;
  if (Array.isArray(v)) return array;
  if (v instanceof Range) return range;
  if (v instanceof Uint8Array) return bytes;
  return null;
}

module.exports = {
  string,
  array,
  range,
  bytes,
  tableFor,
  def,
  needString,
  needInt,
  needFunc,
  needBool,
  _setCore(c) {
    core = c;
  },
  isPlainObject,
  typeName,
};
