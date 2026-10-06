"use strict";

// Metadata about built-in functions, methods and standard modules, taken
// straight from the runtime so documentation never drifts from behaviour.

const { builtins, methods, stdlib, rt } = require("../../runtime/src");
const META = Symbol.for("kivo.meta");

function describeFn(f) {
  const m = f[META];
  return { kind: "func", sig: m.sig, doc: m.doc, min: m.min, max: m.max, params: m.params };
}

const globals = {};
for (const [name, f] of Object.entries(builtins)) globals[name] = describeFn(f);

const modules = {};
for (const name of stdlib.names) {
  let mod;
  try {
    mod = stdlib.load(name, rt);
  } catch {
    continue;
  }
  const docs = mod.__docs;
  const members = {};
  for (const [key, info] of Object.entries(docs.members)) {
    const value = mod[key];
    if (typeof value === "function" && value[META]) members[key] = describeFn(value);
    else members[key] = { kind: "value", sig: info.sig, doc: info.doc };
  }
  modules[name] = { doc: docs.doc, members };
}

function methodTable(table) {
  const out = {};
  for (const [name, m] of Object.entries(table)) out[name] = { kind: "func", sig: `func ${m.sig}`, doc: m.doc, min: m.min, max: m.max };
  return out;
}

const valueMethods = {
  string: { length: { kind: "value", sig: "length: int", doc: "Number of characters." }, ...methodTable(methods.string) },
  array: { length: { kind: "value", sig: "length: int", doc: "Number of items." }, ...methodTable(methods.array) },
  range: { start: { kind: "value", sig: "start: int", doc: "First number." }, end: { kind: "value", sig: "end: int", doc: "Last number (or the bound, for ..<)." }, length: { kind: "value", sig: "length: int", doc: "How many numbers the range contains." }, ...methodTable(methods.range) },
  bytes: { length: { kind: "value", sig: "length: int", doc: "Number of bytes." }, ...methodTable(methods.bytes) },
  error: {
    message: { kind: "value", sig: "message: string", doc: "What went wrong." },
    kind: { kind: "value", sig: "kind: string", doc: 'The kind of error, like "Error", "TypeError" or "IOError".' },
    value: { kind: "value", sig: "value: any", doc: "The value that was thrown." },
    file: { kind: "value", sig: "file: string?", doc: "File where the error happened." },
    line: { kind: "value", sig: "line: int?", doc: "Line where the error happened." },
    column: { kind: "value", sig: "column: int?", doc: "Column where the error happened." },
  },
};

module.exports = { globals, modules, valueMethods };
