"use strict";

const { Diagnostic, formatDiagnostic } = require("../../diagnostics/src");
const { repr, isPlainObject } = require("./values");

// Every location in compiled code refers to an entry in this table:
// { file, line, column, length, fn, a, b }  (a/b: source text of operands)
const locations = [];
const sources = new Map(); // file -> source text

function registerSource(file, source) {
  sources.set(file, source);
}

function registerLocations(list) {
  const base = locations.length;
  for (const loc of list) locations.push(loc);
  return base;
}

function nextLocationBase() {
  return locations.length;
}

// The value a KIVO program sees in `catch error`.
// Fields: message, kind, value, file, line, column
class KivoError extends Error {
  constructor(message, { kind = "Error", hint = null, value, loc = null, internal = false } = {}) {
    super(message);
    this.name = "KivoError";
    this.kind = kind;
    this.hint = hint;
    this.value = value === undefined ? message : value;
    this.loc = loc;
    this.internal = internal;
  }
}

// A runtime error raised by the KIVO runtime itself (wrong types, missing properties, ...).
function rtError(message, hint = null, kind = "RuntimeError") {
  return new KivoError(message, { kind, hint });
}

function typeError(message, hint = null) {
  return new KivoError(message, { kind: "TypeError", hint });
}

function locate(err, locIndex) {
  if (err instanceof KivoError) {
    if (err.loc === null && locIndex !== undefined) err.loc = locIndex;
    return err;
  }
  return fromJsError(err, locIndex);
}

// Convert host (JavaScript / Node) errors into KIVO errors with readable messages.
function fromJsError(err, locIndex) {
  if (err instanceof KivoError) return err;
  if (err instanceof RangeError && /call stack/i.test(err.message)) {
    const e = new KivoError("Too much recursion: a function kept calling itself without stopping.", {
      kind: "RuntimeError",
      hint: "Make sure every recursive function has a case where it returns without calling itself again.",
    });
    e.loc = locIndex ?? null;
    const m = /at (?:async )?(?:Object\.)?k\$(\w+)/.exec(err.stack || "");
    if (m) e.message = `Too much recursion: "${m[1]}" kept calling itself without stopping.`;
    return e;
  }
  if (err instanceof ReferenceError && /before initialization/.test(err.message)) {
    const m = /'k\$(\w+)'/.exec(err.message);
    const e = new KivoError(`"${m ? m[1] : "A variable"}" was used before its declaration ran.`, {
      kind: "NameError",
      hint: "A function used it before the line that declares it was reached. Move the declaration higher up, or call the function later.",
    });
    e.loc = locIndex ?? null;
    return e;
  }
  if (err && err.code === "ENOENT") {
    return Object.assign(new KivoError(`File or directory not found: ${err.path || ""}`.trim(), { kind: "IOError" }), { loc: locIndex ?? null });
  }
  if (err && err.code === "EACCES") {
    return Object.assign(new KivoError(`Permission denied: ${err.path || ""}`.trim(), { kind: "IOError" }), { loc: locIndex ?? null });
  }
  if (err && err.code === "EISDIR") {
    return Object.assign(new KivoError(`Expected a file but found a directory: ${err.path || ""}`.trim(), { kind: "IOError" }), { loc: locIndex ?? null });
  }
  if (err instanceof Error) {
    const e = new KivoError(err.message, { kind: err.code ? "IOError" : "RuntimeError", internal: true });
    e.loc = locIndex ?? null;
    e.cause = err;
    return e;
  }
  // a thrown non-error value from native code
  const e = new KivoError(typeof err === "string" ? err : repr(err), { value: err });
  e.loc = locIndex ?? null;
  return e;
}

// `throw value` in KIVO
function makeThrown(value, locIndex) {
  if (value instanceof KivoError) {
    if (value.loc === null) value.loc = locIndex;
    return value;
  }
  let message;
  if (typeof value === "string") message = value;
  else if (isPlainObject(value) && typeof value.message === "string") message = value.message;
  else message = repr(value);
  const e = new KivoError(message, { kind: "Error", value });
  e.loc = locIndex;
  e.thrown = true;
  return e;
}

function toDiagnostic(err) {
  const loc = err.loc !== null && err.loc !== undefined ? locations[err.loc] : null;
  let message = err.message;
  if (err.thrown) message = `Uncaught error: ${err.message}`;
  else if (err.kind === "Error" && !err.loc) message = err.message;
  return new Diagnostic({
    kind: err.thrown ? "thrown" : err.kind === "TypeError" || err.kind === "ValidationError" ? "type" : "runtime",
    message,
    file: loc ? loc.file : null,
    line: loc ? loc.line : 0,
    column: loc ? loc.column : 0,
    length: loc ? loc.length : 1,
    hint: err.hint,
    context: loc && loc.fn ? `in func ${loc.fn}` : null,
  });
}

function formatRuntimeError(err, { color = false } = {}) {
  const kerr = err instanceof KivoError ? err : fromJsError(err);
  const diag = toDiagnostic(kerr);
  let text = formatDiagnostic(diag, diag.file ? sources.get(diag.file) : null, { color });
  if (kerr.internal && process.env.KIVO_DEBUG && kerr.cause) text += "\n\n" + kerr.cause.stack;
  return text;
}

function locationOf(index) {
  return locations[index] || null;
}

module.exports = {
  KivoError,
  rtError,
  typeError,
  locate,
  fromJsError,
  makeThrown,
  toDiagnostic,
  formatRuntimeError,
  registerSource,
  registerLocations,
  nextLocationBase,
  locationOf,
  locations,
  sources,
};
