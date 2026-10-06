"use strict";

// Editor-agnostic KIVO language service. Positions are 0-based offsets into the
// source text; adapters (VS Code extension, a future LSP server) convert them.

const { parse, NodeType: N, walk } = require("../../parser/src");
const { check, BUILTIN_TYPES } = require("../../checker/src");
const builtinInfo = require("../../checker/src/builtin-info");
const { KEYWORDS } = require("../../lexer/src");
const core = require("../../core/src");
const { format: formatSource } = require("../../formatter/src");

// ---------------------------------------------------------------- analysis

const cache = { key: null, value: null };

function analyze(source, file) {
  const key = `${file}\0${source}`;
  if (cache.key === key) return cache.value;
  const { program, errors } = parse(source, { file, recover: true });
  let result;
  try {
    result = check(program, core.checkerOptions(file, source));
  } catch {
    result = { diagnostics: [], symbols: [], references: [], scopes: [] };
  }
  // When the file has syntax errors, statements were skipped, so "unknown name"
  // reports could be wrong. Only keep those for files that parse cleanly.
  const checkerDiags = errors.length ? result.diagnostics.filter((d) => d.kind !== "name") : result.diagnostics;
  const value = { program, parseErrors: errors, diagnostics: [...errors, ...checkerDiags], symbols: result.symbols, references: result.references, scopes: result.scopes, source, file };
  cache.key = key;
  cache.value = value;
  return value;
}

function lineStarts(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") starts.push(i + 1);
  return starts;
}

function offsetAt(source, line, column) {
  const starts = lineStarts(source);
  return (starts[line - 1] ?? source.length) + column - 1;
}

// ---------------------------------------------------------------- diagnostics

function diagnostics(source, file) {
  const a = analyze(source, file);
  return a.diagnostics.map((d) => {
    const start = d.line > 0 ? offsetAt(source, d.line, d.column) : 0;
    return {
      severity: d.severity,
      message: d.message,
      hint: d.hint,
      start,
      end: start + Math.max(1, d.length || 1),
      kind: d.kind,
    };
  });
}

// ---------------------------------------------------------------- helpers

const KEYWORD_DOCS = {
  let: "Declares a variable.\n\n```kivo\nlet name = \"Hugo\"\nlet coins: int = 500\n```",
  const: "Declares a constant that cannot be reassigned.\n\n```kivo\nconst pi = 3.14159\n```",
  func: "Declares a function.\n\n```kivo\nfunc add(a, b) {\n    return a + b\n}\n```",
  return: "Returns a value from the current function.",
  if: "Runs a block when a condition is true. Conditions must be `true` or `false`.\n\n```kivo\nif coins > 100 {\n    print(\"Rich\")\n} else {\n    print(\"Poor\")\n}\n```",
  else: "The block that runs when the `if` condition is false.",
  for: "Loops over arrays, ranges, strings and objects.\n\n```kivo\nfor player in players { }\nfor i in 1..10 { }\nfor index, item in items { }\nfor key, value in object { }\n```",
  in: "Separates the loop variable from what is looped over: `for item in items`.",
  while: "Repeats a block while a condition is true.",
  break: "Stops the innermost loop.",
  continue: "Skips to the next iteration of the innermost loop.",
  import: "Imports a module.\n\n```kivo\nimport math\nimport \"./utils.kivo\" as utils\n```",
  from: "Imports specific names.\n\n```kivo\nfrom fs import read, write\nfrom \"./utils.kivo\" import calculatePrice\n```",
  export: "Makes a declaration available to files that import this one.",
  as: "Renames an import.",
  class: "Declares a class.\n\n```kivo\nclass Player {\n    let name\n    let coins = 0\n\n    func init(name) {\n        self.name = name\n    }\n}\n\nlet p = Player(\"Hugo\")\n```",
  extends: "Inherits fields and methods from a parent class.",
  self: "The current object inside a class method.",
  super: "Calls a method of the parent class: `super.init(name)`.",
  async: "Marks a function as asynchronous so it can use `await`.",
  await: "Waits for an async result.\n\n```kivo\nlet response = await http.get(url)\n```",
  try: "Runs code that might fail.\n\n```kivo\ntry {\n    let data = fs.read(\"data.json\")\n} catch error {\n    print(error.message)\n}\n```",
  catch: "Handles an error thrown inside `try`.",
  finally: "Runs after `try`/`catch`, whether or not an error happened.",
  throw: "Throws an error: `throw \"Something went wrong\"`.",
  and: "Logical AND. Both sides must be `true` or `false`.",
  or: "Logical OR. Both sides must be `true` or `false`.",
  not: "Logical NOT: `if not done { }`.",
  true: "The boolean value true.",
  false: "The boolean value false.",
  null: "The absence of a value. Use `?.` and `??` to work with values that may be null.",
  type: "Declares the shape of an object. Call the type to validate a value.\n\n```kivo\ntype User {\n    id: int\n    name: string\n    email?: string\n}\n\nlet user = User(json.parse(text))\n```",
};

const TYPE_DOCS = {
  any: "Any value.",
  string: "Text.",
  number: "Any number.",
  int: "A whole number.",
  float: "A number that may have a fraction.",
  bool: "`true` or `false`.",
  array: "A list of values.",
  object: "A collection of named values.",
  bytes: "Raw binary data.",
  func: "A function.",
  range: "A range of numbers like `1..10`.",
  error: "An error value.",
  null: "The null value.",
  void: "No value (for functions that return nothing).",
};

let extraTypes = null;
function stdlibTypes() {
  if (extraTypes) return extraTypes;
  extraTypes = {};
  try {
    const web = require("../../runtime/src/stdlib/web").describe(core.rt);
    Object.assign(extraTypes, web);
  } catch {
    /* ignore */
  }
  try {
    extraTypes.HttpResponse = require("../../runtime/src/stdlib/http").describe();
  } catch {
    /* ignore */
  }
  try {
    Object.assign(extraTypes, require("../../runtime/src/stdlib/database").describe(core.rt));
  } catch {
    /* sqlite may be unavailable */
  }
  return extraTypes;
}

function nodeContains(node, offset) {
  return node && node.loc && node.loc.start <= offset && offset <= node.loc.end;
}

function locContains(loc, offset) {
  return loc && loc.start <= offset && offset <= loc.end;
}

// Symbols visible at `offset`, innermost first.
function visibleSymbols(a, offset) {
  const byName = new Map();
  const candidates = a.symbols.filter((s) => s.scope && s.scope.range && s.scope.range.start <= offset && offset <= s.scope.range.end + 1);
  candidates.sort((x, y) => x.scope.range.end - x.scope.range.start - (y.scope.range.end - y.scope.range.start));
  for (const s of candidates) {
    if (byName.has(s.name)) continue;
    const declaredBefore = s.declaredAt <= offset || s.hoisted || s.kind === "class" || s.kind === "type" || s.scope.kind === "module";
    if (!declaredBefore) continue;
    byName.set(s.name, s);
  }
  return [...byName.values()];
}

function symbolAt(a, offset, name) {
  return visibleSymbols(a, offset).find((s) => s.name === name) || null;
}

function membersFromInfo(table, kind = "method") {
  return Object.entries(table).map(([name, m]) => ({ name, kind: m.kind === "func" ? kind : "property", detail: m.sig, doc: m.doc }));
}

function classMembers(a, info) {
  const out = [];
  const seen = new Set();
  let c = info;
  const guard = new Set();
  while (c && !guard.has(c)) {
    guard.add(c);
    for (const [name, f] of c.fields) if (!seen.has(name) && seen.add(name)) out.push({ name, kind: "field", detail: `${c.name}.${name}${f.typeText ? ": " + f.typeText : ""}`, doc: f.doc });
    for (const [name, m] of c.methods) if (!seen.has(name) && seen.add(name)) out.push({ name, kind: "method", detail: m.signature, doc: m.doc });
    if (!c.parent) break;
    const parent = a.symbols.find((s) => s.name === c.parent && s.classInfo);
    c = parent ? parent.classInfo : null;
  }
  return out;
}

function classInfoAt(a, offset) {
  let found = null;
  walk(a.program, (n) => {
    if (n.type === N.ClassDeclaration && nodeContains(n, offset)) found = n;
  });
  if (!found) return null;
  const sym = a.symbols.find((s) => s.node === found && s.classInfo);
  return sym ? sym.classInfo : null;
}

// Members available on the value an expression node produces (best effort).
function membersOfNode(a, node, offset, depth = 0) {
  if (!node || depth > 8) return null;
  switch (node.type) {
    case N.ObjectExpression:
      return node.properties
        .filter((p) => p.type === N.Property)
        .map((p) => ({ name: p.key, kind: p.value.type === N.FunctionExpression ? "method" : "property", detail: `${p.key}${valueType(p.value) ? ": " + valueType(p.value) : ""}`, doc: null, node: p.value }));
    case N.ArrayExpression:
      return membersFromInfo(builtinInfo.valueMethods.array);
    case N.StringLiteral:
    case N.TemplateString:
      return membersFromInfo(builtinInfo.valueMethods.string);
    case N.RangeExpression:
      return membersFromInfo(builtinInfo.valueMethods.range);
    case N.Identifier: {
      const sym = symbolAt(a, offset, node.name);
      return sym ? membersOfSymbol(a, sym, offset, depth + 1) : null;
    }
    case N.SelfExpression: {
      const info = classInfoAt(a, offset);
      return info ? classMembers(a, info) : null;
    }
    case N.MemberExpression: {
      const parent = membersOfNode(a, node.object, offset, depth + 1);
      const m = parent && parent.find((x) => x.name === node.property);
      if (m && m.node) return membersOfNode(a, m.node, offset, depth + 1);
      if (m && m.typeName) return typeMembers(m.typeName);
      return null;
    }
    case N.CallExpression:
      return membersOfCall(a, node, offset, depth);
    case N.AwaitExpression:
      return membersOfNode(a, node.argument, offset, depth + 1);
    default:
      return null;
  }
}

function typeMembers(typeName) {
  const t = typeName.replace(/\?$/, "");
  if (builtinInfo.valueMethods[t]) return membersFromInfo(builtinInfo.valueMethods[t]);
  if (/^\[.*\]$/.test(t)) return membersFromInfo(builtinInfo.valueMethods.array);
  const extra = stdlibTypes()[t];
  if (extra) return membersFromInfo(extra);
  return null;
}

function returnTypeOf(sig) {
  const m = /->\s*(?:async\s+)?([\w[\]?]+)\s*$/.exec(sig || "");
  return m ? m[1] : null;
}

function membersOfCall(a, node, offset, depth) {
  const callee = node.callee;
  if (callee.type === N.Identifier) {
    const sym = symbolAt(a, offset, callee.name);
    if (sym && sym.classInfo) return classMembers(a, sym.classInfo);
    if (sym && sym.kind === "func" && sym.node && sym.node.returnType) return typeMembers(typeTextOf(sym.node.returnType));
    if (!sym && builtinInfo.globals[callee.name]) {
      const rt = returnTypeOf(builtinInfo.globals[callee.name].sig);
      return rt ? typeMembers(rt) : null;
    }
    return null;
  }
  if (callee.type === N.MemberExpression) {
    const owner = membersOfNode(a, callee.object, offset, depth + 1);
    const m = owner && owner.find((x) => x.name === callee.property);
    if (m && m.detail) {
      const rt = returnTypeOf(m.detail);
      if (rt) return typeMembers(rt);
    }
  }
  return null;
}

function typeTextOf(t) {
  switch (t.type) {
    case N.TypeName:
      return t.name;
    case N.NullableType:
      return typeTextOf(t.inner) + "?";
    case N.ArrayType:
      return "[" + typeTextOf(t.element) + "]";
    default:
      return "any";
  }
}

function valueType(node) {
  if (!node) return null;
  switch (node.type) {
    case N.StringLiteral:
    case N.TemplateString:
      return "string";
    case N.NumberLiteral:
      return Number.isInteger(node.value) && !/[.eE]/.test(node.raw || "") ? "int" : "float";
    case N.BooleanLiteral:
      return "bool";
    case N.ArrayExpression:
      return "array";
    case N.ObjectExpression:
      return "object";
    case N.FunctionExpression:
      return "func";
    case N.NullLiteral:
      return "null";
    default:
      return null;
  }
}

function membersOfSymbol(a, sym, offset, depth) {
  if (sym.kind === "module") {
    if (sym.members) return sym.members.map((m) => ({ name: m.name, kind: m.kind === "func" ? "function" : m.kind === "class" ? "class" : "constant", detail: m.sig, doc: m.doc }));
    return null;
  }
  if (sym.classInfo) return null; // the class itself has no members
  if (sym.typeText && typeMembers(sym.typeText)) return typeMembers(sym.typeText);
  if (sym.typeNode) {
    const t = typeTextOf(sym.typeNode);
    const userType = a.symbols.find((s) => s.name === t.replace(/\?$/, "") && (s.classInfo || s.kind === "type"));
    if (userType && userType.classInfo) return classMembers(a, userType.classInfo);
    if (userType && userType.kind === "type") return userType.node.fields.map((f) => ({ name: f.name, kind: "property", detail: `${f.name}${f.optional ? "?" : ""}: ${typeTextOf(f.typeAnnotation)}`, doc: null }));
  }
  if (sym.iterableNode && !sym.loopKey) {
    const it = resolveValue(a, sym.iterableNode, offset, depth + 1);
    if (it && it.type === N.ArrayExpression) {
      const merged = new Map();
      for (const el of it.elements) {
        const ms = membersOfNode(a, el, offset, depth + 1) || [];
        if (el.type !== N.ObjectExpression) return ms;
        for (const m of ms) if (!merged.has(m.name)) merged.set(m.name, m);
      }
      return [...merged.values()];
    }
    if (it && it.type === N.RangeExpression) return null;
  }
  if (sym.valueNode) return membersOfNode(a, sym.valueNode, offset, depth + 1);
  // web handler parameters: func(req, res)
  if (sym.kind === "param" && (sym.name === "res" || sym.name === "response")) return typeMembers("Response");
  if (sym.kind === "param" && (sym.name === "req" || sym.name === "request")) return typeMembers("Request");
  return null;
}

function resolveValue(a, node, offset, depth = 0) {
  if (!node || depth > 8) return node;
  if (node.type === N.Identifier) {
    const sym = symbolAt(a, offset, node.name);
    if (sym && sym.valueNode) return resolveValue(a, sym.valueNode, offset, depth + 1);
  }
  return node;
}

// ---------------------------------------------------------------- completion

const SNIPPETS = {
  func: "func ${1:name}(${2}) {\n\t$0\n}",
  if: "if ${1:condition} {\n\t$0\n}",
  for: "for ${1:item} in ${2:items} {\n\t$0\n}",
  while: "while ${1:condition} {\n\t$0\n}",
  class: "class ${1:Name} {\n\tfunc init(${2}) {\n\t\t$0\n\t}\n}",
  try: "try {\n\t$1\n} catch ${2:error} {\n\t$0\n}",
  type: "type ${1:Name} {\n\t$0\n}",
};

// Finds the expression immediately before a "." at `dotOffset`.
function expressionBeforeDot(a, source, dotOffset) {
  // Prefer an AST node that ends right before the dot.
  let best = null;
  walk(a.program, (n) => {
    if (n.loc && n.loc.end === dotOffset && n.type !== N.ExpressionStatement && n.type !== N.Block && n.type !== N.Program) {
      if (!best || n.loc.end - n.loc.start > best.loc.end - best.loc.start) best = n;
    }
  });
  if (best) return best;
  // Statement failed to parse: re-parse just the text before the dot.
  const lineStart = source.lastIndexOf("\n", dotOffset - 1) + 1;
  const text = source.slice(lineStart, dotOffset);
  const m = /(self|[A-Za-z_]\w*)((?:\??\.[A-Za-z_]\w*)*)\s*$/.exec(text);
  if (!m) {
    if (/"\s*$/.test(text)) return { type: N.StringLiteral, value: "" };
    if (/\]\s*$/.test(text)) return null;
    return null;
  }
  try {
    const exprSource = m[0].trim();
    const pad = " ".repeat(lineStart + m.index);
    const program = parse(pad.replace(/ /g, " ") + exprSource, {});
    const stmt = program.body[0];
    const node = stmt && stmt.type === N.ExpressionStatement ? stmt.expression : null;
    return node;
  } catch {
    return null;
  }
}

function completions(source, offset, file) {
  const a = analyze(source, file);
  const before = source.slice(0, offset);
  const lineText = before.slice(before.lastIndexOf("\n") + 1);
  const items = [];

  // inside a comment or string (but not interpolation): no completions
  if (/\/\/.*$/.test(lineText.replace(/"(?:[^"\\]|\\.)*"/g, '""'))) return [];

  // import contexts
  let m = /^\s*(?:import|from)\s+([\w.]*)$/.exec(lineText);
  if (m) {
    for (const [name, mod] of Object.entries(builtinInfo.modules)) items.push({ label: name, kind: "module", detail: `module ${name}`, documentation: mod.doc });
    return items;
  }
  m = /^\s*from\s+([\w.]+|"[^"]*")\s+import\s+(?:[\w\s,]*,\s*)?(\w*)$/.exec(lineText);
  if (m) {
    const spec = m[1];
    let members = [];
    if (spec.startsWith('"')) {
      if (file) {
        const info = core.exportInfo(require("../../core/src/project").resolveImport(spec.slice(1, -1), file));
        members = info && info.exports ? info.exports : [];
      }
    } else if (builtinInfo.modules[spec]) {
      members = Object.entries(builtinInfo.modules[spec].members).map(([name, x]) => ({ name, ...x }));
    }
    return members.map((x) => ({ label: x.name, kind: x.kind === "func" ? "function" : x.kind === "class" ? "class" : "constant", detail: x.sig, documentation: x.doc }));
  }

  // member access: something.
  m = /(\??\.)\s*([A-Za-z_]\w*)?$/.exec(before);
  if (m && !/\.\.\s*$/.test(before.slice(0, before.length - m[0].length + m[1].length)) && !/^\d/.test(before.slice(-m[0].length - 1))) {
    const dotOffset = before.length - m[0].length;
    if (!/\d$/.test(before.slice(0, dotOffset)) || /[A-Za-z_)\]"]\s*$/.test(before.slice(0, dotOffset))) {
      // "user." alone does not parse; analyse the file with a placeholder name after the dot
      const patched = m[2] ? null : source.slice(0, offset) + "__kivo_complete__" + source.slice(offset);
      const pa = patched ? analyze(patched, file) : a;
      const node = expressionBeforeDot(pa, patched || source, dotOffset);
      const members = node ? membersOfNode(pa, node, offset) : null;
      if (!members) return [];
      return members.map((x) => ({ label: x.name, kind: x.kind, detail: x.detail, documentation: x.doc }));
    }
  }

  // type annotation contexts: "let x: |", "func f(a: |", "-> |", fields of a type declaration
  let inTypeDecl = false;
  walk(a.program, (n) => {
    if (n.type === N.TypeDeclaration && nodeContains(n, offset)) inTypeDecl = true;
  });
  const typeContext =
    /->\s*\[?\w*$/.test(lineText) ||
    /^\s*(?:export\s+)?(?:let|const)\s+\w+\s*:\s*\[?\w*$/.test(lineText) ||
    /\bfunc\b[^)]*[(,]\s*(?:\.\.\.)?\w+\s*:\s*\[?\w*$/.test(lineText) ||
    /\|\s*\w*$/.test(lineText) && /:\s*[\w?[\]]+\s*\|\s*\w*$/.test(lineText) ||
    (inTypeDecl && /^\s*\w+\??\s*:\s*\[?\w*$/.test(lineText));
  if (typeContext) {
    for (const t of BUILTIN_TYPES) items.push({ label: t, kind: "type", detail: `type ${t}`, documentation: TYPE_DOCS[t] });
    for (const s of visibleSymbols(a, offset)) if (s.kind === "class" || s.kind === "type") items.push({ label: s.name, kind: s.kind === "class" ? "class" : "type", detail: `${s.kind} ${s.name}` });
    return items;
  }

  // default: keywords, names in scope, builtins, modules
  const seen = new Set();
  const add = (item) => {
    if (seen.has(item.label)) return;
    seen.add(item.label);
    items.push(item);
  };
  for (const s of visibleSymbols(a, offset)) {
    add({ label: s.name, kind: symbolKind(s), detail: symbolDetail(s), documentation: s.doc || null, sortText: "0" + s.name });
  }
  for (const [name, g] of Object.entries(builtinInfo.globals)) add({ label: name, kind: "function", detail: g.sig, documentation: g.doc, sortText: "1" + name });
  for (const kw of Object.keys(KEYWORDS)) add({ label: kw, kind: "keyword", documentation: KEYWORD_DOCS[kw] || null, sortText: "2" + kw, snippet: SNIPPETS[kw] || null });
  add({ label: "type", kind: "keyword", documentation: KEYWORD_DOCS.type, sortText: "2type", snippet: SNIPPETS.type });
  const imported = new Set(a.symbols.filter((s) => s.kind === "module").map((s) => s.name));
  for (const [name, mod] of Object.entries(builtinInfo.modules)) {
    if (seen.has(name) || imported.has(name)) continue;
    add({ label: name, kind: "module", detail: `import ${name}`, documentation: mod.doc, sortText: "3" + name, autoImport: `import ${name}` });
  }
  return items;
}

function symbolKind(s) {
  switch (s.kind) {
    case "func":
      return "function";
    case "class":
      return "class";
    case "type":
      return "type";
    case "const":
      return s.valueNode && s.valueNode.type === N.FunctionExpression ? "function" : "constant";
    case "module":
      return "module";
    case "import":
      return s.memberKind === "func" ? "function" : s.memberKind === "class" ? "class" : "variable";
    case "param":
      return "variable";
    default:
      return s.valueNode && s.valueNode.type === N.FunctionExpression ? "function" : "variable";
  }
}

function symbolDetail(s) {
  switch (s.kind) {
    case "func":
      return s.signature;
    case "class":
      return `class ${s.name}${s.node && s.node.superClass ? " extends " + s.node.superClass.name : ""}`;
    case "type":
      return `type ${s.name}`;
    case "module":
      return s.moduleName ? `module ${s.moduleName}` : `module ${s.name}`;
    case "import":
      return s.signature || `from ${JSON.stringify(s.importedFrom).replace(/^"(\w+)"$/, "$1")} import ${s.name}`;
    case "param":
      return `(parameter) ${s.name}${s.typeText ? ": " + s.typeText : ""}`;
    default:
      if (s.signature) return s.signature;
      return `${s.kind === "const" ? "const" : "let"} ${s.name}${s.typeText ? ": " + s.typeText : ""}`;
  }
}

// ---------------------------------------------------------------- hover

function wordAt(source, offset) {
  let s = offset;
  let e = offset;
  while (s > 0 && /\w/.test(source[s - 1])) s--;
  while (e < source.length && /\w/.test(source[e])) e++;
  return s === e ? null : { text: source.slice(s, e), start: s, end: e };
}

function hover(source, offset, file) {
  const a = analyze(source, file);
  const word = wordAt(source, offset);
  if (!word) return null;
  const code = (text) => "```kivo\n" + text + "\n```";
  const result = (text, doc) => ({ contents: code(text) + (doc ? "\n\n" + doc : ""), start: word.start, end: word.end });

  // references resolved by the checker
  const ref = a.references.find((r) => locContains(r.loc, offset));
  if (ref) {
    const s = ref.symbol;
    if (s.builtin) return result(s.sig, s.doc);
    if (s.kind === "field") return result(`(field) ${s.className}.${s.name}${s.typeText ? ": " + s.typeText : ""}`, s.doc);
    if (s.kind === "method") return result(s.signature, s.doc);
    if (s.signature && !s.scope) return result(s.signature, s.doc);
    return result(symbolDetail(s), s.doc || moduleDoc(s));
  }
  // declarations
  const decl = a.symbols.find((s) => locContains(s.loc, offset));
  if (decl) return result(symbolDetail(decl), decl.doc || moduleDoc(decl));

  // member access on known values (e.g. "text".upper, items.map, res.json)
  let member = null;
  walk(a.program, (n) => {
    if ((n.type === N.MemberExpression && locContains(n.propertyLoc, offset)) || (n.type === N.Property && locContains(n.keyLoc, offset))) member = n;
  });
  if (member && member.type === N.MemberExpression) {
    const members = membersOfNode(a, member.object, offset);
    const m = members && members.find((x) => x.name === member.property);
    if (m) return result(m.detail || m.name, m.doc);
  }
  if (KEYWORD_DOCS[word.text] && !a.symbols.some((s) => s.name === word.text)) return { contents: KEYWORD_DOCS[word.text], start: word.start, end: word.end };
  if (TYPE_DOCS[word.text]) return result(`type ${word.text}`, TYPE_DOCS[word.text]);
  return null;
}

function moduleDoc(s) {
  if (s.kind === "module" && s.moduleName && builtinInfo.modules[s.moduleName]) return builtinInfo.modules[s.moduleName].doc;
  return null;
}

// ---------------------------------------------------------------- definition

function definition(source, offset, file) {
  const a = analyze(source, file);
  const ref = a.references.find((r) => locContains(r.loc, offset));
  if (!ref || ref.symbol.builtin) return null;
  const s = ref.symbol;
  if (s.kind === "import" && s.importedFrom && file && (s.importedFrom.startsWith(".") || s.importedFrom.startsWith("/"))) {
    const target = require("../../core/src/project").resolveImport(s.importedFrom, file);
    const info = core.exportInfo(target);
    const exp = info && info.exports && info.exports.find((e) => e.name === (s.node.specifiers.find((sp) => sp.local.name === s.name) || {}).imported);
    if (exp) return { file: target, start: exp.loc.start, end: exp.loc.end, line: exp.loc.line, column: exp.loc.column };
    return { file: target, start: 0, end: 0, line: 1, column: 1 };
  }
  if (s.file && s.loc) return { file: s.file, start: s.loc.start, end: s.loc.end, line: s.loc.line, column: s.loc.column };
  if (!s.loc) return null;
  return { file, start: s.loc.start, end: s.loc.end, line: s.loc.line, column: s.loc.column };
}

// ---------------------------------------------------------------- signature help

function parseParams(sig) {
  const open = sig.indexOf("(");
  const close = sig.lastIndexOf(")");
  if (open < 0 || close < open) return [];
  const inner = sig.slice(open + 1, close);
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of inner) {
    if ("([{".includes(ch)) depth++;
    if (")]}".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function signatureHelp(source, offset, file) {
  // find the unclosed "(" before the cursor
  let depth = 0;
  let commas = 0;
  let i = offset - 1;
  let inString = false;
  for (; i >= 0; i--) {
    const ch = source[i];
    if (ch === '"' && source[i - 1] !== "\\") inString = !inString;
    if (inString) continue;
    if (ch === ")" || ch === "]" || ch === "}") depth++;
    else if (ch === "(" || ch === "[" || ch === "{") {
      if (depth === 0) {
        if (ch !== "(") return null;
        break;
      }
      depth--;
    } else if (ch === "," && depth === 0) commas++;
    else if (ch === "\n" && depth === 0 && /^\s*$/.test(source.slice(i + 1, offset))) {
      /* keep scanning: argument lists can span lines */
    }
  }
  if (i < 0) return null;
  const head = source.slice(0, i);
  const m = /((?:self|[A-Za-z_]\w*)(?:\??\.[A-Za-z_]\w*)*)\s*$/.exec(head);
  if (!m) return null;
  const a = analyze(source, file);
  const name = m[1];
  let sig = null;
  let doc = null;
  if (!name.includes(".")) {
    const sym = symbolAt(a, offset, name);
    if (sym) {
      if (sym.classInfo) {
        const init = classMembers(a, sym.classInfo).find((x) => x.name === "init");
        sig = init ? init.detail.replace(/^func init/, name) : `${name}()`;
      } else sig = sym.signature;
      doc = sym.doc;
    } else if (builtinInfo.globals[name]) {
      sig = builtinInfo.globals[name].sig;
      doc = builtinInfo.globals[name].doc;
    }
  } else {
    const dot = name.lastIndexOf(".");
    const objText = name.slice(0, dot).replace(/\?$/, "");
    const prop = name.slice(dot + 1);
    let objNode = null;
    try {
      const p = parse(objText, {});
      objNode = p.body[0] && p.body[0].expression;
    } catch {
      objNode = null;
    }
    const members = objNode ? membersOfNode(a, objNode, offset) : null;
    const member = members && members.find((x) => x.name === prop);
    if (member) {
      sig = member.detail;
      doc = member.doc;
    }
  }
  if (!sig) return null;
  return { label: sig, documentation: doc, parameters: parseParams(sig), activeParameter: commas };
}

// ---------------------------------------------------------------- symbols & folding

function documentSymbols(source, file) {
  const a = analyze(source, file);
  const out = [];
  const rangeOf = (n, nameLoc) => ({ start: n.loc.start, end: n.loc.end, selectionStart: nameLoc.start, selectionEnd: nameLoc.end });
  for (const s of a.program.body) {
    if (s.type === N.FunctionDeclaration) out.push({ name: s.name.name, kind: "function", detail: "", ...rangeOf(s, s.name.loc), children: [] });
    else if (s.type === N.ClassDeclaration) {
      out.push({
        name: s.name.name,
        kind: "class",
        detail: s.superClass ? `extends ${s.superClass.name}` : "",
        ...rangeOf(s, s.name.loc),
        children: [...s.fields.map((f) => ({ name: f.name.name, kind: "field", detail: "", ...rangeOf(f, f.name.loc), children: [] })), ...s.methods.map((m) => ({ name: m.name.name, kind: m.name.name === "init" ? "constructor" : "method", detail: "", ...rangeOf(m, m.name.loc), children: [] }))],
      });
    } else if (s.type === N.TypeDeclaration) out.push({ name: s.name.name, kind: "struct", detail: "type", ...rangeOf(s, s.name.loc), children: [] });
    else if (s.type === N.VariableDeclaration) {
      const ids = s.target.type === N.Identifier ? [s.target] : s.target.type === N.ObjectPattern ? s.target.properties.map((p) => p.value) : s.target.elements;
      for (const id of ids) {
        const isFn = s.value && s.value.type === N.FunctionExpression;
        out.push({ name: id.name, kind: isFn ? "function" : s.kind === "const" ? "constant" : "variable", detail: "", ...rangeOf(s, id.loc), children: [] });
      }
    }
  }
  return out;
}

function foldingRanges(source) {
  const ranges = [];
  const stack = [];
  const regions = [];
  let line = 0;
  let i = 0;
  let lineCommentStart = -1;
  let lastLineComment = -1;
  const flushComments = () => {
    if (lineCommentStart >= 0 && lastLineComment > lineCommentStart) ranges.push({ startLine: lineCommentStart, endLine: lastLineComment, kind: "comment" });
    lineCommentStart = -1;
  };
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\n") {
      line++;
      i++;
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      const lineStart = source.lastIndexOf("\n", i - 1) + 1;
      const lineEnd = source.indexOf("\n", i);
      const commentText = source.slice(i, lineEnd < 0 ? source.length : lineEnd);
      if (/^\/\/\s*#?region\b/.test(commentText)) regions.push(line);
      else if (/^\/\/\s*#?endregion\b/.test(commentText) && regions.length) ranges.push({ startLine: regions.pop(), endLine: line, kind: "region" });
      if (/^\s*$/.test(source.slice(lineStart, i)) && !/^\/\/\s*#?(end)?region\b/.test(commentText)) {
        if (lineCommentStart < 0 || lastLineComment !== line - 1) {
          flushComments();
          lineCommentStart = line;
        }
        lastLineComment = line;
      }
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const startLine = line;
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") line++;
        i++;
      }
      i += 2;
      if (line > startLine) ranges.push({ startLine, endLine: line, kind: "comment" });
      continue;
    }
    if (ch === '"') {
      const triple = source.startsWith('"""', i);
      i += triple ? 3 : 1;
      const startLine = line;
      while (i < source.length) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (triple ? source.startsWith('"""', i) : source[i] === '"') break;
        if (source[i] === "\n") {
          if (!triple) break;
          line++;
        }
        i++;
      }
      i += triple ? 3 : 1;
      if (triple && line > startLine) ranges.push({ startLine, endLine: line });
      continue;
    }
    if (ch === "{" || ch === "[" || ch === "(") stack.push(line);
    else if (ch === "}" || ch === "]" || ch === ")") {
      const start = stack.pop();
      if (start !== undefined && line > start) ranges.push({ startLine: start, endLine: line - 1 });
    }
    i++;
  }
  flushComments();
  return ranges;
}

// The 0-based line where an automatic import should be inserted:
// after the last import at the top of the file.
function importInsertLine(source) {
  const lines = source.split("\n");
  let line = 0;
  for (let i = 0; i < Math.min(lines.length, 200); i++) {
    const text = lines[i];
    if (/^\s*(import|from)\s/.test(text)) line = i + 1;
    else if (text.trim() && !text.trim().startsWith("//") && line > 0) break;
  }
  return line;
}

// ---------------------------------------------------------------- formatting

function format(source, file) {
  return formatSource(source, { file });
}

module.exports = {
  analyze,
  diagnostics,
  completions,
  hover,
  definition,
  signatureHelp,
  documentSymbols,
  foldingRanges,
  format,
  offsetAt,
  importInsertLine,
};
