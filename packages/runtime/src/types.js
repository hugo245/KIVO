"use strict";

const { KivoClass, KivoType, classOf, isPlainObject, isBytes, typeName, describeType, repr, Range } = require("./values");
const { typeError } = require("./errors");

// Runtime type descriptors for optional type annotations.
const prim = (name, test) => ({ kind: "prim", name, test });

const T = {
  any: prim("any", () => true),
  string: prim("string", (v) => typeof v === "string"),
  number: prim("number", (v) => typeof v === "number"),
  float: prim("float", (v) => typeof v === "number"),
  int: prim("int", (v) => Number.isInteger(v)),
  bool: prim("bool", (v) => typeof v === "boolean"),
  array: prim("array", (v) => Array.isArray(v)),
  object: prim("object", (v) => isPlainObject(v) || classOf(v) !== null),
  bytes: prim("bytes", (v) => isBytes(v)),
  func: prim("func", (v) => typeof v === "function" || v instanceof KivoClass),
  range: prim("range", (v) => v instanceof Range),
  error: prim("error", (v) => v instanceof Error),
  null: prim("null", (v) => v === null || v === undefined),
  void: prim("void", (v) => v === null || v === undefined),
  nullable: (inner) => ({ kind: "nullable", inner }),
  arrayOf: (element) => ({ kind: "array", element }),
  union: (types) => ({ kind: "union", types }),
  // A class or `type` declared in KIVO code, resolved at runtime.
  ref: (binding, name) => {
    if (binding instanceof KivoClass) return { kind: "class", cls: binding, name };
    if (binding instanceof KivoType) return { kind: "type", type: binding, name };
    throw typeError(`"${name}" is not a type.`, `Types are built-in names like string or int, a class, or a type declared with:\n\n    type ${name} {\n        id: int\n    }`);
  },
};

const BUILTIN_TYPE_NAMES = ["any", "string", "number", "float", "int", "bool", "array", "object", "bytes", "func", "range", "error", "null", "void"];

function matches(value, type) {
  if (value === undefined) value = null;
  switch (type.kind) {
    case "prim":
      return type.test(value);
    case "nullable":
      return value === null || matches(value, type.inner);
    case "array":
      return Array.isArray(value) && value.every((v) => matches(v, type.element));
    case "union":
      return type.types.some((t) => matches(value, t));
    case "class": {
      const cls = classOf(value);
      return cls !== null && cls.isSubclassOf(type.cls);
    }
    case "type":
      return shapeProblem(value, type.type) === null;
    default:
      return false;
  }
}

// Returns null when `value` has the declared shape, otherwise a description of the problem.
function shapeProblem(value, ktype, path = "") {
  if (!isPlainObject(value) && classOf(value) === null) return `${path || "value"} is ${describeType(value)}, not an object`;
  for (const field of ktype.fields) {
    const has = Object.prototype.hasOwnProperty.call(value, field.name);
    const v = has ? value[field.name] : null;
    if (!has || v === null) {
      if (field.optional || matches(null, field.type)) continue;
      return `field "${field.name}" is missing`;
    }
    if (!matches(v, field.type)) {
      return `field "${field.name}" should be ${typeToString(field.type)}, but is ${describeType(v)}${typeof v === "string" || typeof v === "number" ? " (" + repr(v, true) + ")" : ""}`;
    }
  }
  return null;
}

function typeToString(type) {
  switch (type.kind) {
    case "prim":
      return type.name;
    case "nullable":
      return typeToString(type.inner) + "?";
    case "array":
      return "[" + typeToString(type.element) + "]";
    case "union":
      return type.types.map(typeToString).join(" | ");
    case "class":
      return type.cls.name;
    case "type":
      return type.type.name;
    default:
      return "?";
  }
}

function conversionHint(value, type) {
  const target = type.kind === "nullable" ? type.inner : type;
  if (target.kind !== "prim") return null;
  if ((target.name === "number" || target.name === "int" || target.name === "float") && typeof value === "string") {
    return `Convert the text to a number first:\n\n    number(${repr(value, true)})`;
  }
  if (target.name === "int" && typeof value === "number") {
    return `${repr(value)} is not a whole number. Round it first:\n\n    math.round(value)   or   int(value)`;
  }
  if (target.name === "string" && (typeof value === "number" || typeof value === "boolean")) {
    return `Convert it to text first:\n\n    string(${repr(value)})`;
  }
  return null;
}

// what: e.g. 'Parameter "a" of add'
function check(value, type, what) {
  if (matches(value, type)) return value === undefined ? null : value;
  let detail = "";
  if (type.kind === "type") {
    const problem = shapeProblem(value, type.type);
    detail = problem ? ` (${problem})` : "";
  }
  const arrayType = type.kind === "nullable" ? type.inner : type;
  if (arrayType.kind === "array" && Array.isArray(value)) {
    const i = value.findIndex((v) => !matches(v, arrayType.element));
    const bad = value[i];
    const shownBad = typeof bad === "string" || typeof bad === "number" || typeof bad === "boolean" ? ` (${repr(bad, true)})` : "";
    throw typeError(`${what} must be ${typeToString(type)}, but item ${i} is ${describeType(bad)}${shownBad}.`, null);
  }
  const shown = typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? ` (${repr(value, true)})` : "";
  throw typeError(`${what} must be ${typeToString(type)}, but got ${describeType(value)}${shown}${detail}.`, conversionHint(value, type));
}

module.exports = { T, matches, check, typeToString, shapeProblem, BUILTIN_TYPE_NAMES, typeName };
