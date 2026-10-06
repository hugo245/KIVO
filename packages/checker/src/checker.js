"use strict";

// Static analysis for KIVO programs. Runs before a program executes and
// powers editor diagnostics, hover and go-to-definition.
//
// It finds: unknown names (with suggestions), assignments to constants,
// duplicate declarations, use before declaration, unknown modules and module
// members, wrong argument counts, literal values that contradict type
// annotations, and unknown fields on `self`.

const { NodeType: N } = require("../../parser/src");
const { Diagnostic, suggest } = require("../../diagnostics/src");
const { KEYWORDS } = require("../../lexer/src");
const builtinInfo = require("./builtin-info");

const BUILTIN_TYPES = ["any", "string", "number", "float", "int", "bool", "array", "object", "bytes", "func", "range", "error", "null", "void"];

const FOREIGN_NAMES = {
  undefined: 'KIVO has a single "nothing" value: null.',
  nil: 'KIVO uses null instead of nil.',
  None: "KIVO uses null instead of None.",
  True: "KIVO booleans are lowercase: true.",
  False: "KIVO booleans are lowercase: false.",
  this: 'Inside a class method, KIVO uses "self" instead of "this".',
  console: 'To print something, use print(...):\n\n    print("Hello")',
  println: 'To print something, use print(...):\n\n    print("Hello")',
  puts: 'To print something, use print(...):\n\n    print("Hello")',
  echo: 'To print something, use print(...):\n\n    print("Hello")',
  new: 'KIVO has no "new" keyword. Create objects by calling the class:\n\n    let player = Player("Hugo")',
  require: 'To use a module, import it:\n\n    import fs\n    from "./utils.kivo" import helper',
  str: "To convert a value to text, use string(value).",
  int_: null,
  parseInt: 'To convert text to a number, use number("42") or int("42").',
  parseFloat: 'To convert text to a number, use number("4.2").',
  length: 'To get a length, use len(value) or value.length.',
  self: '"self" can only be used inside a class method.',
};

function locOfName(id) {
  return id.loc;
}

class Scope {
  constructor(parent, kind, node) {
    this.parent = parent;
    this.kind = kind; // module | function | block | class
    this.node = node;
    this.symbols = new Map();
    this.functionScope = kind === "function" || kind === "module" ? this : parent ? parent.functionScope : this;
  }
  lookup(name) {
    for (let s = this; s; s = s.parent) {
      const sym = s.symbols.get(name);
      if (sym) return { sym, scope: s };
    }
    return null;
  }
  allNames() {
    const names = new Set();
    for (let s = this; s; s = s.parent) for (const k of s.symbols.keys()) names.add(k);
    return [...names];
  }
}

class Checker {
  constructor({ file = null, source = "", importInfo = null, packageExists = null } = {}) {
    this.file = file;
    this.source = source;
    this.importInfo = importInfo; // (spec) => { exports: [{name, kind, sig}] } | null
    this.packageExists = packageExists; // (name) => bool
    this.diagnostics = [];
    this.symbols = []; // every declared symbol, for tooling
    this.references = []; // { name, loc, symbol }
    this.scopes = [];
    this.scope = null;
    this.fnStack = [];
    this.classStack = [];
  }

  // ------------------------------------------------------------ reporting

  report(node, message, hint = null, { severity = "error", kind = "name", loc = null } = {}) {
    const l = loc || node.loc;
    this.diagnostics.push(
      new Diagnostic({
        severity,
        kind,
        message,
        file: this.file,
        line: l.line,
        column: l.column,
        length: l.endLine === l.line || l.endLine === undefined ? Math.max(1, l.end - l.start) : 1,
        hint,
      })
    );
  }

  // ------------------------------------------------------------ scopes

  push(kind, node) {
    this.scope = new Scope(this.scope, kind, node);
    this.scope.range = node && node.loc ? { start: node.loc.start, end: node.loc.end } : { start: 0, end: this.source.length };
    this.scopes.push(this.scope);
    return this.scope;
  }

  pop() {
    this.scope = this.scope.parent;
  }

  declare(id, kind, extra = {}) {
    const existing = this.scope.symbols.get(id.name);
    if (existing && !existing.builtin) {
      if (existing.kind !== "hoisted-placeholder") {
        this.report(id, `"${id.name}" is already declared in this scope (line ${existing.loc.line}).`, `Use a different name, or assign to the existing ${existing.kind === "func" ? "function" : "variable"} without "let":\n\n    ${id.name} = ...`);
        return existing;
      }
    }
    const sym = {
      name: id.name,
      kind,
      loc: locOfName(id),
      declaredAt: id.loc.start,
      scope: this.scope,
      used: false,
      ...extra,
    };
    this.scope.symbols.set(id.name, sym);
    this.symbols.push(sym);
    return sym;
  }

  // Pre-declare hoisted declarations (functions, classes, types) so they can
  // be referenced anywhere in the block; lets are declared in order.
  hoist(statements) {
    for (const s of statements) {
      if (s.type === N.FunctionDeclaration) {
        this.declare(s.name, "func", { node: s, signature: this.signature(s, s.name.name), params: s.params, hoisted: true, exported: s.exported, doc: this.docComment(s) });
      } else if (s.type === N.ClassDeclaration) {
        this.declare(s.name, "class", { node: s, hoisted: false, exported: s.exported, doc: this.docComment(s) });
      } else if (s.type === N.TypeDeclaration) {
        this.declare(s.name, "type", { node: s, hoisted: false, exported: s.exported, doc: this.docComment(s) });
      } else if (s.type === N.VariableDeclaration) {
        for (const id of patternIds(s.target)) {
          this.declare(id, s.kind, {
            node: s,
            typeText: s.typeAnnotation ? typeText(s.typeAnnotation) : inferType(s.value),
            typeNode: s.target.type === N.Identifier ? s.typeAnnotation : null,
            valueNode: s.value,
            exported: s.exported,
            doc: this.docComment(s),
            signature: s.value && s.value.type === N.FunctionExpression ? this.signature(s.value, id.name) : null,
            params: s.value && s.value.type === N.FunctionExpression && s.kind === "const" ? s.value.params : null,
          });
        }
      }
    }
  }

  docComment(node) {
    if (!this.comments) return null;
    const line = node.loc.line;
    const lines = [];
    for (let i = this.comments.length - 1; i >= 0; i--) {
      const c = this.comments[i];
      if (c.line >= line) continue;
      const expected = line - 1 - lines.length;
      if (c.line === expected && c.kind === "line") {
        lines.unshift(c.text.replace(/^\/\/\s?/, ""));
        continue;
      }
      if (c.kind === "block" && c.line < line && lines.length === 0) {
        const endLine = c.line + (c.text.match(/\n/g) || []).length;
        if (endLine === line - 1) return c.text.replace(/^\/\*+\s?/, "").replace(/\s*\*+\/$/, "").replace(/^\s*\* ?/gm, "").trim();
      }
      if (c.line < expected) break;
    }
    return lines.length ? lines.join("\n") : null;
  }

  signature(fn, name) {
    const params = fn.params.map((p) => `${p.rest ? "..." : ""}${p.name.name}${p.typeAnnotation ? ": " + typeText(p.typeAnnotation) : ""}${p.defaultValue ? " = " + this.text(p.defaultValue) : ""}`);
    return `${fn.async ? "async " : ""}func ${name}(${params.join(", ")})${fn.returnType ? " -> " + typeText(fn.returnType) : ""}`;
  }

  text(node) {
    return this.source.slice(node.loc.start, node.loc.end);
  }

  // ------------------------------------------------------------ entry

  check(program) {
    this.comments = program.comments || [];
    this.push("module", program);
    this.hoist(program.body);
    for (const s of program.body) this.statement(s);
    this.pop();
    return { diagnostics: this.diagnostics, symbols: this.symbols, references: this.references, scopes: this.scopes };
  }

  statements(list) {
    this.hoist(list);
    for (const s of list) this.statement(s);
  }

  block(block, setup) {
    this.push("block", block);
    if (setup) setup();
    this.statements(block.body);
    this.pop();
  }

  // ------------------------------------------------------------ statements

  statement(s) {
    switch (s.type) {
      case N.VariableDeclaration:
        if (s.value) this.expr(s.value);
        if (s.typeAnnotation) {
          this.typeAnnotation(s.typeAnnotation);
          if (s.value) this.checkLiteralType(s.value, s.typeAnnotation, `"${s.target.name}"`);
        }
        break;
      case N.FunctionDeclaration:
        this.functionNode(s, s.name.name);
        break;
      case N.ClassDeclaration:
        this.classDeclaration(s);
        break;
      case N.TypeDeclaration:
        this.push("block", s);
        for (const f of s.fields) this.typeAnnotation(f.typeAnnotation);
        this.pop();
        this.markDefined(s.name.name);
        break;
      case N.ExpressionStatement:
        this.expr(s.expression);
        break;
      case N.AssignmentStatement:
        this.assignment(s);
        break;
      case N.IfStatement:
        this.expr(s.test);
        this.block(s.consequent);
        if (s.alternate) {
          if (s.alternate.type === N.IfStatement) this.statement(s.alternate);
          else this.block(s.alternate);
        }
        break;
      case N.ForStatement:
        this.expr(s.iterable);
        this.block(s.body, () => {
          if (s.key) this.declare(s.key, "let", { typeText: s.iterable.type === N.RangeExpression ? null : isObjectish(s.iterable) ? "string" : "int" });
          this.declare(s.value, "let", { typeText: s.iterable.type === N.RangeExpression ? "int" : null });
        });
        break;
      case N.WhileStatement:
        this.expr(s.test);
        this.block(s.body);
        break;
      case N.ReturnStatement:
        if (s.argument) {
          this.expr(s.argument);
          const fn = this.fnStack[this.fnStack.length - 1];
          if (fn && fn.returnType && fn.returnType.type === N.TypeName && fn.returnType.name === "void" && s.argument.type !== N.NullLiteral) {
            this.report(s.argument, `${fn.name ? `"${fn.name}"` : "This function"} is declared to return void, so it cannot return a value.`, `Remove the value, or change the return type:\n\n    -> ${inferType(s.argument) || "any"}`, { kind: "type" });
          } else if (fn && fn.returnType) {
            this.checkLiteralType(s.argument, fn.returnType, `The return value of ${fn.name || "this function"}`);
          }
        }
        break;
      case N.ThrowStatement:
        this.expr(s.argument);
        break;
      case N.TryStatement:
        this.block(s.block);
        if (s.handler) this.block(s.handler, () => s.param && this.declare(s.param, "let", { typeText: "error" }));
        if (s.finalizer) this.block(s.finalizer);
        break;
      case N.ImportDeclaration:
        this.importDeclaration(s);
        break;
      case N.BreakStatement:
      case N.ContinueStatement:
        break;
      default:
        break;
    }
  }

  markDefined(name) {
    const sym = this.scope.symbols.get(name);
    if (sym) sym.defined = true;
  }

  importDeclaration(s) {
    let exportsList = null;
    let moduleDoc = null;
    if (s.isPath) {
      if (this.importInfo) {
        const info = this.importInfo(s.source);
        if (info === null) {
          this.report(s, `Cannot find the file "${s.source}".`, `Paths are relative to this file. Check the spelling, and include the .kivo extension.`, { kind: "import", loc: s.sourceLoc });
        } else if (info && info.error) {
          this.report(s, `"${s.source}" has an error: ${info.error}`, null, { kind: "import", loc: s.sourceLoc });
        } else if (info) {
          exportsList = info.exports;
        }
      }
    } else if (builtinInfo.modules[s.source]) {
      const mod = builtinInfo.modules[s.source];
      exportsList = Object.entries(mod.members).map(([name, m]) => ({ name, ...m }));
      moduleDoc = mod.doc;
    } else if (!(this.packageExists && this.packageExists(s.source))) {
      const close = suggest(s.source, Object.keys(builtinInfo.modules));
      this.report(s, `Unknown module "${s.source}".`, close ? `Did you mean "${close}"?` : `Standard modules: ${Object.keys(builtinInfo.modules).join(", ")}\n\nTo import a local file use a path:\n\n    from "./${s.source}.kivo" import something`, { kind: "import", loc: s.sourceLoc });
    }

    if (s.specifiers) {
      for (const sp of s.specifiers) {
        let member = null;
        if (exportsList) {
          member = exportsList.find((e) => e.name === sp.imported);
          if (!member) {
            const close = suggest(sp.imported, exportsList.map((e) => e.name));
            this.report(sp, `"${s.source}" has no export named "${sp.imported}".`, close ? `Did you mean "${close}"?` : exportsList.length ? `It exports: ${exportsList.map((e) => e.name).join(", ")}` : s.isPath ? `Mark declarations in that file with export:\n\n    export func ${sp.imported}(...) { ... }` : null, { kind: "import" });
          }
        }
        this.declare(sp.local, "import", {
          node: s,
          importedFrom: s.source,
          signature: member && member.sig ? member.sig : null,
          doc: member ? member.doc : null,
          arity: member && member.min !== undefined ? { min: member.min, max: member.max } : null,
          memberKind: member ? member.kind : null,
          defined: true,
        });
      }
    } else {
      this.declare(s.alias, "module", {
        node: s,
        moduleName: s.isPath ? null : s.source,
        members: exportsList,
        doc: moduleDoc,
        defined: true,
      });
    }
  }

  assignment(s) {
    this.expr(s.value);
    const t = s.target;
    if (t.type === N.Identifier) {
      const found = this.reference(t, { assigning: true });
      if (found) {
        const { sym } = found;
        const what = { const: "a constant", func: "a function", class: "a class", type: "a type", import: "an import", module: "an imported module" }[sym.kind];
        if (what) {
          let hint = null;
          if (sym.kind === "const") hint = `If it needs to change, declare it with let instead:\n\n    let ${t.name} = ...`;
          this.report(t, `"${t.name}" is ${what} and cannot be reassigned.`, hint, { kind: "type" });
        } else if (sym.typeNode && s.operator === "=") {
          this.checkLiteralType(s.value, sym.typeNode, `"${t.name}"`);
        }
      }
    } else {
      this.expr(t);
      if (t.type === N.MemberExpression && t.object.type === N.Identifier) {
        const found = this.scope.lookup(t.object.name);
        if (found && found.sym.kind === "module") this.report(t, `Modules cannot be modified.`, null, { kind: "type" });
      }
    }
  }

  classDeclaration(s) {
    if (s.superClass) {
      const found = this.reference(s.superClass);
      if (found && !["class", "import", "let", "const", "module"].includes(found.sym.kind)) {
        this.report(s.superClass, `"${s.superClass.name}" is not a class, so ${s.name.name} cannot extend it.`, null, { kind: "type" });
      }
    }
    const sym = this.scope.lookup(s.name.name);
    const info = { name: s.name.name, fields: new Map(), methods: new Map(), node: s, parent: s.superClass ? s.superClass.name : null };
    if (sym) sym.sym.classInfo = info;
    for (const f of s.fields) {
      if (info.fields.has(f.name.name)) this.report(f.name, `Field "${f.name.name}" is declared twice in ${s.name.name}.`);
      info.fields.set(f.name.name, { node: f, typeText: f.typeAnnotation ? typeText(f.typeAnnotation) : inferType(f.value), doc: this.docComment(f) });
    }
    for (const m of s.methods) {
      if (info.methods.has(m.name.name)) this.report(m.name, `Method "${m.name.name}" is declared twice in ${s.name.name}.`);
      if (info.fields.has(m.name.name)) this.report(m.name, `"${m.name.name}" is both a field and a method of ${s.name.name}.`);
      info.methods.set(m.name.name, { node: m, signature: this.signature(m, m.name.name), doc: this.docComment(m) });
    }
    this.classStack.push(info);
    this.push("class", s);
    for (const f of s.fields) {
      if (f.typeAnnotation) this.typeAnnotation(f.typeAnnotation);
      if (f.value) {
        this.expr(f.value);
        if (f.typeAnnotation) this.checkLiteralType(f.value, f.typeAnnotation, `Field "${f.name.name}"`);
      }
    }
    for (const m of s.methods) this.functionNode(m, m.name.name, { method: true });
    this.pop();
    this.classStack.pop();
    this.markDefined(s.name.name);
  }

  functionNode(fn, name, { method = false } = {}) {
    if (fn.returnType) this.typeAnnotation(fn.returnType);
    this.fnStack.push({ name, async: fn.async, returnType: fn.returnType, method });
    this.push("function", fn);
    for (const p of fn.params) {
      if (p.typeAnnotation) this.typeAnnotation(p.typeAnnotation);
      if (p.defaultValue) {
        this.expr(p.defaultValue);
        if (p.typeAnnotation) this.checkLiteralType(p.defaultValue, p.typeAnnotation, `The default value of "${p.name.name}"`);
      }
      this.declare(p.name, "param", { typeText: p.rest ? "array" : p.typeAnnotation ? typeText(p.typeAnnotation) : null, typeNode: p.typeAnnotation, defined: true });
    }
    if (fn.expression) this.expr(fn.body);
    else this.statements(fn.body.body);
    this.pop();
    this.fnStack.pop();
  }

  typeAnnotation(t) {
    switch (t.type) {
      case N.TypeName:
        if (BUILTIN_TYPES.includes(t.name)) return;
        {
          const found = this.scope.lookup(t.name);
          if (!found) {
            const close = suggest(t.name, [...BUILTIN_TYPES, ...this.scope.allNames()]);
            const aliases = { str: "string", boolean: "bool", integer: "int", double: "float", list: "array", dict: "object", map: "object", Array: "array", Object: "object", String: "string", Number: "number", Boolean: "bool" };
            const hint = aliases[t.name] ? `KIVO calls this type "${aliases[t.name]}".` : close ? `Did you mean "${close}"?` : `Built-in types: ${BUILTIN_TYPES.join(", ")}`;
            this.report(t, `Unknown type "${t.name}".`, hint, { kind: "type" });
          } else {
            found.sym.used = true;
            this.references.push({ name: t.name, loc: t.loc, symbol: found.sym });
          }
        }
        return;
      case N.NullableType:
        return this.typeAnnotation(t.inner);
      case N.ArrayType:
        return this.typeAnnotation(t.element);
      case N.UnionType:
        return t.types.forEach((x) => this.typeAnnotation(x));
      default:
        return;
    }
  }

  // Detects literal values that can never match a type annotation.
  checkLiteralType(value, type, what) {
    const actual = literalType(value);
    if (!actual) return;
    if (!literalMatches(actual, value, type)) {
      let hint = null;
      const t = typeText(type);
      if (actual === "string" && /^(int|float|number)\??$/.test(t)) hint = `Convert the text to a number:\n\n    number(${this.text(value)})`;
      if ((actual === "int" || actual === "float") && /^string\??$/.test(t)) hint = `Convert the number to text:\n\n    string(${this.text(value)})`;
      if (actual === "float" && /^int\??$/.test(t)) hint = `${this.text(value)} is not a whole number. Use float or number as the type, or round it.`;
      this.report(value, `${what} must be ${t}, but this is ${actual === "null" ? "null" : (/^[aeiou]/.test(actual) ? "an " : "a ") + actual}.`, hint, { kind: "type" });
    }
  }

  // ------------------------------------------------------------ expressions

  reference(id, { assigning = false } = {}) {
    const found = this.scope.lookup(id.name);
    if (found) {
      const { sym, scope } = found;
      sym.used = true;
      this.references.push({ name: id.name, loc: id.loc, symbol: sym });
      // use before declaration in the same function (not inside a nested function)
      if (!sym.hoisted && !sym.builtin && !sym.defined && sym.kind !== "param" && sym.kind !== "import" && sym.kind !== "module") {
        if (scope.functionScope === this.scope.functionScope && id.loc.start < sym.declaredAt) {
          this.report(id, `"${id.name}" is used before it is declared (line ${sym.loc.line}).`, `Move the declaration of "${id.name}" above this line.`);
        } else if (scope.functionScope === this.scope.functionScope && sym.valueNode && id.loc.start >= sym.valueNode.loc.start && id.loc.end <= sym.valueNode.loc.end && !assigning) {
          if (!insideFunction(sym.valueNode, id)) this.report(id, `"${id.name}" is used in its own declaration.`, null);
        }
      }
      return found;
    }
    if (builtinInfo.globals[id.name]) {
      this.references.push({ name: id.name, loc: id.loc, symbol: { name: id.name, kind: "builtin", builtin: true, ...builtinInfo.globals[id.name] } });
      return { sym: { name: id.name, kind: "builtin", builtin: true, ...builtinInfo.globals[id.name] }, scope: null };
    }
    this.unknownName(id);
    return null;
  }

  unknownName(id) {
    const name = id.name;
    if (Object.prototype.hasOwnProperty.call(FOREIGN_NAMES, name) && FOREIGN_NAMES[name]) {
      this.report(id, `"${name}" is not defined.`, FOREIGN_NAMES[name]);
      return;
    }
    if (builtinInfo.modules[name]) {
      this.report(id, `"${name}" is not defined.`, `${name} is a standard module. Import it at the top of the file:\n\n    import ${name}`);
      return;
    }
    const candidates = [...this.scope.allNames(), ...Object.keys(builtinInfo.globals)];
    const close = suggest(name, candidates);
    if (close) {
      this.report(id, `Unknown variable "${name}".`, `Did you mean "${close}"?`);
    } else {
      this.report(id, `Unknown variable "${name}".`, `Declare it first:\n\n    let ${name} = ...`);
    }
  }

  expr(node) {
    if (!node) return;
    switch (node.type) {
      case N.Identifier:
        this.reference(node);
        return;
      case N.NumberLiteral:
      case N.StringLiteral:
      case N.BooleanLiteral:
      case N.NullLiteral:
      case N.SelfExpression:
      case N.SuperMemberExpression:
        return;
      case N.TemplateString:
        for (const p of node.parts) if (typeof p !== "string") this.expr(p);
        return;
      case N.ArrayExpression:
        node.elements.forEach((e) => this.expr(e.type === N.SpreadElement ? e.argument : e));
        return;
      case N.ObjectExpression: {
        const seen = new Set();
        for (const p of node.properties) {
          if (p.type === N.SpreadElement) {
            this.expr(p.argument);
            continue;
          }
          if (seen.has(p.key)) this.report(p, `The property "${p.key}" appears twice in this object.`, null, { loc: p.keyLoc });
          seen.add(p.key);
          this.expr(p.value);
        }
        return;
      }
      case N.BinaryExpression:
        this.expr(node.left);
        this.expr(node.right);
        this.binaryLiterals(node);
        return;
      case N.LogicalExpression:
        this.expr(node.left);
        this.expr(node.right);
        return;
      case N.UnaryExpression:
      case N.AwaitExpression:
        this.expr(node.argument);
        return;
      case N.RangeExpression:
        this.expr(node.start);
        this.expr(node.end);
        return;
      case N.FunctionExpression:
        this.functionNode(node, node.name ? node.name.name : null);
        return;
      case N.MemberExpression:
        this.expr(node.object);
        this.memberAccess(node);
        return;
      case N.IndexExpression:
        this.expr(node.object);
        this.expr(node.index);
        return;
      case N.CallExpression:
        if (node.callee.type !== N.SuperMemberExpression) this.expr(node.callee);
        node.args.forEach((a) => this.expr(a.type === N.SpreadElement ? a.argument : a));
        this.callArity(node);
        return;
      default:
        return;
    }
  }

  binaryLiterals(node) {
    const a = literalType(node.left);
    const b = literalType(node.right);
    if (!a || !b) return;
    const isNum = (t) => t === "int" || t === "float";
    if (["+", "-", "*", "/", "%"].includes(node.operator)) {
      const ok = (isNum(a) && isNum(b)) || (node.operator === "+" && a === "string" && b === "string");
      if (!ok) {
        let hint = '"+" adds numbers or joins two strings. KIVO never converts types automatically.';
        if (a === "string" && isNum(b)) hint = `Convert explicitly:\n\n    number(${this.text(node.left)}) ${node.operator} ${this.text(node.right)}\n    ${this.text(node.left)} + string(${this.text(node.right)})`;
        if (isNum(a) && b === "string") hint = `Convert explicitly:\n\n    ${this.text(node.left)} ${node.operator} number(${this.text(node.right)})`;
        this.report(node, `Cannot use "${node.operator}" with ${article(a)} and ${article(b)}.`, hint, { kind: "type" });
      }
    }
    if (node.operator === "/" && node.right.type === N.NumberLiteral && node.right.value === 0) {
      this.report(node.right, "Division by zero.", null, { kind: "type" });
    }
  }

  memberAccess(node) {
    const obj = node.object;
    if (obj.type === N.Identifier) {
      const found = this.scope.lookup(obj.name);
      if (found && found.sym.kind === "module" && found.sym.members) {
        const members = found.sym.members;
        const m = members.find((x) => x.name === node.property);
        if (!m && !node.optional) {
          const close = suggest(node.property, members.map((x) => x.name));
          const label = found.sym.moduleName || found.sym.name;
          this.report(node, `Module "${label}" has no member "${node.property}".`, close ? `Did you mean "${close}"?` : `Available: ${members.map((x) => x.name).join(", ")}`, { loc: node.propertyLoc });
        } else if (m) {
          this.references.push({ name: node.property, loc: node.propertyLoc, symbol: { name: `${found.sym.moduleName || found.sym.name}.${node.property}`, kind: m.kind === "func" ? "func" : "const", signature: m.sig, doc: m.doc, loc: m.loc || null, file: m.file || null } });
        }
      }
    }
    if (obj.type === N.SelfExpression && this.classStack.length) {
      const cls = this.classStack[this.classStack.length - 1];
      const chain = this.classChain(cls);
      if (chain.complete) {
        const all = [...chain.fields.keys(), ...chain.methods.keys()];
        if (!all.includes(node.property)) {
          const close = suggest(node.property, all);
          this.report(node, `${cls.name} has no field or method "${node.property}".`, close ? `Did you mean "${close}"?` : `Declare it in the class:\n\n    let ${node.property}`, { loc: node.propertyLoc });
        } else {
          const field = chain.fields.get(node.property);
          const method = chain.methods.get(node.property);
          this.references.push({
            name: node.property,
            loc: node.propertyLoc,
            symbol: field ? { name: node.property, kind: "field", loc: field.node.name.loc, typeText: field.typeText, doc: field.doc, className: cls.name } : { name: node.property, kind: "method", loc: method.node.name.loc, signature: method.signature, doc: method.doc, className: cls.name },
          });
        }
      }
    }
  }

  classChain(cls) {
    const fields = new Map();
    const methods = new Map();
    let complete = true;
    const seen = new Set();
    let c = cls;
    while (c && !seen.has(c)) {
      seen.add(c);
      for (const [k, v] of c.fields) if (!fields.has(k)) fields.set(k, v);
      for (const [k, v] of c.methods) if (!methods.has(k)) methods.set(k, v);
      if (!c.parent) break;
      const parent = this.scope.lookup(c.parent);
      if (!parent || !parent.sym.classInfo) {
        complete = false;
        break;
      }
      c = parent.sym.classInfo;
    }
    return { fields, methods, complete };
  }

  callArity(node) {
    if (node.args.some((a) => a.type === N.SpreadElement)) return;
    const callee = node.callee;
    let arity = null;
    let label = null;
    let params = null;
    let signature = null;
    if (callee.type === N.Identifier) {
      const found = this.scope.lookup(callee.name);
      if (found) {
        const sym = found.sym;
        if ((sym.kind === "func" || (sym.kind === "const" && sym.params)) && (sym.params || (sym.node && sym.node.params))) {
          params = sym.params || sym.node.params;
          arity = paramArity(params);
          label = callee.name;
          signature = sym.signature;
        } else if (sym.kind === "class" && sym.classInfo) {
          const init = this.classChain(sym.classInfo).methods.get("init");
          if (init) {
            params = init.node.params;
            arity = paramArity(params);
            signature = init.signature.replace("func init", sym.name);
          } else arity = { min: 0, max: 0 };
          label = sym.name;
        } else if (sym.kind === "import" && sym.arity) {
          arity = sym.arity;
          label = callee.name;
          signature = sym.signature;
        }
      } else if (builtinInfo.globals[callee.name]) {
        const g = builtinInfo.globals[callee.name];
        arity = { min: g.min, max: g.max };
        label = callee.name;
        signature = g.sig;
      }
    } else if (callee.type === N.MemberExpression && callee.object.type === N.Identifier) {
      const found = this.scope.lookup(callee.object.name);
      if (found && found.sym.kind === "module" && found.sym.members) {
        const m = found.sym.members.find((x) => x.name === callee.property);
        if (m && m.kind === "func" && m.min !== undefined) {
          arity = { min: m.min, max: m.max };
          label = `${found.sym.moduleName || found.sym.name}.${callee.property}`;
          signature = m.sig;
        }
      }
    } else if (callee.type === N.MemberExpression && callee.object.type === N.SelfExpression && this.classStack.length) {
      const cls = this.classStack[this.classStack.length - 1];
      const m = this.classChain(cls).methods.get(callee.property);
      if (m) {
        params = m.node.params;
        arity = paramArity(params);
        label = `${cls.name}.${callee.property}`;
        signature = m.signature;
      }
    }
    if (!arity) return;
    const n = node.args.length;
    if (n < arity.min || n > arity.max) {
      let expects;
      if (arity.max === Infinity) expects = `at least ${plural(arity.min, "argument")}`;
      else if (arity.min === arity.max) expects = plural(arity.min, "argument");
      else expects = `${arity.min} to ${plural(arity.max, "argument")}`;
      this.report(node, `${label} expects ${expects}, but is called with ${n}.`, signature, { kind: "type", loc: callee.type === N.MemberExpression ? spanLoc(callee.propertyLoc, node.loc) : node.loc });
      return;
    }
    if (params) {
      node.args.forEach((arg, i) => {
        const p = params[i];
        if (p && !p.rest && p.typeAnnotation) this.checkLiteralType(arg, p.typeAnnotation, `Parameter "${p.name.name}" of ${label}`);
      });
    }
  }
}

// ------------------------------------------------------------ helpers

function spanLoc(from, to) {
  return { ...from, end: to.end, endLine: to.endLine, endColumn: to.endColumn };
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function article(t) {
  return t === "null" ? "null" : (/^[aeiou]/.test(t) ? "an " : "a ") + t;
}

function paramArity(params) {
  let min = 0;
  let max = 0;
  for (const p of params) {
    if (p.rest) return { min, max: Infinity };
    max++;
    if (!p.defaultValue) min++;
  }
  return { min, max };
}

function patternIds(target) {
  if (target.type === N.Identifier) return [target];
  if (target.type === N.ObjectPattern) return target.properties.map((p) => p.value);
  if (target.type === N.ArrayPattern) return [...target.elements, ...(target.rest ? [target.rest] : [])];
  return [];
}

function insideFunction(container, id) {
  let found = false;
  const visit = (n, inFn) => {
    if (!n || typeof n !== "object" || found) return;
    if (n === id) {
      found = inFn;
      return;
    }
    const isFn = n.type === N.FunctionExpression;
    for (const k of Object.keys(n)) {
      if (k === "loc") continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach((x) => visit(x, inFn || isFn));
      else if (v && typeof v === "object" && v.type) visit(v, inFn || isFn);
    }
  };
  visit(container, false);
  return found;
}

function isObjectish(node) {
  return node && node.type === N.ObjectExpression;
}

function literalType(node) {
  if (!node) return null;
  switch (node.type) {
    case N.NumberLiteral:
      return Number.isInteger(node.value) && !/[.eE]/.test(node.raw || "") ? "int" : "float";
    case N.UnaryExpression:
      if (node.operator === "-" && node.argument.type === N.NumberLiteral) return literalType(node.argument);
      return node.operator === "not" ? "bool" : null;
    case N.StringLiteral:
    case N.TemplateString:
      return "string";
    case N.BooleanLiteral:
      return "bool";
    case N.NullLiteral:
      return "null";
    case N.ArrayExpression:
      return "array";
    case N.ObjectExpression:
      return "object";
    case N.FunctionExpression:
      return "func";
    default:
      return null;
  }
}

function literalMatches(actual, node, type) {
  switch (type.type) {
    case N.NullableType:
      return actual === "null" || literalMatches(actual, node, type.inner);
    case N.UnionType:
      return type.types.some((t) => literalMatches(actual, node, t));
    case N.ArrayType:
      if (actual !== "array") return false;
      return node.elements.every((e) => {
        const t = literalType(e);
        return !t || literalMatches(t, e, type.element);
      });
    case N.TypeName:
      switch (type.name) {
        case "any":
          return true;
        case "number":
        case "float":
          return actual === "int" || actual === "float";
        case "int":
          return actual === "int" || (actual === "float" && Number.isInteger(node.value ?? (node.argument && node.argument.value)));
        case "string":
        case "bool":
        case "array":
        case "func":
          return actual === type.name;
        case "null":
        case "void":
          return actual === "null";
        case "object":
          return actual === "object";
        default:
          // classes and user types: only object literals can match user types
          return actual === "object" || actual === "null" ? actual === "object" : false;
      }
    default:
      return true;
  }
}

function typeText(t) {
  switch (t.type) {
    case N.TypeName:
      return t.name;
    case N.NullableType:
      return typeText(t.inner) + "?";
    case N.ArrayType:
      return "[" + typeText(t.element) + "]";
    case N.UnionType:
      return t.types.map(typeText).join(" | ");
    default:
      return "any";
  }
}

function inferType(node) {
  const t = literalType(node);
  if (t) return t;
  if (!node) return null;
  if (node.type === N.RangeExpression) return "range";
  if (node.type === N.BinaryExpression && ["==", "!=", "<", ">", "<=", ">="].includes(node.operator)) return "bool";
  if (node.type === N.LogicalExpression && node.operator !== "??") return "bool";
  return null;
}

function check(program, options) {
  const checker = new Checker(options);
  return checker.check(program);
}

module.exports = { check, Checker, typeText, inferType, literalType, BUILTIN_TYPES, KEYWORDS };
