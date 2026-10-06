"use strict";

const { tokenize, TokenType: T } = require("../../lexer/src");
const { Diagnostic, KivoCompileError } = require("../../diagnostics/src");
const { NodeType: N } = require("./ast");

const ASSIGN_OPS = {
  [T.EQUAL]: "=",
  [T.PLUS_EQUAL]: "+=",
  [T.MINUS_EQUAL]: "-=",
  [T.STAR_EQUAL]: "*=",
  [T.SLASH_EQUAL]: "/=",
  [T.PERCENT_EQUAL]: "%=",
};

const COMPARISON_OPS = {
  [T.EQUAL_EQUAL]: "==",
  [T.NOT_EQUAL]: "!=",
  [T.LESS_THAN]: "<",
  [T.GREATER_THAN]: ">",
  [T.LESS_EQUAL]: "<=",
  [T.GREATER_EQUAL]: ">=",
};

const TOKEN_NAMES = {
  [T.NEWLINE]: "end of line",
  [T.EOF]: "end of file",
  [T.LEFT_BRACE]: '"{"',
  [T.RIGHT_BRACE]: '"}"',
  [T.LEFT_PAREN]: '"("',
  [T.RIGHT_PAREN]: '")"',
  [T.LEFT_BRACKET]: '"["',
  [T.RIGHT_BRACKET]: '"]"',
  [T.IDENTIFIER]: "a name",
  [T.STRING]: "a string",
  [T.NUMBER]: "a number",
};

function describe(tok) {
  if (tok.type === T.NEWLINE || tok.type === T.EOF) return TOKEN_NAMES[tok.type];
  if (tok.type === T.STRING) return "a string";
  if (tok.type === T.NUMBER) return `the number ${tok.raw ?? tok.value}`;
  if (tok.type === T.IDENTIFIER) return `"${tok.value}"`;
  return `"${tok.value === null ? "null" : tok.value}"`;
}

// A keyword may be used as a property / object key name: user.type, {class: "a"}
function isNameLike(tok) {
  return tok.type === T.IDENTIFIER || (typeof tok.value === "string" && /^[A-Za-z_]\w*$/.test(tok.value) && tok.type !== T.STRING) || tok.type === T.TRUE || tok.type === T.FALSE || tok.type === T.NULL;
}

class Parser {
  constructor(tokens, { file = null, source = "", recover = false } = {}) {
    this.tokens = tokens;
    this.file = file;
    this.source = source;
    this.pos = 0;
    this.recover = recover;
    this.errors = [];
    this.functionDepth = 0;
    this.loopDepth = 0;
  }

  // ---------------------------------------------------------------- helpers

  get current() {
    return this.tokens[this.pos];
  }

  peek(offset = 1) {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  previous() {
    return this.tokens[this.pos - 1];
  }

  check(type) {
    return this.current.type === type;
  }

  match(...types) {
    if (types.includes(this.current.type)) {
      return this.advance();
    }
    return null;
  }

  advance() {
    const tok = this.current;
    if (tok.type !== T.EOF) this.pos++;
    return tok;
  }

  error(message, tok = this.current, hint = null) {
    const length = Math.max(1, (tok.end ?? tok.start + 1) - tok.start);
    return new KivoCompileError(new Diagnostic({ kind: "syntax", message, file: this.file, line: tok.line, column: tok.column, length, hint }));
  }

  expect(type, what, hint) {
    if (this.check(type)) return this.advance();
    throw this.error(`Expected ${what ?? TOKEN_NAMES[type] ?? type}, but found ${describe(this.current)}.`, this.current, hint);
  }

  skipNewlines() {
    while (this.check(T.NEWLINE) || this.check(T.SEMICOLON)) this.advance();
  }

  startLoc(tok = this.current) {
    return { start: tok.start, line: tok.line, column: tok.column };
  }

  finish(node, start) {
    const last = this.previous() || this.current;
    const endPos = last.end;
    node.loc = {
      start: start.start,
      end: endPos,
      line: start.line,
      column: start.column,
      endLine: last.endLine ?? this.lineOf(endPos),
      endColumn: last.endColumn ?? last.column + (last.end - last.start),
    };
    return node;
  }

  lineOf(offset) {
    if (!this.lineStarts) {
      this.lineStarts = [0];
      for (let i = 0; i < this.source.length; i++) if (this.source[i] === "\n") this.lineStarts.push(i + 1);
    }
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= Math.max(0, offset - 1)) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  node(type, props, start) {
    return this.finish({ type, ...props }, start);
  }

  // A statement must end at a newline, ";", "}" or the end of the file.
  endStatement() {
    if (this.match(T.NEWLINE, T.SEMICOLON)) return;
    if (this.check(T.RIGHT_BRACE) || this.check(T.EOF)) return;
    const tok = this.current;
    let hint = "Put each statement on its own line.";
    if (tok.type === T.LEFT_BRACE) hint = 'Blocks start with "{" on the same line as their statement, e.g. "if x > 1 {".';
    if (tok.type === T.IDENTIFIER && this.previous().type === T.IDENTIFIER) {
      hint = `Did you forget an operator or a "," between "${this.previous().value}" and "${tok.value}"?`;
    }
    throw this.error(`Unexpected ${describe(tok)}.`, tok, hint);
  }

  // ---------------------------------------------------------------- program

  parseProgram() {
    const start = this.startLoc(this.tokens[0]);
    const body = [];
    this.skipNewlines();
    while (!this.check(T.EOF)) {
      const stmt = this.statementWithRecovery(true);
      if (stmt) body.push(stmt);
      this.skipNewlines();
    }
    return { type: N.Program, body, loc: { start: start.start, end: this.source.length, line: 1, column: 1, endLine: this.current.line, endColumn: this.current.column } };
  }

  statementWithRecovery(topLevel) {
    if (!this.recover) return this.statement(topLevel);
    try {
      return this.statement(topLevel);
    } catch (err) {
      if (!(err instanceof KivoCompileError)) throw err;
      this.errors.push(...err.diagnostics);
      this.synchronize();
      return null;
    }
  }

  // Skip to the start of the next statement after a syntax error.
  synchronize() {
    let depth = 0;
    while (!this.check(T.EOF)) {
      const tok = this.advance();
      if (tok.type === T.LEFT_BRACE) depth++;
      else if (tok.type === T.RIGHT_BRACE) {
        if (depth === 0) {
          this.pos--;
          return;
        }
        depth--;
        if (depth === 0 && this.check(T.NEWLINE)) return;
      } else if (tok.type === T.NEWLINE && depth === 0) return;
    }
  }

  block() {
    const start = this.startLoc();
    if (!this.check(T.LEFT_BRACE)) {
      const hint = this.check(T.COLON)
        ? 'KIVO uses braces for blocks, not ":".\n\n    if ready {\n        start()\n    }'
        : "Blocks are wrapped in braces:\n\n    {\n        ...\n    }";
      throw this.error(`Expected "{" to start a block, but found ${describe(this.current)}.`, this.current, hint);
    }
    this.advance();
    const body = [];
    this.skipNewlines();
    while (!this.check(T.RIGHT_BRACE) && !this.check(T.EOF)) {
      const stmt = this.statementWithRecovery(false);
      if (stmt) body.push(stmt);
      this.skipNewlines();
    }
    this.expect(T.RIGHT_BRACE, '"}"');
    return this.node(N.Block, { body }, start);
  }

  // ---------------------------------------------------------------- statements

  statement(topLevel = false) {
    const tok = this.current;
    switch (tok.type) {
      case T.LET:
      case T.CONST:
        return this.variableDeclaration(false);
      case T.FUNC:
        if (this.peek().type === T.IDENTIFIER) return this.functionDeclaration(false, false);
        break;
      case T.ASYNC:
        if (this.peek().type === T.FUNC && this.peek(2).type === T.IDENTIFIER) return this.functionDeclaration(false, true);
        break;
      case T.CLASS:
        return this.classDeclaration(false);
      case T.IF:
        return this.ifStatement();
      case T.FOR:
        return this.forStatement();
      case T.WHILE:
        return this.whileStatement();
      case T.RETURN:
        return this.returnStatement();
      case T.BREAK:
      case T.CONTINUE:
        return this.jumpStatement();
      case T.TRY:
        return this.tryStatement();
      case T.THROW:
        return this.throwStatement();
      case T.IMPORT:
      case T.FROM:
        if (!topLevel) throw this.error("Imports must be at the top level of a file.", tok, "Move this import to the top of the file.");
        return this.importDeclaration();
      case T.EXPORT:
        if (!topLevel) throw this.error("Only top-level declarations can be exported.", tok);
        return this.exportDeclaration();
      case T.ELSE:
        throw this.error('"else" without a matching "if".', tok, 'Make sure "else" follows the closing "}" of an if block:\n\n    if ready {\n        ...\n    } else {\n        ...\n    }');
      case T.CATCH:
        throw this.error('"catch" without a matching "try".', tok);
      case T.IDENTIFIER:
        if (tok.value === "type" && this.peek().type === T.IDENTIFIER && this.peek(2).type === T.LEFT_BRACE) {
          return this.typeDeclaration(false);
        }
        if (tok.value === "var") {
          throw this.error('KIVO uses "let" to declare variables.', tok, `    let ${this.peek().type === T.IDENTIFIER ? this.peek().value : "name"} = ...`);
        }
        if (tok.value === "function" || tok.value === "def" || tok.value === "fn") {
          throw this.error(`KIVO declares functions with "func".`, tok, "    func greet(name) {\n        print(\"Hello {name}\")\n    }");
        }
        if (tok.value === "elif") {
          throw this.error('KIVO writes "else if", not "elif".', tok);
        }
        break;
      default:
        break;
    }
    return this.expressionStatement();
  }

  exportDeclaration() {
    const exportTok = this.advance();
    let decl;
    if (this.check(T.LET) || this.check(T.CONST)) decl = this.variableDeclaration(true);
    else if (this.check(T.FUNC)) decl = this.functionDeclaration(true, false);
    else if (this.check(T.ASYNC)) decl = this.functionDeclaration(true, true);
    else if (this.check(T.CLASS)) decl = this.classDeclaration(true);
    else if (this.current.type === T.IDENTIFIER && this.current.value === "type") decl = this.typeDeclaration(true);
    else throw this.error("Expected a declaration after \"export\".", this.current, "You can export let, const, func, class and type declarations:\n\n    export func calculatePrice(value) {\n        return value * 1.21\n    }");
    decl.loc.start = exportTok.start;
    decl.loc.line = exportTok.line;
    decl.loc.column = exportTok.column;
    return decl;
  }

  variableDeclaration(exported) {
    const start = this.startLoc();
    const kind = this.advance().value; // let | const
    const target = this.bindingTarget();
    let typeAnnotation = null;
    if (this.match(T.COLON)) typeAnnotation = this.typeAnnotation();
    let value = null;
    if (this.match(T.EQUAL)) {
      value = this.expression();
    } else if (kind === "const") {
      throw this.error(`A const needs a value.`, this.current, `    const ${target.name ?? "name"} = ...`);
    } else if (target.type !== N.Identifier) {
      throw this.error("Destructuring needs a value to unpack.", this.current);
    } else if (ASSIGN_OPS[this.current.type]) {
      throw this.error(`Expected "=" after the variable name.`, this.current);
    }
    this.endStatement();
    return this.node(N.VariableDeclaration, { kind, target, typeAnnotation, value, exported }, start);
  }

  bindingTarget() {
    const start = this.startLoc();
    if (this.match(T.LEFT_BRACE)) {
      const properties = [];
      this.skipNewlines();
      while (!this.check(T.RIGHT_BRACE)) {
        const keyTok = this.expectName("a property name");
        let value = this.identifierFrom(keyTok);
        if (this.match(T.COLON)) value = this.identifier();
        properties.push({ key: keyTok.value, value });
        this.skipNewlines();
        if (!this.match(T.COMMA)) break;
        this.skipNewlines();
      }
      this.skipNewlines();
      this.expect(T.RIGHT_BRACE, '"}"');
      return this.node(N.ObjectPattern, { properties }, start);
    }
    if (this.match(T.LEFT_BRACKET)) {
      const elements = [];
      let rest = null;
      while (!this.check(T.RIGHT_BRACKET)) {
        if (this.match(T.SPREAD)) {
          rest = this.identifier();
          break;
        }
        elements.push(this.identifier());
        if (!this.match(T.COMMA)) break;
      }
      this.expect(T.RIGHT_BRACKET, '"]"');
      return this.node(N.ArrayPattern, { elements, rest }, start);
    }
    return this.identifier("a variable name");
  }

  identifier(what = "a name") {
    const tok = this.current;
    if (tok.type !== T.IDENTIFIER) {
      if (typeof tok.value === "string" && /^[a-z]+$/.test(tok.value) && tok.type !== T.STRING) {
        throw this.error(`"${tok.value}" is a keyword and cannot be used as a name.`, tok, `Pick another name, for example "${tok.value}Value".`);
      }
      throw this.error(`Expected ${what}, but found ${describe(tok)}.`, tok);
    }
    this.advance();
    return this.identifierFrom(tok);
  }

  identifierFrom(tok) {
    return {
      type: N.Identifier,
      name: tok.value,
      loc: { start: tok.start, end: tok.end, line: tok.line, column: tok.column, endLine: tok.line, endColumn: tok.column + (tok.end - tok.start) },
    };
  }

  expectName(what) {
    const tok = this.current;
    if (isNameLike(tok)) {
      this.advance();
      return { ...tok, value: String(tok.value) };
    }
    if (tok.type === T.STRING && tok.value !== null) {
      this.advance();
      return tok;
    }
    throw this.error(`Expected ${what}, but found ${describe(tok)}.`, tok);
  }

  functionDeclaration(exported, isAsync) {
    const start = this.startLoc();
    if (isAsync) this.advance();
    this.expect(T.FUNC);
    const name = this.identifier("a function name");
    const fn = this.functionRest(isAsync);
    return this.node(N.FunctionDeclaration, { name, params: fn.params, returnType: fn.returnType, body: fn.body, async: isAsync, exported }, start);
  }

  functionRest(isAsync) {
    if (!this.check(T.LEFT_PAREN)) {
      throw this.error(`Expected "(" to start the parameter list, but found ${describe(this.current)}.`, this.current, "    func name(param1, param2) { ... }");
    }
    const params = this.parameterList();
    let returnType = null;
    if (this.match(T.ARROW)) returnType = this.typeAnnotation();
    else if (this.check(T.COLON)) {
      throw this.error('Return types are written with "->".', this.current, "    func add(a: int, b: int) -> int { ... }");
    }
    this.functionDepth++;
    const savedLoop = this.loopDepth;
    this.loopDepth = 0;
    const savedAsync = this.inAsync;
    this.inAsync = isAsync;
    const body = this.block();
    this.inAsync = savedAsync;
    this.loopDepth = savedLoop;
    this.functionDepth--;
    return { params, returnType, body };
  }

  parameterList() {
    this.expect(T.LEFT_PAREN);
    const params = [];
    let sawDefault = false;
    while (!this.check(T.RIGHT_PAREN)) {
      const start = this.startLoc();
      const rest = Boolean(this.match(T.SPREAD));
      const name = this.identifier("a parameter name");
      let typeAnnotation = null;
      let defaultValue = null;
      if (this.match(T.COLON)) typeAnnotation = this.typeAnnotation();
      if (this.match(T.EQUAL)) {
        defaultValue = this.expression();
        sawDefault = true;
      } else if (sawDefault && !rest) {
        throw this.error(`Parameter "${name.name}" needs a default value because an earlier parameter has one.`, this.previous());
      }
      params.push(this.node(N.Parameter, { name, typeAnnotation, defaultValue, rest }, start));
      if (rest && !this.check(T.RIGHT_PAREN)) throw this.error("A ...rest parameter must be the last parameter.", this.current);
      if (!this.match(T.COMMA)) break;
    }
    this.expect(T.RIGHT_PAREN, '")"', this.check(T.IDENTIFIER) ? 'Separate parameters with ",".' : null);
    return params;
  }

  classDeclaration(exported) {
    const start = this.startLoc();
    this.expect(T.CLASS);
    const name = this.identifier("a class name");
    let superClass = null;
    if (this.match(T.EXTENDS)) superClass = this.identifier("a parent class name");
    else if (this.check(T.COLON)) throw this.error('Use "extends" to inherit from another class.', this.current, `    class ${name.name} extends Parent { ... }`);
    this.expect(T.LEFT_BRACE, '"{"');
    const fields = [];
    const methods = [];
    this.inClass = (this.inClass || 0) + 1; // field initialisers may use self
    this.skipNewlines();
    while (!this.check(T.RIGHT_BRACE) && !this.check(T.EOF)) {
      const memberStart = this.startLoc();
      if (this.check(T.LET) || this.check(T.CONST)) {
        const constant = this.advance().type === T.CONST;
        const fname = this.identifier("a field name");
        let typeAnnotation = null;
        let value = null;
        if (this.match(T.COLON)) typeAnnotation = this.typeAnnotation();
        if (this.match(T.EQUAL)) value = this.expression();
        this.endStatement();
        fields.push(this.node(N.FieldDeclaration, { name: fname, typeAnnotation, value, constant }, memberStart));
      } else if (this.check(T.FUNC) || (this.check(T.ASYNC) && this.peek().type === T.FUNC)) {
        const isAsync = Boolean(this.match(T.ASYNC));
        this.expect(T.FUNC);
        const mname = this.identifier("a method name");
        const fn = this.functionRest(isAsync);
        methods.push(this.node(N.FunctionDeclaration, { name: mname, params: fn.params, returnType: fn.returnType, body: fn.body, async: isAsync, exported: false, method: true }, memberStart));
      } else {
        throw this.error(`Unexpected ${describe(this.current)} in class body.`, this.current, "A class body contains fields and methods:\n\n    class Player {\n        let name\n        let coins = 0\n\n        func init(name) {\n            self.name = name\n        }\n    }");
      }
      this.skipNewlines();
    }
    this.expect(T.RIGHT_BRACE, '"}"');
    this.inClass--;
    return this.node(N.ClassDeclaration, { name, superClass, fields, methods, exported }, start);
  }

  typeDeclaration(exported) {
    const start = this.startLoc();
    this.advance(); // "type"
    const name = this.identifier("a type name");
    this.expect(T.LEFT_BRACE, '"{"');
    const fields = [];
    this.skipNewlines();
    while (!this.check(T.RIGHT_BRACE)) {
      const fstart = this.startLoc();
      const fname = this.expectName("a field name");
      const optional = Boolean(this.match(T.QUESTION));
      this.expect(T.COLON, '":" and a type', `    ${fname.value}: string`);
      const typeAnnotation = this.typeAnnotation();
      fields.push(this.node(N.TypeField, { name: fname.value, typeAnnotation, optional }, fstart));
      this.match(T.COMMA);
      this.skipNewlines();
    }
    this.expect(T.RIGHT_BRACE, '"}"');
    return this.node(N.TypeDeclaration, { name, fields, exported }, start);
  }

  // type := primary ("|" primary)*      primary := name "?"? | "[" type "]" "?"?
  typeAnnotation() {
    const start = this.startLoc();
    const first = this.typePrimary();
    if (!this.check(T.PIPE)) return first;
    const types = [first];
    while (this.match(T.PIPE)) types.push(this.typePrimary());
    return this.node(N.UnionType, { types }, start);
  }

  typePrimary() {
    const start = this.startLoc();
    let type;
    if (this.match(T.LEFT_BRACKET)) {
      const element = this.typeAnnotation();
      this.expect(T.RIGHT_BRACKET, '"]"');
      type = this.node(N.ArrayType, { element }, start);
    } else if (this.check(T.IDENTIFIER) || this.check(T.NULL) || this.check(T.FUNC)) {
      const tok = this.advance();
      type = this.node(N.TypeName, { name: tok.type === T.NULL ? "null" : tok.value }, start);
    } else {
      throw this.error(`Expected a type, but found ${describe(this.current)}.`, this.current, "Types include: string, int, float, number, bool, array, object, func, any — or a class or type name.");
    }
    if (this.match(T.QUESTION)) type = this.node(N.NullableType, { inner: type }, start);
    return type;
  }

  ifStatement() {
    const start = this.startLoc();
    this.expect(T.IF);
    const test = this.condition("if");
    const consequent = this.block();
    let alternate = null;
    // allow "}\nelse {" as well as "} else {"
    if (this.check(T.NEWLINE) && this.peek().type === T.ELSE) this.advance();
    if (this.match(T.ELSE)) {
      if (this.check(T.IF)) alternate = this.ifStatement();
      else alternate = this.block();
    }
    return this.node(N.IfStatement, { test, consequent, alternate }, start);
  }

  condition(keyword) {
    if (this.check(T.LEFT_BRACE)) {
      throw this.error(`"${keyword}" needs a condition before "{".`, this.current, `    ${keyword} count > 0 {`);
    }
    const test = this.expression();
    if (this.check(T.EQUAL)) {
      throw this.error(`Unexpected "=" in the ${keyword} condition.`, this.current, `To compare values use "==":

    ${keyword} ${this.source.slice(test.loc.start, test.loc.end)} == ... {`);
    }
    if (this.check(T.COLON)) {
      throw this.error(`KIVO uses braces for blocks, not ":".`, this.current, `    ${keyword} ... {\n        ...\n    }`);
    }
    return test;
  }

  forStatement() {
    const start = this.startLoc();
    this.expect(T.FOR);
    if (this.check(T.LEFT_PAREN)) {
      throw this.error("KIVO for loops don't use parentheses.", this.current, "    for i in 0..<10 {\n        print(i)\n    }\n\n    for item in items {\n        print(item)\n    }");
    }
    let key = null;
    let value = this.identifier("a loop variable name");
    if (this.match(T.COMMA)) {
      key = value;
      value = this.identifier("a loop variable name");
    }
    if (!this.check(T.IN)) {
      throw this.error(`Expected "in" after the loop variable, but found ${describe(this.current)}.`, this.current, `    for ${value.name} in items { ... }`);
    }
    this.advance();
    const iterable = this.expression();
    this.loopDepth++;
    const body = this.block();
    this.loopDepth--;
    return this.node(N.ForStatement, { key, value, iterable, body }, start);
  }

  whileStatement() {
    const start = this.startLoc();
    this.expect(T.WHILE);
    const test = this.condition("while");
    this.loopDepth++;
    const body = this.block();
    this.loopDepth--;
    return this.node(N.WhileStatement, { test, body }, start);
  }

  returnStatement() {
    const start = this.startLoc();
    const tok = this.expect(T.RETURN);
    if (this.functionDepth === 0) throw this.error('"return" can only be used inside a function.', tok);
    let argument = null;
    if (!this.check(T.NEWLINE) && !this.check(T.RIGHT_BRACE) && !this.check(T.EOF) && !this.check(T.SEMICOLON)) {
      argument = this.expression();
    }
    this.endStatement();
    return this.node(N.ReturnStatement, { argument }, start);
  }

  jumpStatement() {
    const start = this.startLoc();
    const tok = this.advance();
    if (this.loopDepth === 0) throw this.error(`"${tok.value}" can only be used inside a loop.`, tok);
    this.endStatement();
    return this.node(tok.type === T.BREAK ? N.BreakStatement : N.ContinueStatement, {}, start);
  }

  tryStatement() {
    const start = this.startLoc();
    this.expect(T.TRY);
    const block = this.block();
    let param = null;
    let handler = null;
    let finalizer = null;
    if (this.check(T.NEWLINE) && (this.peek().type === T.CATCH || this.peek().type === T.FINALLY)) this.advance();
    if (this.match(T.CATCH)) {
      if (this.check(T.LEFT_PAREN)) {
        throw this.error("KIVO catch clauses don't use parentheses.", this.current, "    try {\n        ...\n    } catch error {\n        print(error.message)\n    }");
      }
      if (this.check(T.IDENTIFIER)) param = this.identifier();
      handler = this.block();
    }
    if (this.check(T.NEWLINE) && this.peek().type === T.FINALLY) this.advance();
    if (this.match(T.FINALLY)) finalizer = this.block();
    if (!handler && !finalizer) {
      throw this.error('"try" needs a "catch" or "finally" block.', this.current, "    try {\n        ...\n    } catch error {\n        print(error.message)\n    }");
    }
    return this.node(N.TryStatement, { block, param, handler, finalizer }, start);
  }

  throwStatement() {
    const start = this.startLoc();
    this.expect(T.THROW);
    if (this.check(T.NEWLINE) || this.check(T.EOF)) throw this.error('"throw" needs a value.', this.current, '    throw "Something went wrong"');
    const argument = this.expression();
    this.endStatement();
    return this.node(N.ThrowStatement, { argument }, start);
  }

  // import math | import math as m | import "./file.kivo" as name
  // from fs import read, write | from "./file.kivo" import a, b as c
  importDeclaration() {
    const start = this.startLoc();
    if (this.match(T.FROM)) {
      const { source, isPath, sourceLoc } = this.importSource();
      this.expect(T.IMPORT, '"import"', `    from ${isPath ? JSON.stringify(source) : source} import name`);
      const specifiers = [];
      do {
        const sstart = this.startLoc();
        const imported = this.identifier("a name to import");
        let local = imported;
        if (this.match(T.AS)) local = this.identifier("a name");
        specifiers.push(this.node(N.ImportSpecifier, { imported: imported.name, local }, sstart));
      } while (this.match(T.COMMA));
      this.endStatement();
      return this.node(N.ImportDeclaration, { source, isPath, sourceLoc, alias: null, specifiers }, start);
    }
    this.expect(T.IMPORT);
    const { source, isPath, sourceLoc, tok } = this.importSource();
    let alias = null;
    if (this.match(T.AS)) alias = this.identifier("a name");
    else if (isPath) {
      const base = source.split("/").pop().replace(/\.kivo$/, "");
      if (!/^[A-Za-z_]\w*$/.test(base)) throw this.error("Give this import a name with \"as\".", tok, `    import ${JSON.stringify(source)} as utils`);
      alias = { type: N.Identifier, name: base, loc: sourceLoc };
    } else {
      alias = { type: N.Identifier, name: source.split(".").pop(), loc: sourceLoc };
    }
    if (this.check(T.COMMA)) throw this.error("Import one module per line.", this.current);
    this.endStatement();
    return this.node(N.ImportDeclaration, { source, isPath, sourceLoc, alias, specifiers: null }, start);
  }

  importSource() {
    const tok = this.current;
    if (tok.type === T.STRING) {
      if (tok.value === null) throw this.error("Import paths cannot contain interpolation.", tok);
      this.advance();
      return { source: tok.value, isPath: true, tok, sourceLoc: this.tokLoc(tok) };
    }
    if (tok.type === T.IDENTIFIER) {
      this.advance();
      let name = tok.value;
      let last = tok;
      while (this.check(T.DOT) && this.peek().type === T.IDENTIFIER) {
        this.advance();
        last = this.advance();
        name += "." + last.value;
      }
      const loc = this.tokLoc(tok);
      loc.end = last.end;
      loc.endColumn = last.column + (last.end - last.start);
      return { source: name, isPath: false, tok, sourceLoc: loc };
    }
    throw this.error(`Expected a module name or a file path, but found ${describe(tok)}.`, tok, '    import math\n    from "./utils.kivo" import helper');
  }

  tokLoc(tok) {
    return { start: tok.start, end: tok.end, line: tok.line, column: tok.column, endLine: tok.line, endColumn: tok.column + (tok.end - tok.start) };
  }

  expressionStatement() {
    const start = this.startLoc();
    const expr = this.expression();
    const opTok = this.current;
    if (ASSIGN_OPS[opTok.type]) {
      this.advance();
      if (expr.type !== N.Identifier && expr.type !== N.MemberExpression && expr.type !== N.IndexExpression) {
        throw this.error("You can only assign to a variable, a property or an index.", opTok);
      }
      if ((expr.type === N.MemberExpression || expr.type === N.IndexExpression) && expr.optional) {
        throw this.error('You cannot assign through "?.".', opTok, "Check for null first, then assign.");
      }
      const value = this.expression();
      if (ASSIGN_OPS[this.current.type]) {
        throw this.error("Chained assignment is not supported.", this.current, "Assign each variable on its own line.");
      }
      this.endStatement();
      return this.node(N.AssignmentStatement, { operator: ASSIGN_OPS[opTok.type], target: expr, value }, start);
    }
    if (opTok.type === T.COLON && expr.type === N.Identifier) {
      throw this.error(`Unexpected ":" after "${expr.name}".`, opTok, `To declare a typed variable, use let:\n\n    let ${expr.name}: type = value`);
    }
    this.endStatement();
    return this.node(N.ExpressionStatement, { expression: expr }, start);
  }

  // ---------------------------------------------------------------- expressions
  //
  // Precedence, lowest to highest:
  //   or
  //   and
  //   not
  //   == != < > <= >=
  //   ??
  //   .. ..<
  //   + -
  //   * / %
  //   - (unary), await
  //   call, member, index, ?.

  expression() {
    return this.or();
  }

  or() {
    const start = this.startLoc();
    let left = this.and();
    while (this.check(T.OR)) {
      this.advance();
      this.skipNewlines();
      const right = this.and();
      left = this.node(N.LogicalExpression, { operator: "or", left, right }, start);
    }
    return left;
  }

  and() {
    const start = this.startLoc();
    let left = this.not();
    while (this.check(T.AND)) {
      this.advance();
      this.skipNewlines();
      const right = this.not();
      left = this.node(N.LogicalExpression, { operator: "and", left, right }, start);
    }
    return left;
  }

  not() {
    const start = this.startLoc();
    if (this.match(T.NOT)) {
      const argument = this.not();
      return this.node(N.UnaryExpression, { operator: "not", argument }, start);
    }
    return this.comparison();
  }

  comparison() {
    const start = this.startLoc();
    const left = this.coalesce();
    const op = COMPARISON_OPS[this.current.type];
    if (!op) return left;
    this.advance();
    this.skipNewlines();
    const right = this.coalesce();
    const node = this.node(N.BinaryExpression, { operator: op, left, right }, start);
    if (COMPARISON_OPS[this.current.type]) {
      throw this.error("Comparisons cannot be chained.", this.current, "Combine them with \"and\":\n\n    if 0 < x and x < 10 { ... }");
    }
    return node;
  }

  coalesce() {
    const start = this.startLoc();
    let left = this.range();
    while (this.check(T.QUESTION_QUESTION)) {
      this.advance();
      this.skipNewlines();
      const right = this.range();
      left = this.node(N.LogicalExpression, { operator: "??", left, right }, start);
    }
    return left;
  }

  range() {
    const start = this.startLoc();
    const left = this.additive();
    if (this.check(T.RANGE) || this.check(T.RANGE_EXCLUSIVE)) {
      const inclusive = this.advance().type === T.RANGE;
      const right = this.additive();
      return this.node(N.RangeExpression, { start: left, end: right, inclusive }, start);
    }
    return left;
  }

  additive() {
    const start = this.startLoc();
    let left = this.multiplicative();
    while (this.check(T.PLUS) || this.check(T.MINUS)) {
      const op = this.advance().value;
      this.skipNewlines();
      const right = this.multiplicative();
      left = this.node(N.BinaryExpression, { operator: op, left, right }, start);
    }
    return left;
  }

  multiplicative() {
    const start = this.startLoc();
    let left = this.unary();
    while (this.check(T.STAR) || this.check(T.SLASH) || this.check(T.PERCENT)) {
      const op = this.advance().value;
      this.skipNewlines();
      const right = this.unary();
      left = this.node(N.BinaryExpression, { operator: op, left, right }, start);
    }
    return left;
  }

  unary() {
    const start = this.startLoc();
    if (this.match(T.MINUS)) {
      const argument = this.unary();
      return this.node(N.UnaryExpression, { operator: "-", argument }, start);
    }
    if (this.check(T.PLUS)) {
      throw this.error('KIVO has no unary "+".', this.current, 'To convert text to a number use number():\n\n    number("42")');
    }
    if (this.check(T.AWAIT)) {
      const tok = this.advance();
      if (this.functionDepth > 0 && !this.inAsync) {
        throw this.error('"await" can only be used inside an async func.', tok, "Mark the surrounding function as async:\n\n    async func load() {\n        let data = await http.get(url)\n    }");
      }
      const argument = this.unary();
      return this.node(N.AwaitExpression, { argument }, start);
    }
    return this.postfix();
  }

  postfix() {
    const start = this.startLoc();
    let expr = this.primary();
    while (true) {
      // allow method chains that continue on the next line with a leading "."
      if (this.check(T.NEWLINE) && (this.peek().type === T.DOT || this.peek().type === T.QUESTION_DOT)) {
        this.advance();
      }
      const tok = this.current;
      if (tok.type === T.LEFT_PAREN && !tok.newlineBefore) {
        const args = this.argumentList();
        expr = this.node(N.CallExpression, { callee: expr, args, optional: false }, start);
      } else if (tok.type === T.DOT) {
        this.advance();
        const nameTok = this.current;
        if (!isNameLike(nameTok)) {
          throw this.error(`Expected a property name after ".", but found ${describe(nameTok)}.`, nameTok);
        }
        this.advance();
        expr = this.node(N.MemberExpression, { object: expr, property: String(nameTok.value), propertyLoc: this.tokLoc(nameTok), optional: false }, start);
      } else if (tok.type === T.QUESTION_DOT) {
        this.advance();
        if (this.check(T.LEFT_BRACKET)) {
          this.advance();
          const index = this.expression();
          this.expect(T.RIGHT_BRACKET, '"]"');
          expr = this.node(N.IndexExpression, { object: expr, index, optional: true }, start);
        } else if (this.check(T.LEFT_PAREN)) {
          const args = this.argumentList();
          expr = this.node(N.CallExpression, { callee: expr, args, optional: true }, start);
        } else {
          const nameTok = this.current;
          if (!isNameLike(nameTok)) throw this.error(`Expected a property name after "?.", but found ${describe(nameTok)}.`, nameTok);
          this.advance();
          expr = this.node(N.MemberExpression, { object: expr, property: String(nameTok.value), propertyLoc: this.tokLoc(nameTok), optional: true }, start);
        }
      } else if (tok.type === T.LEFT_BRACKET && !tok.newlineBefore) {
        this.advance();
        if (this.check(T.RIGHT_BRACKET)) throw this.error("Expected an index inside [ ].", this.current);
        const index = this.expression();
        if (this.check(T.COLON)) {
          throw this.error('Slices are written with the slice() method.', this.current, "    items.slice(1, 3)\n    text.slice(0, 5)");
        }
        this.expect(T.RIGHT_BRACKET, '"]"');
        expr = this.node(N.IndexExpression, { object: expr, index, optional: false }, start);
      } else {
        break;
      }
    }
    return expr;
  }

  argumentList() {
    this.expect(T.LEFT_PAREN);
    const args = [];
    while (!this.check(T.RIGHT_PAREN)) {
      if (this.check(T.SPREAD)) {
        const s = this.startLoc();
        this.advance();
        args.push(this.node(N.SpreadElement, { argument: this.expression() }, s));
      } else {
        args.push(this.expression());
      }
      if (!this.match(T.COMMA)) break;
    }
    if (!this.check(T.RIGHT_PAREN)) {
      throw this.error(`Expected "," or ")" in the argument list, but found ${describe(this.current)}.`, this.current);
    }
    this.advance();
    return args;
  }

  primary() {
    const tok = this.current;
    const start = this.startLoc();
    switch (tok.type) {
      case T.NUMBER:
        this.advance();
        return this.node(N.NumberLiteral, { value: tok.value, raw: tok.raw }, start);
      case T.STRING:
        this.advance();
        return this.stringNode(tok, start);
      case T.TRUE:
      case T.FALSE:
        this.advance();
        return this.node(N.BooleanLiteral, { value: tok.value }, start);
      case T.NULL:
        this.advance();
        return this.node(N.NullLiteral, {}, start);
      case T.SELF:
        this.advance();
        if (!this.inClass) throw this.error('"self" can only be used inside a class method.', tok);
        return this.node(N.SelfExpression, {}, start);
      case T.SUPER: {
        this.advance();
        if (!this.inClass) throw this.error('"super" can only be used inside a class method.', tok);
        this.expect(T.DOT, '"." after super', "    super.init(name)");
        const nameTok = this.expectName("a method name");
        return this.node(N.SuperMemberExpression, { property: nameTok.value, propertyLoc: this.tokLoc(nameTok) }, start);
      }
      case T.IDENTIFIER:
        if (this.peek().type === T.FAT_ARROW) return this.arrowFunction(false);
        if (tok.value === "new" && this.peek().type === T.IDENTIFIER && !this.peek().newlineBefore) {
          const cls = this.peek().value;
          throw this.error('KIVO has no "new" keyword.', tok, `Create objects by calling the class:\n\n    ${cls}(...)`);
        }
        this.advance();
        return this.identifierFrom(tok);
      case T.LEFT_PAREN:
        if (this.isArrowAhead()) return this.arrowFunction(false);
        return this.parenthesized();
      case T.LEFT_BRACKET:
        return this.arrayLiteral();
      case T.LEFT_BRACE:
        return this.objectLiteral();
      case T.FUNC:
        return this.functionExpression(false);
      case T.ASYNC:
        if (this.peek().type === T.FUNC) {
          this.advance();
          return this.functionExpression(true, start);
        }
        if (this.peek().type === T.IDENTIFIER || this.peek().type === T.LEFT_PAREN) {
          this.advance();
          return this.arrowFunction(true, start);
        }
        throw this.error('Expected "func" or an arrow function after "async".', this.peek());
      default:
        break;
    }
    if (tok.type === T.NEWLINE || tok.type === T.EOF) {
      throw this.error("This expression is incomplete.", this.previous() || tok, "Something is missing at the end of this line.");
    }
    if (tok.type === T.EQUAL) {
      throw this.error('Unexpected "=".', tok, 'To compare values use "==":\n\n    if count == 10 { ... }');
    }
    throw this.error(`Unexpected ${describe(tok)}.`, tok);
  }

  parenthesized() {
    const start = this.startLoc();
    this.advance();
    if (this.check(T.RIGHT_PAREN)) throw this.error("Empty parentheses are not an expression.", this.current);
    const expr = this.expression();
    this.expect(T.RIGHT_PAREN, '")"');
    expr.parenthesized = true;
    return expr;
  }

  isArrowAhead() {
    let depth = 0;
    for (let i = this.pos; i < this.tokens.length; i++) {
      const t = this.tokens[i].type;
      if (t === T.LEFT_PAREN) depth++;
      else if (t === T.RIGHT_PAREN) {
        depth--;
        if (depth === 0) {
          const next = this.tokens[i + 1];
          return Boolean(next && next.type === T.FAT_ARROW);
        }
      } else if (t === T.EOF) return false;
    }
    return false;
  }

  arrowFunction(isAsync, startOverride) {
    const start = startOverride || this.startLoc();
    let params;
    if (this.check(T.IDENTIFIER)) {
      const pstart = this.startLoc();
      const name = this.identifier();
      params = [this.node(N.Parameter, { name, typeAnnotation: null, defaultValue: null, rest: false }, pstart)];
    } else {
      params = this.parameterList();
    }
    this.expect(T.FAT_ARROW, '"=>"');
    this.functionDepth++;
    const savedAsync = this.inAsync;
    const savedLoop = this.loopDepth;
    this.loopDepth = 0;
    this.inAsync = isAsync;
    let body;
    let expression = false;
    if (this.check(T.LEFT_BRACE) && !this.objectLiteralAhead()) {
      body = this.block();
    } else {
      body = this.expression();
      expression = true;
    }
    this.inAsync = savedAsync;
    this.loopDepth = savedLoop;
    this.functionDepth--;
    return this.node(N.FunctionExpression, { name: null, params, returnType: null, body, async: isAsync, arrow: true, expression }, start);
  }

  // After "=>", "{ key: ..." or "{ ...spread" is an object literal, not a block.
  // (KIVO has no labels, so a block can never start with "name:".)
  objectLiteralAhead() {
    let i = 1;
    while (this.peek(i).type === T.NEWLINE) i++;
    const a = this.peek(i);
    if (a.type === T.SPREAD) return true;
    const b = this.peek(i + 1);
    return (isNameLike(a) || a.type === T.STRING) && b.type === T.COLON;
  }

  functionExpression(isAsync, startOverride) {
    const start = startOverride || this.startLoc();
    this.expect(T.FUNC);
    let name = null;
    if (this.check(T.IDENTIFIER)) name = this.identifier();
    const fn = this.functionRest(isAsync);
    return this.node(N.FunctionExpression, { name, params: fn.params, returnType: fn.returnType, body: fn.body, async: isAsync, arrow: false, expression: false }, start);
  }

  arrayLiteral() {
    const start = this.startLoc();
    this.expect(T.LEFT_BRACKET);
    const elements = [];
    while (!this.check(T.RIGHT_BRACKET)) {
      if (this.check(T.SPREAD)) {
        const s = this.startLoc();
        this.advance();
        elements.push(this.node(N.SpreadElement, { argument: this.expression() }, s));
      } else {
        elements.push(this.expression());
      }
      if (!this.match(T.COMMA)) break;
    }
    if (!this.check(T.RIGHT_BRACKET)) {
      throw this.error(`Expected "," or "]" in the array, but found ${describe(this.current)}.`, this.current, "Separate array items with commas:\n\n    [1, 2, 3]");
    }
    this.advance();
    return this.node(N.ArrayExpression, { elements }, start);
  }

  objectLiteral() {
    const start = this.startLoc();
    this.expect(T.LEFT_BRACE);
    const properties = [];
    this.skipNewlines();
    while (!this.check(T.RIGHT_BRACE)) {
      const pstart = this.startLoc();
      if (this.check(T.SPREAD)) {
        this.advance();
        properties.push(this.node(N.SpreadElement, { argument: this.expression() }, pstart));
      } else {
        const keyTok = this.current;
        if (!isNameLike(keyTok) && !(keyTok.type === T.STRING && keyTok.value !== null)) {
          throw this.error(`Expected a property name, but found ${describe(keyTok)}.`, keyTok, "Object properties look like:\n\n    { name: \"Hugo\", coins: 500 }");
        }
        this.advance();
        const key = String(keyTok.value);
        const keyLoc = this.tokLoc(keyTok);
        if (this.match(T.COLON)) {
          this.skipNewlines();
          const value = this.expression();
          properties.push(this.node(N.Property, { key, keyLoc, quoted: keyTok.type === T.STRING, value, shorthand: false }, pstart));
        } else if (keyTok.type === T.IDENTIFIER && (this.check(T.COMMA) || this.check(T.RIGHT_BRACE) || this.check(T.NEWLINE))) {
          properties.push(this.node(N.Property, { key, keyLoc, quoted: false, value: this.identifierFrom(keyTok), shorthand: true }, pstart));
        } else if (this.check(T.EQUAL)) {
          throw this.error('Object properties use ":", not "=".', this.current, `    { ${key}: value }`);
        } else {
          throw this.error(`Expected ":" after the property name "${key}".`, this.current, `    { ${key}: value }`);
        }
      }
      const sep = this.match(T.COMMA);
      const nl = this.check(T.NEWLINE);
      this.skipNewlines();
      if (!sep && !nl) break;
    }
    if (!this.check(T.RIGHT_BRACE)) {
      throw this.error(`Expected "," or "}" in the object, but found ${describe(this.current)}.`, this.current, "Separate properties with commas:\n\n    { name: \"Hugo\", coins: 500 }");
    }
    this.advance();
    return this.node(N.ObjectExpression, { properties }, start);
  }

  stringNode(tok, start) {
    if (tok.parts.every((p) => p.kind === "text")) {
      return this.node(N.StringLiteral, { value: tok.value, raw: tok.raw, triple: tok.triple }, start);
    }
    const parts = tok.parts.map((part) => {
      if (part.kind === "text") return part.value;
      const sub = new Parser([...part.tokens, { type: T.EOF, value: "", start: part.end - 1, end: part.end, line: part.line, column: part.column + (part.end - part.start) - 1 }], {
        file: this.file,
        source: this.source,
      });
      sub.functionDepth = this.functionDepth;
      sub.inAsync = this.inAsync;
      sub.inClass = this.inClass;
      const expr = sub.expression();
      if (!sub.check(T.EOF)) {
        throw sub.error(`Unexpected ${describe(sub.current)} inside "{...}".`, sub.current, 'Each {...} in a string holds one expression, like {user.name} or {count + 1}.\nTo write a literal brace (for example in JSON text), escape it: \\{');
      }
      return expr;
    });
    return this.node(N.TemplateString, { parts, raw: tok.raw, triple: tok.triple }, start);
  }
}

function parse(source, { file = null, recover = false } = {}) {
  let tokens;
  let comments;
  let lexErrors = [];
  try {
    ({ tokens, comments, errors: lexErrors } = tokenize(source, file, { tolerant: recover }));
  } catch (err) {
    if (recover && err instanceof KivoCompileError) {
      return { program: { type: N.Program, body: [], comments: [], loc: { start: 0, end: 0, line: 1, column: 1 } }, errors: err.diagnostics, comments: [] };
    }
    throw err;
  }
  const parser = new Parser(tokens, { file, source, recover });
  const program = parser.parseProgram();
  program.comments = comments;
  if (recover) {
    // the lexer and the parser may both report the same broken token
    const seen = new Set();
    const errors = [...lexErrors, ...parser.errors].filter((d) => {
      const key = `${d.line}:${d.column}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { program, errors, comments };
  }
  return program;
}

module.exports = { Parser, parse };
