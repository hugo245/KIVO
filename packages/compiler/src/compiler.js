"use strict";

// Compiles a KIVO AST into JavaScript that runs on the KIVO runtime.
//
// The generated code never touches JavaScript semantics directly for
// operations that could behave surprisingly: arithmetic, comparisons, member
// access, calls, iteration and conditions all go through checked runtime
// helpers ($rt.*) that know the KIVO rules and produce KIVO error messages.
// Every helper receives a location index pointing back to the KIVO source.

const { NodeType: N } = require("../../parser/src");

const BUILTIN_TYPES = new Set(["any", "string", "number", "float", "int", "bool", "array", "object", "bytes", "func", "range", "error", "null", "void"]);

const ARITH = { "+": "add", "-": "sub", "*": "mul", "/": "div", "%": "mod" };
const COMPARE = { "<": "lt", ">": "gt", "<=": "le", ">=": "ge" };

function mangle(name) {
  return "k$" + name;
}

class Scope {
  constructor(parent, kind) {
    this.parent = parent;
    this.kind = kind; // "module" | "function" | "block"
    this.names = new Map(); // name -> { typed: typeNode | null, kind }
  }
  declare(name, info = {}) {
    this.names.set(name, info);
  }
  lookup(name) {
    for (let s = this; s; s = s.parent) if (s.names.has(name)) return s.names.get(name);
    return null;
  }
}

class Compiler {
  constructor({ file, source, locBase = 0, builtinNames = [] }) {
    this.file = file;
    this.source = source;
    this.locBase = locBase;
    this.locations = [];
    this.builtinNames = new Set(builtinNames);
    this.scope = new Scope(null, "module");
    this.fnStack = [{ name: null, temps: [], tempCounter: 0, async: true, isMethod: false }];
    this.classStack = [];
    this.indentLevel = 0;
  }

  // ------------------------------------------------------------ helpers

  loc(node, extra = {}, span = null) {
    const l = span || node.loc;
    let length = 1;
    if (l) {
      length = l.endLine === l.line || l.endLine === undefined ? Math.max(1, l.end - l.start) : this.lineRest(l);
    }
    this.locations.push({
      file: this.file,
      line: l ? l.line : 0,
      column: l ? l.column : 0,
      length,
      fn: this.currentFn().name,
      ...extra,
    });
    return this.locBase + this.locations.length - 1;
  }

  lineRest(l) {
    const lineEnd = this.source.indexOf("\n", l.start);
    return Math.max(1, (lineEnd < 0 ? this.source.length : lineEnd) - l.start);
  }

  text(node) {
    if (!node || !node.loc) return null;
    const t = this.source.slice(node.loc.start, node.loc.end).replace(/\s+/g, " ").trim();
    return t.length > 60 ? t.slice(0, 59) + "…" : t;
  }

  currentFn() {
    return this.fnStack[this.fnStack.length - 1];
  }

  temp() {
    const fn = this.currentFn();
    const name = `$t${fn.tempCounter++}`;
    fn.temps.push(name);
    return name;
  }

  pushScope(kind) {
    this.scope = new Scope(this.scope, kind);
  }

  popScope() {
    this.scope = this.scope.parent;
  }

  ind() {
    return "  ".repeat(this.indentLevel);
  }

  // Declarations in a block are visible to the whole block (functions are hoisted).
  predeclare(statements) {
    for (const s of statements) {
      switch (s.type) {
        case N.VariableDeclaration:
          for (const name of this.patternNames(s.target)) this.scope.declare(name, { kind: s.kind, typed: s.target.type === N.Identifier ? s.typeAnnotation : null });
          break;
        case N.FunctionDeclaration:
          this.scope.declare(s.name.name, { kind: "func" });
          break;
        case N.ClassDeclaration:
          this.scope.declare(s.name.name, { kind: "class" });
          break;
        case N.TypeDeclaration:
          this.scope.declare(s.name.name, { kind: "type" });
          break;
        case N.ImportDeclaration:
          if (s.specifiers) for (const sp of s.specifiers) this.scope.declare(sp.local.name, { kind: "import" });
          else this.scope.declare(s.alias.name, { kind: "import" });
          break;
        default:
          break;
      }
    }
  }

  patternNames(target) {
    if (target.type === N.Identifier) return [target.name];
    if (target.type === N.ObjectPattern) return target.properties.map((p) => p.value.name);
    if (target.type === N.ArrayPattern) return [...target.elements.map((e) => e.name), ...(target.rest ? [target.rest.name] : [])];
    return [];
  }

  // ------------------------------------------------------------ program

  compileProgram(program) {
    this.predeclare(program.body);
    const lines = [];
    // live export bindings
    for (const s of program.body) {
      if (!s.exported) continue;
      for (const name of this.exportNames(s)) {
        lines.push(`$rt.exportLive($exports, ${JSON.stringify(name)}, () => ${mangle(name)});`);
      }
    }
    const body = this.compileStatements(program.body);
    const temps = this.fnStack[0].temps;
    const out = [];
    out.push('"use strict";');
    if (temps.length) out.push(`let ${temps.join(", ")};`);
    out.push(...lines, body);
    return out.join("\n");
  }

  exportNames(s) {
    if (s.type === N.VariableDeclaration) return this.patternNames(s.target);
    return [s.name.name];
  }

  compileStatements(statements) {
    const imports = [];
    const hoisted = [];
    const rest = [];
    for (const s of statements) {
      if (s.type === N.ImportDeclaration) imports.push(this.statement(s));
      else if (s.type === N.FunctionDeclaration) hoisted.push(this.functionDeclaration(s));
      else rest.push(s);
    }
    const out = [...imports, ...hoisted];
    for (const s of rest) out.push(this.statement(s));
    return out.join("\n");
  }

  block(block, setup) {
    this.pushScope("block");
    if (setup) setup();
    this.predeclare(block.body);
    this.indentLevel++;
    const body = this.compileStatements(block.body);
    this.indentLevel--;
    this.popScope();
    return `{\n${body}\n${this.ind()}}`;
  }

  // ------------------------------------------------------------ statements

  statement(s) {
    const i = this.ind();
    switch (s.type) {
      case N.VariableDeclaration:
        return i + this.variableDeclaration(s);
      case N.ExpressionStatement:
        return i + this.expr(s.expression) + ";";
      case N.AssignmentStatement:
        return i + this.assignment(s) + ";";
      case N.IfStatement:
        return i + this.ifStatement(s);
      case N.ForStatement:
        return i + this.forStatement(s);
      case N.WhileStatement:
        return `${i}while (${this.condition(s.test)}) ${this.block(s.body)}`;
      case N.BreakStatement:
        return i + "break;";
      case N.ContinueStatement:
        return i + "continue;";
      case N.ReturnStatement:
        return i + this.returnStatement(s);
      case N.ThrowStatement:
        return `${i}throw $rt.toThrow(${this.expr(s.argument)}, ${this.loc(s)});`;
      case N.TryStatement:
        return i + this.tryStatement(s);
      case N.ImportDeclaration:
        return i + this.importDeclaration(s);
      case N.ClassDeclaration:
        return i + this.classDeclaration(s);
      case N.TypeDeclaration:
        return i + this.typeDeclaration(s);
      case N.FunctionDeclaration:
        return this.functionDeclaration(s);
      default:
        throw new Error(`compiler: unknown statement ${s.type}`);
    }
  }

  variableDeclaration(s) {
    const keyword = s.kind === "const" ? "const" : "let";
    if (s.target.type === N.Identifier) {
      const name = s.target.name;
      let value = s.value ? this.expr(s.value, name) : "null";
      if (s.typeAnnotation) {
        value = `$rt.checkType(${value}, ${this.typeExpr(s.typeAnnotation)}, ${JSON.stringify(`"${name}"`)}, ${this.loc(s.value || s.target)})`;
      }
      return `${keyword} ${mangle(name)} = ${value};`;
    }
    if (s.target.type === N.ObjectPattern) {
      const t = this.temp();
      const parts = s.target.properties.map((p) => `${mangle(p.value.name)} = $rt.get(${t}, ${JSON.stringify(p.key)}, ${this.loc(p.value, { a: this.text(s.value) })})`);
      return `${t} = ${this.expr(s.value)}; ${keyword} ${parts.join(", ")};`;
    }
    const names = s.target.elements.map((e) => mangle(e.name));
    if (s.target.rest) names.push("..." + mangle(s.target.rest.name));
    return `${keyword} [${names.join(", ")}] = $rt.destructArray(${this.expr(s.value)}, ${s.target.elements.length}, ${Boolean(s.target.rest)}, ${this.loc(s.target)});`;
  }

  assignment(s) {
    const t = s.target;
    const op = s.operator === "=" ? null : s.operator[0];
    if (t.type === N.Identifier) {
      const name = this.resolve(t);
      let value = op ? `$rt.${ARITH[op]}(${name}, ${this.expr(s.value)}, ${this.loc(s, { a: t.name, b: this.text(s.value) })})` : this.expr(s.value, t.name);
      const info = this.scope.lookup(t.name);
      if (info && info.typed) value = `$rt.checkType(${value}, ${this.typeExpr(info.typed)}, ${JSON.stringify(`"${t.name}"`)}, ${this.loc(s.value)})`;
      return `${name} = ${value}`;
    }
    if (t.type === N.MemberExpression) {
      const obj = this.expr(t.object);
      const l = this.loc(t, { a: this.text(t.object), b: t.property }, t.propertyLoc);
      if (op) return `$rt.updateMember(${obj}, ${JSON.stringify(t.property)}, ${JSON.stringify(op)}, ${this.expr(s.value)}, ${l})`;
      return `$rt.set(${obj}, ${JSON.stringify(t.property)}, ${this.expr(s.value, t.property)}, ${l})`;
    }
    // index
    const l = this.loc(t, { a: this.text(t.object), b: this.text(t.index) });
    if (op) return `$rt.updateIndex(${this.expr(t.object)}, ${this.expr(t.index)}, ${JSON.stringify(op)}, ${this.expr(s.value)}, ${l})`;
    return `$rt.setIndex(${this.expr(t.object)}, ${this.expr(t.index)}, ${this.expr(s.value)}, ${l})`;
  }

  ifStatement(s) {
    let out = `if (${this.condition(s.test)}) ${this.block(s.consequent)}`;
    if (s.alternate) {
      if (s.alternate.type === N.IfStatement) out += ` else ${this.ifStatement(s.alternate)}`;
      else out += ` else ${this.block(s.alternate)}`;
    }
    return out;
  }

  forStatement(s) {
    const it = s.iterable;
    const declareLoopVars = () => {
      this.scope.declare(s.value.name, { kind: "let" });
      if (s.key) this.scope.declare(s.key.name, { kind: "let" });
    };
    // for i in a..b  -> counting loop, no allocation
    if (it.type === N.RangeExpression && !it.parenthesized && !s.key) {
      const a = this.temp();
      const b = this.temp();
      const start = `$rt.rangeBound(${this.expr(it.start)}, ${this.loc(it.start, { a: this.text(it.start) })})`;
      const end = `$rt.rangeBound(${this.expr(it.end)}, ${this.loc(it.end, { a: this.text(it.end) })})`;
      const cmp = it.inclusive ? "<=" : "<";
      const body = this.block(s.body, declareLoopVars);
      return `for (${a} = ${start}, ${b} = ${end}; ${a} ${cmp} ${b}; ${a}++) { let ${mangle(s.value.name)} = ${a}; ${body} }`;
    }
    const l = this.loc(it, { a: this.text(it) });
    if (s.key) {
      const body = this.block(s.body, declareLoopVars);
      return `for (let [${mangle(s.key.name)}, ${mangle(s.value.name)}] of $rt.pairs(${this.expr(it)}, ${l})) ${body}`;
    }
    const body = this.block(s.body, declareLoopVars);
    return `for (let ${mangle(s.value.name)} of $rt.iter(${this.expr(it)}, ${l})) ${body}`;
  }

  returnStatement(s) {
    const fn = this.currentFn();
    let value = s.argument ? this.expr(s.argument) : "null";
    if (fn.returnType && !(fn.returnType.type === N.TypeName && fn.returnType.name === "any")) {
      value = `$rt.checkType(${value}, ${this.typeExpr(fn.returnType)}, ${JSON.stringify(`The return value of ${fn.name || "this function"}`)}, ${this.loc(s.argument || s)})`;
    }
    return `return ${value};`;
  }

  tryStatement(s) {
    let out = `try ${this.block(s.block)}`;
    if (s.handler) {
      const e = `$e${this.currentFn().tempCounter++}`;
      const body = this.block(s.handler, () => {
        if (s.param) this.scope.declare(s.param.name, { kind: "let" });
      });
      const bind = s.param ? `let ${mangle(s.param.name)} = $rt.caught(${e}); ` : "";
      out += ` catch (${e}) { ${bind}${body} }`;
    }
    if (s.finalizer) out += ` finally ${this.block(s.finalizer)}`;
    return out;
  }

  importDeclaration(s) {
    const l = this.loc(s, {}, s.sourceLoc);
    const load = s.isPath ? `(await $rt.importFile(${JSON.stringify(s.source)}, $file, ${l}))` : `(await $rt.importModule(${JSON.stringify(s.source)}, ${l}))`;
    if (!s.specifiers) return `const ${mangle(s.alias.name)} = ${load};`;
    const m = this.temp();
    const parts = s.specifiers.map((sp) => `${mangle(sp.local.name)} = $rt.importMember(${m}, ${JSON.stringify(sp.imported)}, ${this.loc(sp)})`);
    return `${m} = ${load}; const ${parts.join(", ")};`;
  }

  // ------------------------------------------------------------ functions

  params(params, fnName) {
    const names = [];
    const prologue = [];
    for (const p of params) {
      const n = mangle(p.name.name);
      names.push(p.rest ? "..." + n : n);
      this.scope.declare(p.name.name, { kind: "param", typed: p.rest ? null : p.typeAnnotation });
      if (p.defaultValue) prologue.push(`if (${n} === undefined) ${n} = ${this.expr(p.defaultValue)};`);
      if (p.typeAnnotation) {
        const type = p.rest ? `$rt.T.arrayOf(${this.typeExpr(p.typeAnnotation)})` : this.typeExpr(p.typeAnnotation);
        prologue.push(`$rt.checkType(${n}, ${type}, ${JSON.stringify(`Parameter "${p.name.name}" of ${fnName || "this function"}`)}, ${this.loc(p)});`);
      }
    }
    return { names, prologue };
  }

  arity(params) {
    let min = 0;
    let max = 0;
    for (const p of params) {
      if (p.rest) {
        max = Infinity;
        break;
      }
      max++;
      if (!p.defaultValue) min++;
    }
    return { min, max: max === Infinity ? "Infinity" : String(max) };
  }

  functionBody(node, name, { isMethod = false } = {}) {
    this.fnStack.push({ name, temps: [], tempCounter: 0, async: node.async, returnType: node.returnType, isMethod });
    this.pushScope("function");
    const { names, prologue } = this.params(node.params, name);
    this.indentLevel++;
    let body;
    if (node.expression) {
      let value = this.expr(node.body);
      if (node.returnType) value = `$rt.checkType(${value}, ${this.typeExpr(node.returnType)}, ${JSON.stringify(`The return value of ${name || "this function"}`)}, ${this.loc(node.body)})`;
      body = `${this.ind()}return ${value};`;
    } else {
      this.predeclare(node.body.body);
      body = this.compileStatements(node.body.body);
      const last = node.body.body[node.body.body.length - 1];
      if (!last || last.type !== N.ReturnStatement) {
        if (node.returnType && !(node.returnType.type === N.TypeName && (node.returnType.name === "void" || node.returnType.name === "any" || node.returnType.name === "null"))) {
          body += `\n${this.ind()}return $rt.checkType(null, ${this.typeExpr(node.returnType)}, ${JSON.stringify(`The return value of ${name || "this function"}`)}, ${this.loc(node.body, {}, { ...node.body.loc, line: node.body.loc.endLine, column: Math.max(1, (node.body.loc.endColumn || 2) - 1), start: node.body.loc.end - 1, end: node.body.loc.end })});`;
        } else {
          body += `\n${this.ind()}return null;`;
        }
      }
    }
    const fn = this.currentFn();
    const head = [];
    if (isMethod) head.push(`${this.ind()}const $self = this;`);
    if (fn.temps.length) head.push(`${this.ind()}let ${fn.temps.join(", ")};`);
    head.push(...prologue.map((p) => this.ind() + p));
    this.indentLevel--;
    this.popScope();
    this.fnStack.pop();
    const { min, max } = this.arity(node.params);
    const paramNames = JSON.stringify(node.params.map((p) => (p.rest ? "..." : "") + p.name.name + (p.defaultValue ? "?" : "")));
    return {
      head: `${node.async ? "async " : ""}function ${name ? mangle(name.replace(/\W/g, "_")) : ""}(${names.join(", ")}) {\n${[...head, body].join("\n")}\n${this.ind()}}`,
      meta: `${JSON.stringify(name || "")}, ${paramNames}, ${min}, ${max}, ${node.async}`,
    };
  }

  functionDeclaration(s) {
    const name = s.name.name;
    const fn = this.functionBody(s, name);
    const extra = this.signatureExtra(s, name);
    return `${this.ind()}${fn.head}\n${this.ind()}$rt.fn(${mangle(name)}, ${fn.meta}${extra});`;
  }

  signatureExtra(node, name) {
    if (!node.params.some((p) => p.typeAnnotation) && !node.returnType) return "";
    const sig = `func ${name}(${node.params.map((p) => (p.rest ? "..." : "") + p.name.name + (p.typeAnnotation ? ": " + this.typeText(p.typeAnnotation) : "")).join(", ")})${node.returnType ? " -> " + this.typeText(node.returnType) : ""}`;
    return `, { sig: ${JSON.stringify(sig)} }`;
  }

  typeText(t) {
    switch (t.type) {
      case N.TypeName:
        return t.name;
      case N.NullableType:
        return this.typeText(t.inner) + "?";
      case N.ArrayType:
        return "[" + this.typeText(t.element) + "]";
      case N.UnionType:
        return t.types.map((x) => this.typeText(x)).join(" | ");
      default:
        return "any";
    }
  }

  functionExpression(node, nameHint) {
    const name = node.name ? node.name.name : nameHint || null;
    if (node.name) {
      // a named function expression can refer to itself
      this.pushScope("block");
      this.scope.declare(node.name.name, { kind: "func" });
      const fn = this.functionBody(node, name);
      this.popScope();
      return `$rt.fn(${fn.head}, ${fn.meta}${this.signatureExtra(node, name)})`;
    }
    const fn = this.functionBody(node, name);
    return `$rt.fn(${fn.head}, ${fn.meta})`;
  }

  // ------------------------------------------------------------ classes & types

  classDeclaration(s) {
    const name = s.name.name;
    let parent = "null";
    if (s.superClass) parent = this.resolve(s.superClass);
    this.classStack.push({ name, parent: s.superClass ? parent : null });
    const fields = s.fields.map((f) => `{ name: ${JSON.stringify(f.name.name)}, constant: ${f.constant}, type: ${f.typeAnnotation ? this.typeExpr(f.typeAnnotation) : "null"} }`);
    // field initialisers run with $self bound to the new instance
    this.fnStack.push({ name: `${name} fields`, temps: [], tempCounter: 0, async: false, isMethod: true });
    this.pushScope("function");
    const inits = s.fields.map((f) => {
      let v = f.value ? this.expr(f.value) : "null";
      if (f.typeAnnotation && f.value) v = `$rt.checkType(${v}, ${this.typeExpr(f.typeAnnotation)}, ${JSON.stringify(`Field "${f.name.name}" of ${name}`)}, ${this.loc(f.value)})`;
      return `$self[${JSON.stringify(f.name.name)}] = ${v};`;
    });
    const initTemps = this.currentFn().temps;
    this.popScope();
    this.fnStack.pop();
    const methods = s.methods.map((m) => {
      const fn = this.functionBody(m, m.name.name, { isMethod: true });
      return `${JSON.stringify(m.name.name)}: $rt.fn(${fn.head}, ${fn.meta}${this.signatureExtra(m, `${name}.${m.name.name}`)})`;
    });
    this.classStack.pop();
    const initFn = `function ($self) { ${initTemps.length ? `let ${initTemps.join(", ")}; ` : ""}${inits.join(" ")} }`;
    return `const ${mangle(name)} = $rt.defineClass({ name: ${JSON.stringify(name)}, parent: ${parent}, parentName: ${JSON.stringify(s.superClass ? s.superClass.name : null)}, file: $file, loc: ${this.loc(s.superClass || s.name)}, fields: [${fields.join(", ")}], initFields: ${initFn}, methods: {\n${methods.map((m) => this.ind() + "  " + m).join(",\n")}\n${this.ind()}} });`;
  }

  typeDeclaration(s) {
    const fields = s.fields.map((f) => `{ name: ${JSON.stringify(f.name)}, optional: ${f.optional}, type: ${this.typeExpr(f.typeAnnotation)} }`);
    return `const ${mangle(s.name.name)} = $rt.defineType(${JSON.stringify(s.name.name)}, [${fields.join(", ")}]);`;
  }

  typeExpr(t) {
    switch (t.type) {
      case N.TypeName:
        if (BUILTIN_TYPES.has(t.name)) return `$rt.T[${JSON.stringify(t.name)}]`;
        return `$rt.typeRef(${this.resolve({ type: N.Identifier, name: t.name, loc: t.loc })}, ${JSON.stringify(t.name)}, ${this.loc(t)})`;
      case N.NullableType:
        return `$rt.T.nullable(${this.typeExpr(t.inner)})`;
      case N.ArrayType:
        return `$rt.T.arrayOf(${this.typeExpr(t.element)})`;
      case N.UnionType:
        return `$rt.T.union([${t.types.map((x) => this.typeExpr(x)).join(", ")}])`;
      default:
        return "$rt.T.any";
    }
  }

  // ------------------------------------------------------------ expressions

  resolve(id) {
    if (this.scope.lookup(id.name)) return mangle(id.name);
    if (this.builtinNames.has(id.name)) return `$B.${id.name}`;
    return `$rt.undefinedVariable(${JSON.stringify(id.name)}, ${this.loc(id)})`;
  }

  isBoolean(node) {
    switch (node.type) {
      case N.BooleanLiteral:
        return true;
      case N.BinaryExpression:
        return node.operator === "==" || node.operator === "!=" || COMPARE[node.operator] !== undefined;
      case N.LogicalExpression:
        return node.operator === "and" || node.operator === "or";
      case N.UnaryExpression:
        return node.operator === "not";
      default:
        return false;
    }
  }

  condition(node) {
    if (this.isBoolean(node)) return this.expr(node);
    return `$rt.cond(${this.expr(node)}, ${this.loc(node, { a: this.text(node) })})`;
  }

  expr(node, nameHint) {
    switch (node.type) {
      case N.NumberLiteral:
        return String(node.value);
      case N.StringLiteral:
        return JSON.stringify(node.value);
      case N.BooleanLiteral:
        return String(node.value);
      case N.NullLiteral:
        return "null";
      case N.TemplateString:
        return (
          "(" +
          node.parts
            .map((p) => (typeof p === "string" ? JSON.stringify(p) : p.type === N.StringLiteral ? JSON.stringify(p.value) : `$rt.str(${this.expr(p)})`))
            .join(" + ") +
          (typeof node.parts[0] === "string" ? "" : ' + ""') +
          ")"
        );
      case N.Identifier:
        return this.resolve(node);
      case N.SelfExpression:
        return "$self";
      case N.ArrayExpression:
        return `[${node.elements.map((e) => (e.type === N.SpreadElement ? `...$rt.spreadArray(${this.expr(e.argument)}, ${this.loc(e)})` : this.expr(e))).join(", ")}]`;
      case N.ObjectExpression:
        return this.objectExpression(node);
      case N.BinaryExpression:
        return this.binary(node);
      case N.LogicalExpression:
        return this.logical(node);
      case N.UnaryExpression:
        if (node.operator === "not") return `(!${this.condition(node.argument)})`;
        if (node.argument.type === N.NumberLiteral) return `(-${node.argument.value})`;
        return `$rt.neg(${this.expr(node.argument)}, ${this.loc(node, { a: this.text(node.argument) })})`;
      case N.RangeExpression:
        return `$rt.range(${this.expr(node.start)}, ${this.expr(node.end)}, ${node.inclusive}, ${this.loc(node)})`;
      case N.FunctionExpression:
        return this.functionExpression(node, nameHint);
      case N.AwaitExpression:
        return `(await ${this.expr(node.argument)})`;
      case N.MemberExpression:
      case N.IndexExpression:
      case N.CallExpression:
        return this.chain(node);
      case N.SuperMemberExpression:
        return `(() => { throw $rt.fail("super can only be used to call a method of the parent class, like super.init(...).", ${this.loc(node)}); })()`;
      default:
        throw new Error(`compiler: unknown expression ${node.type}`);
    }
  }

  objectExpression(node) {
    const parts = node.properties.map((p) => {
      if (p.type === N.SpreadElement) return `...$rt.spreadObject(${this.expr(p.argument)}, ${this.loc(p)})`;
      const key = p.key === "__proto__" ? `["__proto__"]` : JSON.stringify(p.key);
      return `${key}: ${this.expr(p.value, p.key)}`;
    });
    return `({ ${parts.join(", ")} })`;
  }

  binary(node) {
    const l = () => this.loc(node, { a: this.text(node.left), b: this.text(node.right) });
    const op = node.operator;
    if (op === "==") return `$rt.eq(${this.expr(node.left)}, ${this.expr(node.right)})`;
    if (op === "!=") return `$rt.neq(${this.expr(node.left)}, ${this.expr(node.right)})`;
    if (COMPARE[op]) return `$rt.${COMPARE[op]}(${this.expr(node.left)}, ${this.expr(node.right)}, ${l()})`;
    return `$rt.${ARITH[op]}(${this.expr(node.left)}, ${this.expr(node.right)}, ${l()})`;
  }

  logical(node) {
    if (node.operator === "??") return `(${this.expr(node.left)} ?? ${this.expr(node.right)})`;
    const js = node.operator === "and" ? "&&" : "||";
    return `(${this.condition(node.left)} ${js} ${this.condition(node.right)})`;
  }

  // Member access, indexing and calls, with ?. short-circuiting the whole chain.
  chain(node) {
    const links = [];
    let base = node;
    let first = true;
    while (true) {
      const open = first || !base.parenthesized;
      first = false;
      if (base.type === N.CallExpression && open) {
        const callee = base.callee;
        if (callee.type === N.MemberExpression && !callee.parenthesized) {
          links.unshift({ kind: "method", node: base, member: callee, optional: callee.optional, callOptional: base.optional });
          base = callee.object;
          continue;
        }
        if (callee.type === N.SuperMemberExpression) {
          links.unshift({ kind: "super", node: base, member: callee });
          base = null;
          break;
        }
        links.unshift({ kind: "call", node: base, optional: base.optional });
        base = callee;
        continue;
      }
      if (base.type === N.MemberExpression && open) {
        links.unshift({ kind: "member", node: base, optional: base.optional });
        base = base.object;
        continue;
      }
      if (base.type === N.IndexExpression && open) {
        links.unshift({ kind: "index", node: base, optional: base.optional });
        base = base.object;
        continue;
      }
      break;
    }
    let cur = base ? this.expr(base) : null;
    let prefix = "";
    let closers = "";
    let curNode = base;
    for (const link of links) {
      const objText = curNode ? this.text(curNode) : null;
      if (link.optional && link.kind !== "call") {
        const t = this.temp();
        prefix += `((${t} = ${cur}) == null ? null : `;
        closers += ")";
        cur = t;
      }
      switch (link.kind) {
        case "member": {
          const fn = link.optional ? "getOpt" : "get";
          cur = `$rt.${fn}(${cur}, ${JSON.stringify(link.node.property)}, ${this.loc(link.node, { a: objText }, link.node.propertyLoc)})`;
          break;
        }
        case "index": {
          const fn = link.optional ? "indexOpt" : "index";
          cur = `$rt.${fn}(${cur}, ${this.expr(link.node.index)}, ${this.loc(link.node, { a: objText, b: this.text(link.node.index) })})`;
          break;
        }
        case "call": {
          const args = this.args(link.node.args);
          const l = this.loc(link.node, { a: this.text(link.node.callee) }, link.node.callee.loc);
          if (link.optional) {
            const t = this.temp();
            cur = `((${t} = ${cur}) == null ? null : $rt.call(${t}, ${args}, ${l}))`;
          } else {
            cur = `$rt.call(${cur}, ${args}, ${l})`;
          }
          break;
        }
        case "method": {
          const args = this.args(link.node.args);
          const l = this.loc(link.node, { a: objText }, link.member.propertyLoc);
          if (link.callOptional) {
            const t = this.temp();
            cur = `((${t} = $rt.getOpt(${cur}, ${JSON.stringify(link.member.property)}, ${l})) == null ? null : $rt.call(${t}, ${args}, ${l}))`;
          } else {
            cur = `$rt.callMethod(${cur}, ${JSON.stringify(link.member.property)}, ${args}, ${l})`;
          }
          break;
        }
        case "super": {
          const cls = this.classStack[this.classStack.length - 1];
          const parent = cls && cls.parent ? cls.parent : "null";
          cur = `$rt.callSuper(${parent}, $self, ${JSON.stringify(link.member.property)}, ${this.args(link.node.args)}, ${this.loc(link.node, { a: "super" }, link.member.propertyLoc)})`;
          break;
        }
        default:
          break;
      }
      curNode = link.node;
    }
    return prefix + cur + closers;
  }

  args(args) {
    return `[${args.map((a) => (a.type === N.SpreadElement ? `...$rt.spreadArray(${this.expr(a.argument)}, ${this.loc(a)})` : this.expr(a))).join(", ")}]`;
  }
}

// Returns { code, locations }. `code` is the body of:
//   async function ($rt, $B, $exports, $file) { ... }
function compile(program, options) {
  const c = new Compiler(options);
  const code = c.compileProgram(program);
  return { code, locations: c.locations };
}

module.exports = { compile, Compiler, mangle };
