"use strict";

// Checked operations used by compiled KIVO code. Every operation that can go
// wrong receives a location index so errors point at the exact source position.

const { META, MODULE, Range, KivoClass, KivoType, classOf, isPlainObject, isBytes, isPromise, typeName, describeType, repr, equals } = require("./values");
const { KivoError, locate, makeThrown, fromJsError, locations } = require("./errors");
const types = require("./types");
const { suggest } = require("../../diagnostics/src");

const hasOwn = Object.prototype.hasOwnProperty;
const READY = Symbol("kivo.ready");

function at(locIndex) {
  return locations[locIndex] || {};
}

function fail(message, locIndex, hint = null, kind = "RuntimeError") {
  const e = new KivoError(message, { kind, hint });
  e.loc = locIndex;
  return e;
}

function textOf(locIndex, which) {
  const l = at(locIndex);
  return l[which] || null;
}

function short(text, max = 40) {
  if (!text) return text;
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function valuePreview(v) {
  if (typeof v === "string") return ` (${repr(short(v, 30), true)})`;
  if (typeof v === "number" || typeof v === "boolean") return ` (${repr(v)})`;
  return "";
}

// ------------------------------------------------------------------ arithmetic

const OP_VERBS = { "+": "add", "-": "subtract", "*": "multiply", "/": "divide", "%": "take the remainder of" };

function binaryError(op, a, b, locIndex) {
  const aText = short(textOf(locIndex, "a")) || "the left side";
  const bText = short(textOf(locIndex, "b")) || "the right side";
  if (isPromise(a) || isPromise(b)) {
    const which = isPromise(a) ? aText : bText;
    return fail(`"${which}" is an async result that has not finished yet.`, locIndex, `Wait for it with await:\n\n    let value = await ${which}`);
  }
  if (a === null || a === undefined || b === null || b === undefined) {
    const which = a === null || a === undefined ? aText : bText;
    return fail(`"${which}" is null, so it cannot be used with "${op}".`, locIndex, `Make sure it has a value first, or provide a default with ??:\n\n    (${which} ?? 0) ${op} ...`);
  }
  const ta = typeName(a);
  const tb = typeName(b);
  if (op === "+" && ta === "string" && tb === "number") {
    return fail(`Cannot add a string and a number.`, locIndex, `KIVO never converts types behind your back. Convert explicitly:\n\n    number(${aText}) + ${bText}     // math\n    ${aText} + string(${bText})     // text\n\nOr use interpolation: "...{${bText}}"`, "TypeError");
  }
  if (op === "+" && ta === "number" && tb === "string") {
    return fail(`Cannot add a number and a string.`, locIndex, `KIVO never converts types behind your back. Convert explicitly:\n\n    ${aText} + number(${bText})     // math\n    string(${aText}) + ${bText}     // text`, "TypeError");
  }
  if (op === "+" && (ta === "string" || tb === "string")) {
    const other = ta === "string" ? bText : aText;
    return fail(`Cannot add a ${ta} and ${describeType(ta === "string" ? b : a).replace(/^an? /, "a ")}.`, locIndex, `Convert it to text first with string(${other}), or use interpolation: "...{${other}}"`, "TypeError");
  }
  if (op === "+" && ta === "array" && tb === "array") {
    return fail(`Arrays cannot be added with "+".`, locIndex, `Combine them with concat or spread:\n\n    ${aText}.concat(${bText})\n    [...${aText}, ...${bText}]`, "TypeError");
  }
  if (op === "*" && ta === "string" && tb === "number") {
    return fail(`Cannot multiply a string by a number.`, locIndex, `To repeat text use repeat:\n\n    ${aText}.repeat(${bText})`, "TypeError");
  }
  if (ta === "string" && tb === "string") {
    return fail(`Cannot ${OP_VERBS[op]} strings with "${op}".`, locIndex, `If they contain numbers, convert them first:\n\n    number(${aText}) ${op} number(${bText})`, "TypeError");
  }
  const what = ta === tb ? `two ${ta === "async result" ? "async results" : ta + "s"}` : `${describeType(a)} and ${describeType(b)}`;
  return fail(`Cannot use "${op}" with ${what}.`, locIndex, `"${op}" works on numbers${op === "+" ? " (and joins two strings)" : ""}.`, "TypeError");
}

function add(a, b, l) {
  if (typeof a === "number" && typeof b === "number") return a + b;
  if (typeof a === "string" && typeof b === "string") return a + b;
  throw binaryError("+", a, b, l);
}

function sub(a, b, l) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  throw binaryError("-", a, b, l);
}

function mul(a, b, l) {
  if (typeof a === "number" && typeof b === "number") return a * b;
  throw binaryError("*", a, b, l);
}

function div(a, b, l) {
  if (typeof a === "number" && typeof b === "number") {
    if (b === 0) {
      const bText = short(textOf(l, "b")) || "the divisor";
      throw fail("Division by zero.", l, `Check the divisor before dividing:\n\n    if ${bText} != 0 {\n        ...\n    }`);
    }
    return a / b;
  }
  throw binaryError("/", a, b, l);
}

function mod(a, b, l) {
  if (typeof a === "number" && typeof b === "number") {
    if (b === 0) throw fail("Remainder by zero.", l, "The right side of % must not be 0.");
    const r = a % b;
    return r !== 0 && (r < 0) !== (b < 0) ? r + b : r; // result has the sign of the divisor
  }
  throw binaryError("%", a, b, l);
}

function neg(a, l) {
  if (typeof a === "number") return -a;
  const t = short(textOf(l, "a")) || "the value";
  if (typeof a === "string") throw fail(`Cannot negate a string.`, l, `Convert it to a number first:\n\n    -number(${t})`, "TypeError");
  throw fail(`Cannot negate ${describeType(a)}${a === null ? ` ("${t}" is null)` : ""}.`, l, `"-" works on numbers only.`, "TypeError");
}

function compareError(op, a, b, l) {
  if (a === null || a === undefined || b === null || b === undefined) {
    const which = a === null || a === undefined ? textOf(l, "a") : textOf(l, "b");
    return fail(`"${short(which)}" is null, so it cannot be compared with "${op}".`, l, `Check for null first:\n\n    if ${short(which)} != null and ... { }`);
  }
  if (isPromise(a) || isPromise(b)) return binaryError(op, a, b, l);
  const ta = typeName(a);
  const tb = typeName(b);
  let hint = `"${op}" compares two numbers or two strings.`;
  if ((ta === "string" && tb === "number") || (ta === "number" && tb === "string")) {
    const strSide = ta === "string" ? textOf(l, "a") : textOf(l, "b");
    hint = `Convert the text to a number first:\n\n    number(${short(strSide)})`;
  }
  return fail(`Cannot compare ${describeType(a)} with ${describeType(b)} using "${op}".`, l, hint, "TypeError");
}

function lt(a, b, l) {
  if ((typeof a === "number" && typeof b === "number") || (typeof a === "string" && typeof b === "string")) return a < b;
  throw compareError("<", a, b, l);
}
function gt(a, b, l) {
  if ((typeof a === "number" && typeof b === "number") || (typeof a === "string" && typeof b === "string")) return a > b;
  throw compareError(">", a, b, l);
}
function le(a, b, l) {
  if ((typeof a === "number" && typeof b === "number") || (typeof a === "string" && typeof b === "string")) return a <= b;
  throw compareError("<=", a, b, l);
}
function ge(a, b, l) {
  if ((typeof a === "number" && typeof b === "number") || (typeof a === "string" && typeof b === "string")) return a >= b;
  throw compareError(">=", a, b, l);
}

function eq(a, b) {
  return a === b || equals(a, b);
}
function neq(a, b) {
  return !(a === b || equals(a, b));
}

// Conditions must be booleans: KIVO has no "truthy" values.
function cond(v, l) {
  if (v === true || v === false) return v;
  const text = short(textOf(l, "a")) || "the condition";
  let hint;
  switch (typeName(v)) {
    case "null":
      hint = `Compare with null explicitly:\n\n    if ${text} != null { ... }`;
      break;
    case "number":
      hint = `Compare it explicitly:\n\n    if ${text} != 0 { ... }`;
      break;
    case "string":
      hint = `Compare it explicitly:\n\n    if ${text} != "" { ... }`;
      break;
    case "array":
      hint = `Check the length explicitly:\n\n    if len(${text}) > 0 { ... }`;
      break;
    case "async result":
      hint = `Wait for it with await:\n\n    if await ${text} { ... }`;
      break;
    default:
      hint = `Write a comparison that results in true or false.`;
  }
  return failCond(v, text, hint, l);
}

function failCond(v, text, hint, l) {
  throw fail(`"${text}" is ${describeType(v)}${valuePreview(v)}, but a condition must be true or false.`, l, `KIVO does not guess whether values count as true. ${hint}`, "TypeError");
}

function not(v, l) {
  return !cond(v, l);
}

function range(start, end, inclusive, l) {
  if (typeof start !== "number" || typeof end !== "number") {
    const bad = typeof start !== "number" ? start : end;
    throw fail(`Ranges need numbers, but got ${describeType(bad)}${valuePreview(bad)}.`, l, `Example:\n\n    for i in 1..10 { ... }`, "TypeError");
  }
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw fail(`Ranges need whole numbers, but got ${repr(Number.isInteger(start) ? end : start)}.`, l, "Use math.floor() or math.round() to get a whole number.", "TypeError");
  }
  return new Range(start, end, inclusive);
}

// for i in a..b  (compiled to a counting loop; this only validates the bounds)
function rangeBound(v, l) {
  if (Number.isInteger(v)) return v;
  if (typeof v === "number") throw fail(`Ranges need whole numbers, but got ${repr(v)}.`, l, "Use math.floor() or math.round() to get a whole number.", "TypeError");
  throw fail(`Ranges need numbers, but got ${describeType(v)}${valuePreview(v)}.`, l, typeof v === "string" ? `Convert the text first:\n\n    number(${short(textOf(l, "a"))})` : `Example:\n\n    for i in 1..10 { ... }`, "TypeError");
}

// ------------------------------------------------------------------ strings

function str(v) {
  return typeof v === "string" ? v : repr(v, false);
}

// ------------------------------------------------------------------ member access

let methods = null; // filled in by index.js to avoid a require cycle

function memberError(obj, key, l) {
  const objText = short(textOf(l, "a")) || "the value";
  if (obj === null || obj === undefined) {
    return fail(`"${objText}" is null, so "${key}" cannot be accessed.`, l, `Try checking it first:\n\n    if ${objText} != null {\n        ...${objText}.${key}...\n    }\n\nOr use ?. to get null instead of an error:\n\n    ${objText}?.${key}`);
  }
  if (isPromise(obj)) {
    return fail(`"${objText}" is an async result that has not finished yet, so "${key}" cannot be accessed.`, l, `Did you forget await?\n\n    let result = await ...`);
  }
  if (isPlainObject(obj)) {
    const keys = Object.keys(obj);
    const close = suggest(key, keys);
    let hint = close ? `Did you mean "${close}"?` : keys.length ? `It has: ${keys.slice(0, 8).join(", ")}${keys.length > 8 ? ", ..." : ""}` : "The object is empty.";
    hint += `\n\nIf the property is optional, use ?. to get null when it is missing:\n\n    ${objText}?.${key}`;
    return fail(`"${objText}" has no property "${key}".`, l, hint);
  }
  const cls = classOf(obj);
  if (cls) {
    const names = [...cls.fieldNames, ...cls.allMethodNames()];
    const close = suggest(key, names);
    return fail(`${cls.name} has no field or method "${key}".`, l, close ? `Did you mean "${close}"?` : `Fields and methods of ${cls.name}: ${names.join(", ") || "(none)"}`);
  }
  if (obj && obj[MODULE]) {
    const names = Object.keys(obj);
    const close = suggest(key, names);
    return fail(`Module "${obj[MODULE]}" has no member "${key}".`, l, close ? `Did you mean "${close}"?` : `Available: ${names.join(", ")}`);
  }
  const t = typeName(obj);
  const table = methods.tableFor(obj);
  if (table) {
    const names = Object.keys(table);
    const close = suggest(key, names);
    return fail(`${t[0].toUpperCase() + t.slice(1)}s have no property or method "${key}".`, l, close ? `Did you mean "${close}"?` : `Available: ${names.join(", ")}`);
  }
  return fail(`"${objText}" is ${describeType(obj)}${valuePreview(obj)}, which has no property "${key}".`, l);
}

function get(obj, key, l) {
  if (obj !== null && typeof obj === "object") {
    if (isPlainObject(obj)) {
      if (hasOwn.call(obj, key)) return normalize(obj[key]);
      throw memberError(obj, key, l);
    }
    if (Array.isArray(obj)) {
      if (key === "length") return obj.length;
      return boundBuiltin(methods.array, obj, key, l);
    }
    const cls = classOf(obj);
    if (cls) {
      if (hasOwn.call(obj, key)) return normalize(obj[key]);
      const m = cls.findMethod(key);
      if (m) return bindMethod(m, obj, l);
      throw memberError(obj, key, l);
    }
    if (obj[MODULE]) {
      if (hasOwn.call(obj, key)) return normalize(obj[key]);
      throw memberError(obj, key, l);
    }
    if (obj instanceof Error) {
      return errorField(obj, key, l);
    }
    if (obj instanceof Range) {
      if (key === "start") return obj.start;
      if (key === "end") return obj.end;
      if (key === "length") return obj.length;
      return boundBuiltin(methods.range, obj, key, l);
    }
    if (isBytes(obj)) {
      if (key === "length") return obj.length;
      return boundBuiltin(methods.bytes, obj, key, l);
    }
    if (obj instanceof KivoClass) {
      if (key === "name") return obj.name;
    }
    throw memberError(obj, key, l);
  }
  if (typeof obj === "string") {
    if (key === "length") return obj.length;
    return boundBuiltin(methods.string, obj, key, l);
  }
  if (typeof obj === "function" && key === "name") {
    return (obj[META] && obj[META].name) || obj.name || "";
  }
  throw memberError(obj, key, l);
}

// obj?.key  — null when obj is null or the key is missing
function getOpt(obj, key, l) {
  if (obj === null || obj === undefined) return null;
  if (isPlainObject(obj)) return hasOwn.call(obj, key) ? normalize(obj[key]) : null;
  const cls = classOf(obj);
  if (cls && !hasOwn.call(obj, key) && !cls.findMethod(key)) return null;
  if (obj[MODULE] && !hasOwn.call(obj, key)) return null;
  return get(obj, key, l);
}

function errorField(err, key, l) {
  switch (key) {
    case "message":
      return err.message;
    case "kind":
      return err.kind || "Error";
    case "value":
      return normalize(err.value === undefined ? err.message : err.value);
    case "file":
    case "line":
    case "column": {
      const loc = err.loc != null ? locations[err.loc] : null;
      if (!loc) return null;
      return key === "file" ? loc.file : loc[key];
    }
    default:
      throw fail(`Errors have no property "${key}".`, l, `Errors have: message, kind, value, file, line, column`);
  }
}

function normalize(v) {
  return v === undefined ? null : v;
}

function boundBuiltin(table, obj, key, l) {
  const m = hasOwn.call(table, key) ? table[key] : null;
  if (!m) throw memberError(obj, key, l);
  const bound = function (...args) {
    return m.fn(obj, args, l);
  };
  bound[META] = { name: key, native: true, min: m.min ?? 0, max: m.max ?? Infinity, sig: m.sig };
  return bound;
}

// obj.method without calling it: a function that keeps `self` bound and has
// the method's arity (so callbacks receive the right number of arguments).
function bindMethod(m, self, l) {
  const bound = function (...args) {
    return callFunction(m, args, l, self);
  };
  bound[META] = { ...m[META], bound: true };
  return bound;
}

// ------------------------------------------------------------------ indexing

function indexError(obj, idx, l) {
  const objText = short(textOf(l, "a")) || "the value";
  if (obj === null || obj === undefined) {
    return fail(`"${objText}" is null, so it cannot be indexed.`, l, `Check it first, or use ?. :\n\n    ${objText}?.[${short(textOf(l, "b")) || "index"}]`);
  }
  return fail(`${describeType(obj)[0].toUpperCase() + describeType(obj).slice(1)} cannot be indexed with [ ].`, l, isPromise(obj) ? "Did you forget await?" : "Only arrays, strings and objects support [ ].");
}

function checkArrayIndex(obj, idx, l, kind) {
  if (!Number.isInteger(idx)) {
    if (typeof idx === "string" && /^-?\d+$/.test(idx)) {
      throw fail(`${kind} indexes must be numbers, but got the string ${repr(idx, true)}.`, l, `Convert it first:\n\n    ${short(textOf(l, "a"))}[number(${short(textOf(l, "b"))})]`, "TypeError");
    }
    throw fail(`${kind} indexes must be whole numbers, but got ${describeType(idx)}${valuePreview(idx)}.`, l, null, "TypeError");
  }
  if (idx < 0 || idx >= obj.length) {
    const objText = short(textOf(l, "a")) || kind.toLowerCase();
    const count = obj.length;
    const unit = kind === "String" ? (count === 1 ? "character" : "characters") : count === 1 ? "item" : "items";
    let hint = count === 0 ? `"${objText}" is empty.` : `Valid indexes are 0 to ${count - 1}.`;
    if (idx < 0) hint += ` To get the last item use ${objText}.last().`;
    throw fail(`Index ${idx} is out of range — "${objText}" has ${count} ${unit}.`, l, hint);
  }
}

function index(obj, idx, l) {
  if (Array.isArray(obj)) {
    checkArrayIndex(obj, idx, l, "Array");
    return normalize(obj[idx]);
  }
  if (typeof obj === "string") {
    checkArrayIndex(obj, idx, l, "String");
    return obj[idx];
  }
  if (isPlainObject(obj) || (obj && obj[MODULE])) {
    if (typeof idx !== "string") {
      throw fail(`Object keys must be strings, but got ${describeType(idx)}${valuePreview(idx)}.`, l, `Convert it first:\n\n    ${short(textOf(l, "a"))}[string(${short(textOf(l, "b"))})]`, "TypeError");
    }
    return hasOwn.call(obj, idx) ? normalize(obj[idx]) : null;
  }
  if (classOf(obj) && typeof idx === "string") return getOpt(obj, idx, l);
  if (isBytes(obj)) {
    checkArrayIndex(obj, idx, l, "Bytes");
    return obj[idx];
  }
  throw indexError(obj, idx, l);
}

function indexOpt(obj, idx, l) {
  if (obj === null || obj === undefined) return null;
  if ((Array.isArray(obj) || typeof obj === "string") && Number.isInteger(idx) && (idx < 0 || idx >= obj.length)) return null;
  return index(obj, idx, l);
}

// ------------------------------------------------------------------ assignment

function set(obj, key, value, l) {
  if (isPlainObject(obj)) {
    defineKey(obj, key, value);
    return;
  }
  const cls = classOf(obj);
  if (cls) {
    if (!cls.fieldNames.has(key)) {
      const close = suggest(key, [...cls.fieldNames]);
      throw fail(`${cls.name} has no field "${key}".`, l, close ? `Did you mean "${close}"?` : `Declare it in the class first:\n\n    class ${cls.name} {\n        let ${key}\n        ...\n    }`);
    }
    if (cls.constants.has(key) && hasOwn.call(obj, key) && obj[READY]) {
      throw fail(`"${key}" is a const field of ${cls.name} and cannot be changed.`, l);
    }
    const fieldType = cls.fieldTypes.get(key);
    if (fieldType) checkType(value, fieldType, `Field "${key}" of ${cls.name}`, l);
    obj[key] = value;
    return;
  }
  const objText = short(textOf(l, "a")) || "the value";
  if (obj === null || obj === undefined) {
    throw fail(`"${objText}" is null, so "${key}" cannot be set.`, l, `Create the object first:\n\n    ${objText} = { ${key}: ... }`);
  }
  if (obj[MODULE]) throw fail(`Modules cannot be modified.`, l);
  throw fail(`Cannot set "${key}" on ${describeType(obj)}.`, l, Array.isArray(obj) ? "Arrays have no named properties. Use an object instead: { ... }" : null);
}

function defineKey(obj, key, value) {
  if (key === "__proto__" || key === "constructor" || key === "prototype") {
    Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
  } else {
    obj[key] = value;
  }
}

function setIndex(obj, idx, value, l) {
  if (Array.isArray(obj)) {
    if (Number.isInteger(idx) && idx === obj.length) {
      throw fail(`Index ${idx} is past the end of "${short(textOf(l, "a"))}".`, l, `To add an item, use push:\n\n    ${short(textOf(l, "a"))}.push(value)`);
    }
    checkArrayIndex(obj, idx, l, "Array");
    obj[idx] = value;
    return;
  }
  if (isPlainObject(obj)) {
    if (typeof idx !== "string") {
      throw fail(`Object keys must be strings, but got ${describeType(idx)}${valuePreview(idx)}.`, l, `Convert it first:\n\n    ${short(textOf(l, "a"))}[string(${short(textOf(l, "b"))})] = ...`, "TypeError");
    }
    defineKey(obj, idx, value);
    return;
  }
  if (classOf(obj) && typeof idx === "string") return set(obj, idx, value, l);
  if (typeof obj === "string") throw fail("Strings cannot be changed in place.", l, "Build a new string instead, for example with slice() and +.");
  throw indexError(obj, idx, l);
}

const UPDATE = { "+": add, "-": sub, "*": mul, "/": div, "%": mod };

function updateMember(obj, key, op, value, l) {
  const next = UPDATE[op](get(obj, key, l), value, l);
  set(obj, key, next, l);
}

function updateIndex(obj, idx, op, value, l) {
  const cur = index(obj, idx, l);
  if ((cur === null || cur === undefined) && isPlainObject(obj)) {
    throw fail(`"${short(textOf(l, "a"))}[${short(textOf(l, "b"))}]" is missing, so "${op}=" has nothing to update.`, l, `Provide a starting value:\n\n    ${short(textOf(l, "a"))}[${short(textOf(l, "b"))}] = (${short(textOf(l, "a"))}[${short(textOf(l, "b"))}] ?? 0) ${op} ...`);
  }
  setIndex(obj, idx, UPDATE[op](cur, value, l), l);
}

// ------------------------------------------------------------------ calls

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function signatureOf(meta) {
  if (meta.sig) return meta.sig;
  const params = (meta.params || []).join(", ");
  return `func ${meta.name || ""}(${params})`;
}

function arityError(meta, count, l) {
  const name = meta.name || "This function";
  let expects;
  if (meta.max === Infinity) expects = `at least ${plural(meta.min, "argument")}`;
  else if (meta.min === meta.max) expects = plural(meta.min, "argument");
  else expects = `${meta.min} to ${plural(meta.max, "argument")}`;
  return fail(`${name} expects ${expects}, but was called with ${count}.`, l, signatureOf(meta), "TypeError");
}

function notCallable(f, l) {
  const text = short(textOf(l, "a")) || "This value";
  if (f === null || f === undefined) {
    return fail(`"${text}" is null, so it cannot be called.`, l, null, "TypeError");
  }
  if (isPromise(f)) return fail(`"${text}" is an async result, not a function.`, l, "Did you forget await?", "TypeError");
  return fail(`"${text}" is ${describeType(f)}${valuePreview(f)}, not a function.`, l, null, "TypeError");
}

function callFunction(f, args, l, self) {
  if (typeof f === "function") {
    const meta = f[META];
    if (meta) {
      if (args.length < meta.min || args.length > meta.max) throw arityError(meta, args.length, l);
      if (!meta.native) return f.apply(self, args);
    }
    try {
      const r = f.apply(self, args);
      if (r === undefined) return null;
      if (isPromise(r)) {
        return r.then(normalize, (e) => {
          throw locate(e, l);
        });
      }
      return r;
    } catch (e) {
      throw locate(e, l);
    }
  }
  if (f instanceof KivoClass) return construct(f, args, l);
  if (f instanceof KivoType) {
    if (args.length !== 1) throw fail(`${f.name}(...) expects 1 argument (the value to check), but was called with ${args.length}.`, l, null, "TypeError");
    const problem = types.shapeProblem(args[0], f);
    if (problem) throw fail(`Value does not match type ${f.name}: ${problem}.`, l, null, "ValidationError");
    return args[0];
  }
  throw notCallable(f, l);
}

function call(f, args, l) {
  return callFunction(f, args, l, undefined);
}

function callOpt(f, args, l) {
  if (f === null || f === undefined) return null;
  return callFunction(f, args, l, undefined);
}

function callMethod(obj, key, args, l) {
  if (obj !== null && typeof obj === "object") {
    if (isPlainObject(obj) || obj[MODULE]) {
      if (hasOwn.call(obj, key)) return callFunction(obj[key], args, l, undefined);
      throw memberError(obj, key, l);
    }
    if (Array.isArray(obj)) return callBuiltin(methods.array, obj, key, args, l);
    const cls = classOf(obj);
    if (cls) {
      if (hasOwn.call(obj, key)) return callFunction(obj[key], args, l, undefined);
      const m = cls.findMethod(key);
      if (m) return callFunction(m, args, l, obj);
      throw memberError(obj, key, l);
    }
    if (obj instanceof Range) return callBuiltin(methods.range, obj, key, args, l);
    if (isBytes(obj)) return callBuiltin(methods.bytes, obj, key, args, l);
  } else if (typeof obj === "string") {
    return callBuiltin(methods.string, obj, key, args, l);
  }
  return callFunction(get(obj, key, l), args, l, undefined);
}

function callMethodOpt(obj, key, args, l) {
  if (obj === null || obj === undefined) return null;
  return callMethod(obj, key, args, l);
}

function callBuiltin(table, obj, key, args, l) {
  const m = hasOwn.call(table, key) ? table[key] : null;
  if (!m) throw memberError(obj, key, l);
  if (args.length < (m.min ?? 0) || args.length > (m.max ?? Infinity)) {
    throw arityError({ name: key, min: m.min ?? 0, max: m.max ?? Infinity, sig: m.sig }, args.length, l);
  }
  try {
    const r = m.fn(obj, args, l);
    return r === undefined ? null : r;
  } catch (e) {
    throw locate(e, l);
  }
}

// Calls a KIVO callback from native code (e.g. array.map), passing only as
// many arguments as the callback declares.
function invoke(f, args, l) {
  if (typeof f === "function") {
    const meta = f[META];
    if (meta && !meta.native) {
      if (args.length > meta.max) args = args.slice(0, meta.max);
      if (args.length < meta.min) throw arityError(meta, args.length, l);
      return f.apply(undefined, args);
    }
    return callFunction(f, args, l, undefined);
  }
  return callFunction(f, args, l, undefined);
}

function expectFunction(f, what, l) {
  if (typeof f === "function" || f instanceof KivoClass) return f;
  throw fail(`${what} must be a function, but got ${describeType(f)}${valuePreview(f)}.`, l, "    items.map(item => item * 2)", "TypeError");
}

function construct(cls, args, l) {
  const obj = Object.create(cls.proto);
  const chain = [];
  for (let c = cls; c; c = c.parent) chain.unshift(c);
  for (const c of chain) c.initFields.call(undefined, obj);
  const init = cls.findMethod("init");
  if (init) {
    const r = callFunction(init, args, l, obj);
    if (isPromise(r)) {
      throw fail(`The init method of ${cls.name} cannot be async.`, l, `Create the object first, then call an async method:\n\n    let x = ${cls.name}()\n    await x.load()`);
    }
  } else if (args.length > 0) {
    throw fail(`${cls.name} has no init method, so it takes no arguments (got ${args.length}).`, l, `Add an init method to accept arguments:\n\n    class ${cls.name} {\n        func init(...) {\n            ...\n        }\n    }`, "TypeError");
  }
  Object.defineProperty(obj, READY, { value: true });
  return obj;
}

function callSuper(parent, self, key, args, l) {
  if (!parent) throw fail(`This class has no parent class, so "super" cannot be used.`, l);
  const m = parent.findMethod(key);
  if (!m) throw fail(`${parent.name} has no method "${key}".`, l);
  return callFunction(m, args, l, self);
}

// ------------------------------------------------------------------ functions & classes

function fn(f, name, params, min, max, isAsync, extra) {
  f[META] = { name, params, min, max, async: isAsync, ...(extra || null) };
  return f;
}

function defineClass(spec) {
  if (spec.parent !== null && spec.parent !== undefined && !(spec.parent instanceof KivoClass)) {
    throw fail(`"${spec.parentName}" is ${describeType(spec.parent)}, not a class, so ${spec.name} cannot extend it.`, spec.loc);
  }
  for (const [name, m] of Object.entries(spec.methods)) {
    if (m[META]) m[META].name = `${spec.name}.${name}`;
  }
  return new KivoClass(spec);
}

function defineType(name, fields) {
  return new KivoType(name, fields);
}

// ------------------------------------------------------------------ iteration

function iter(v, l) {
  if (Array.isArray(v)) return v;
  if (v instanceof Range) return v;
  if (typeof v === "string") return Array.from(v);
  if (isPlainObject(v)) return Object.keys(v);
  if (isBytes(v)) return v;
  if (v && typeof v[Symbol.iterator] === "function" && !(typeof v === "object" && classOf(v))) return v;
  const text = short(textOf(l, "a")) || "the value";
  if (v === null || v === undefined) {
    throw fail(`"${text}" is null, so it cannot be looped over.`, l, `Check it first:\n\n    if ${text} != null {\n        for item in ${text} { ... }\n    }`);
  }
  if (typeof v === "number") {
    throw fail(`Cannot loop over a number.`, l, `To count, use a range:\n\n    for i in 1..${text} { ... }`, "TypeError");
  }
  throw fail(`Cannot loop over ${describeType(v)}.`, l, isPromise(v) ? "Did you forget await?" : "for ... in works with arrays, ranges, strings and objects.", "TypeError");
}

function* pairs(v, l) {
  if (Array.isArray(v) || typeof v === "string" || isBytes(v)) {
    const items = typeof v === "string" ? Array.from(v) : v;
    for (let i = 0; i < items.length; i++) yield [i, items[i]];
    return;
  }
  if (v instanceof Range) {
    let i = 0;
    for (const n of v) yield [i++, n];
    return;
  }
  if (isPlainObject(v)) {
    for (const k of Object.keys(v)) yield [k, v[k]];
    return;
  }
  iter(v, l);
  throw fail(`Cannot loop over ${describeType(v)} with two variables.`, l);
}

// ------------------------------------------------------------------ spread

function spreadArray(v, l) {
  if (Array.isArray(v)) return v;
  if (v instanceof Range) return v.toArray();
  if (typeof v === "string") return Array.from(v);
  throw fail(`Cannot spread ${describeType(v)} into a list.`, l, "... works with arrays, ranges and strings here.", "TypeError");
}

function spreadObject(v, l) {
  if (isPlainObject(v) || classOf(v)) return v;
  if (v === null || v === undefined) return {};
  throw fail(`Cannot spread ${describeType(v)} into an object.`, l, "... inside { } works with objects.", "TypeError");
}

function object(entries) {
  // entries: [key, value, key, value, ...] or spread markers
  const out = {};
  for (let i = 0; i < entries.length; i += 2) defineKey(out, entries[i], entries[i + 1]);
  return out;
}

// ------------------------------------------------------------------ errors & types

function toThrow(value, l) {
  return makeThrown(value, l);
}

function caught(e) {
  return fromJsError(e);
}

function checkType(value, type, what, l) {
  try {
    return types.check(value, type, what);
  } catch (e) {
    throw locate(e, l);
  }
}

function typeRef(binding, name, l) {
  try {
    return types.T.ref(binding, name);
  } catch (e) {
    throw locate(e, l);
  }
}

function awaitValue(v) {
  return v;
}

module.exports = {
  add,
  sub,
  mul,
  div,
  mod,
  neg,
  lt,
  gt,
  le,
  ge,
  eq,
  neq,
  cond,
  not,
  range,
  rangeBound,
  str,
  get,
  getOpt,
  index,
  indexOpt,
  set,
  setIndex,
  updateMember,
  updateIndex,
  call,
  callOpt,
  callMethod,
  callMethodOpt,
  callFunction,
  invoke,
  expectFunction,
  construct,
  callSuper,
  fn,
  defineClass,
  defineType,
  iter,
  pairs,
  spreadArray,
  spreadObject,
  object,
  toThrow,
  caught,
  checkType,
  typeRef,
  awaitValue,
  fail,
  T: types.T,
  _setMethods(m) {
    methods = m;
  },
};
