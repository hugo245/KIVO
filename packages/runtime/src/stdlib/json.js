"use strict";

const { native, defineModule } = require("../native");
const { KivoError, typeError } = require("../errors");
const { Range, KivoClass, isBytes, isPlainObject, classOf, describeType, isPromise } = require("../values");

function lineCol(text, pos) {
  let line = 1;
  let col = 1;
  for (let i = 0; i < pos && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      col = 1;
    } else col++;
  }
  return { line, col };
}

function parse(text) {
  if (typeof text !== "string") throw typeError(`json.parse() needs a string, but got ${describeType(text)}.`, isBytes(text) ? "Decode the bytes first: data.text()" : null);
  try {
    return JSON.parse(text, (key, value) => {
      if (value && typeof value === "object" && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, "__proto__")) {
        const copy = {};
        for (const k of Object.keys(value)) Object.defineProperty(copy, k, { value: value[k], writable: true, enumerable: true, configurable: true });
        return copy;
      }
      return value;
    });
  } catch (err) {
    const m = /position (\d+)/.exec(err.message);
    let where = "";
    if (m) {
      const { line, col } = lineCol(text, Number(m[1]));
      where = ` at line ${line}, column ${col}`;
    }
    const reason = err.message.replace(/^Unexpected token/, "unexpected character").replace(/ in JSON at position \d+.*$/, "").replace(/, ".*" is not valid JSON$/, "").replace(/ \(line \d+ column \d+\)$/, "");
    throw new KivoError(`Invalid JSON${where}: ${reason}.`, { kind: "JSONError", hint: text.trim() === "" ? "The text is empty." : null });
  }
}

function toPlain(v, seen, path) {
  if (v === null || v === undefined) return null;
  switch (typeof v) {
    case "string":
    case "boolean":
      return v;
    case "number":
      if (!Number.isFinite(v)) throw typeError(`Cannot convert ${v} to JSON${path ? ` (at ${path})` : ""}.`, "JSON only supports finite numbers.");
      return v;
    case "function":
      throw typeError(`Cannot convert a function to JSON${path ? ` (at ${path})` : ""}.`);
    default:
      break;
  }
  if (seen.has(v)) throw typeError(`Cannot convert a value that contains itself to JSON${path ? ` (at ${path})` : ""}.`);
  if (v instanceof Range) return v.toArray();
  if (isBytes(v)) throw typeError(`Cannot convert bytes to JSON${path ? ` (at ${path})` : ""}.`, "Convert them first, for example data.base64()");
  if (v instanceof KivoClass) throw typeError(`Cannot convert a class to JSON.`);
  if (v instanceof Error) return { kind: v.kind || "Error", message: v.message };
  if (isPromise(v)) throw typeError(`Cannot convert an async result to JSON — did you forget await?`);
  seen.add(v);
  try {
    if (Array.isArray(v)) return v.map((x, i) => toPlain(x, seen, `${path}[${i}]`));
    if (isPlainObject(v) || classOf(v)) {
      const out = {};
      for (const k of Object.keys(v)) Object.defineProperty(out, k, { value: toPlain(v[k], seen, path ? `${path}.${k}` : k), enumerable: true, writable: true, configurable: true });
      return out;
    }
    return String(v);
  } finally {
    seen.delete(v);
  }
}

function stringify(value, indent) {
  if (indent !== undefined && indent !== null && !Number.isInteger(indent)) throw typeError("json.stringify() indent must be a whole number.");
  return JSON.stringify(toPlain(value, new Set(), ""), null, indent || undefined);
}

module.exports = () =>
  defineModule("json", "Convert between KIVO values and JSON text.", {
    parse: native("parse(text: string) -> any", "Parses JSON text into KIVO values.", parse),
    stringify: native("stringify(value, indent?: int) -> string", "Converts a value to JSON text.", stringify),
    pretty: native("pretty(value) -> string", "Converts a value to nicely indented JSON text.", (v) => stringify(v, 2)),
  });

module.exports.toPlain = (v) => toPlain(v, new Set(), "");
module.exports.parseJson = parse;
module.exports.stringifyJson = stringify;
