"use strict";

// The KIVO formatter. Prints the AST back as canonical KIVO source while
// keeping comments and (single) blank lines. After formatting it re-parses
// the result and verifies the program is unchanged, so formatting can never
// silently alter what code does.

const { parse, NodeType: N } = require("../../parser/src");

const INDENT = "    ";
const MAX_INLINE = 100;

const PRECEDENCE = {
  or: 1,
  and: 2,
  not: 3,
  "==": 4,
  "!=": 4,
  "<": 4,
  ">": 4,
  "<=": 4,
  ">=": 4,
  "??": 5,
  range: 6,
  "+": 7,
  "-": 7,
  "*": 8,
  "/": 8,
  "%": 8,
  unary: 9,
};

class Printer {
  constructor(source, comments) {
    this.source = source;
    this.comments = comments.slice().sort((a, b) => a.start - b.start);
    this.nextComment = 0;
    this.depth = 0;
    this.lines = [];
  }

  ind(extra = 0) {
    return INDENT.repeat(this.depth + extra);
  }

  // ---------------------------------------------------------- comments

  pendingCommentsBefore(pos) {
    const out = [];
    while (this.nextComment < this.comments.length && this.comments[this.nextComment].start < pos) {
      out.push(this.comments[this.nextComment++]);
    }
    return out;
  }

  // A comment on the same line, right after `end`.
  trailingComment(end) {
    const c = this.comments[this.nextComment];
    if (!c) return null;
    const between = this.source.slice(end, c.start);
    if (/\n/.test(between)) return null;
    if (!/^[\s;,]*$/.test(between)) return null;
    if (c.kind === "block" && /\n/.test(c.text)) return null;
    this.nextComment++;
    return c;
  }

  commentText(c) {
    return c.kind === "line" ? c.text.replace(/\s+$/, "") : c.text;
  }

  blankLineBefore(pos) {
    // is there an empty line between the previous non-space text and pos?
    let i = pos - 1;
    while (i >= 0 && (this.source[i] === " " || this.source[i] === "\t")) i--;
    if (this.source[i] !== "\n") return false;
    i--;
    while (i >= 0 && (this.source[i] === " " || this.source[i] === "\t" || this.source[i] === "\r")) i--;
    return this.source[i] === "\n";
  }

  // ---------------------------------------------------------- statements

  // Prints a list of statements (with comments) into an array of lines.
  statementList(statements, endPos) {
    const out = [];
    statements.forEach((s, idx) => {
      const leading = this.pendingCommentsBefore(s.loc.start);
      const firstPos = leading.length ? leading[0].start : s.loc.start;
      if (idx > 0 || out.length) {
        if (this.blankLineBefore(firstPos) || (idx > 0 && this.needsSeparation(statements[idx - 1], s))) out.push("");
      }
      leading.forEach((c, i) => {
        if (i > 0 && this.blankLineBefore(c.start)) out.push("");
        out.push(this.ind() + this.commentText(c, this.ind()));
      });
      if (leading.length && this.blankLineBefore(s.loc.start)) out.push("");
      const text = this.statement(s);
      const trailing = this.trailingComment(s.loc.end);
      out.push(this.ind() + text + (trailing ? " " + trailing.text.trim() : ""));
    });
    const rest = this.pendingCommentsBefore(endPos);
    rest.forEach((c, i) => {
      if ((out.length && this.blankLineBefore(c.start)) || (i === 0 && out.length && false)) out.push("");
      out.push(this.ind() + this.commentText(c, this.ind()));
    });
    return out;
  }

  needsSeparation(prev, next) {
    const isBlockish = (s) => s.type === N.FunctionDeclaration || s.type === N.ClassDeclaration || s.type === N.TypeDeclaration;
    return (isBlockish(prev) || isBlockish(next)) && !(prev.type === next.type && prev.type !== N.FunctionDeclaration && prev.type !== N.ClassDeclaration && prev.type !== N.TypeDeclaration);
  }

  block(block) {
    const end = block.loc.end - 1; // position of "}"
    if (block.body.length === 0) {
      const inner = this.pendingCommentsBefore(end);
      if (!inner.length) return "{}";
      this.depth++;
      const lines = inner.map((c) => this.ind() + this.commentText(c, this.ind()));
      this.depth--;
      return `{\n${lines.join("\n")}\n${this.ind()}}`;
    }
    this.depth++;
    const lines = this.statementList(block.body, end);
    this.depth--;
    return `{\n${lines.join("\n")}\n${this.ind()}}`;
  }

  statement(s) {
    switch (s.type) {
      case N.VariableDeclaration: {
        let out = `${s.exported ? "export " : ""}${s.kind} ${this.pattern(s.target)}`;
        if (s.typeAnnotation) out += `: ${this.type(s.typeAnnotation)}`;
        if (s.value) out += ` = ${this.expr(s.value)}`;
        return out;
      }
      case N.FunctionDeclaration:
        return `${s.exported ? "export " : ""}${s.async ? "async " : ""}func ${s.name.name}(${this.params(s.params)})${s.returnType ? " -> " + this.type(s.returnType) : ""} ${this.block(s.body)}`;
      case N.ClassDeclaration:
        return this.classDeclaration(s);
      case N.TypeDeclaration: {
        const end = s.loc.end - 1;
        if (!s.fields.length) return `${s.exported ? "export " : ""}type ${s.name.name} {}`;
        this.depth++;
        const lines = [];
        for (const f of s.fields) {
          for (const c of this.pendingCommentsBefore(f.loc.start)) lines.push(this.ind() + this.commentText(c, this.ind()));
          const trailing = this.trailingComment(f.loc.end);
          lines.push(`${this.ind()}${/^[A-Za-z_]\w*$/.test(f.name) ? f.name : JSON.stringify(f.name)}${f.optional ? "?" : ""}: ${this.type(f.typeAnnotation)}${trailing ? " " + trailing.text.trim() : ""}`);
        }
        for (const c of this.pendingCommentsBefore(end)) lines.push(this.ind() + this.commentText(c, this.ind()));
        this.depth--;
        return `${s.exported ? "export " : ""}type ${s.name.name} {\n${lines.join("\n")}\n${this.ind()}}`;
      }
      case N.ExpressionStatement:
        return this.expr(s.expression);
      case N.AssignmentStatement:
        return `${this.expr(s.target)} ${s.operator} ${this.expr(s.value)}`;
      case N.IfStatement:
        return this.ifStatement(s);
      case N.ForStatement:
        return `for ${s.key ? s.key.name + ", " : ""}${s.value.name} in ${this.expr(s.iterable)} ${this.block(s.body)}`;
      case N.WhileStatement:
        return `while ${this.expr(s.test)} ${this.block(s.body)}`;
      case N.BreakStatement:
        return "break";
      case N.ContinueStatement:
        return "continue";
      case N.ReturnStatement:
        return s.argument ? `return ${this.expr(s.argument)}` : "return";
      case N.ThrowStatement:
        return `throw ${this.expr(s.argument)}`;
      case N.TryStatement: {
        let out = `try ${this.block(s.block)}`;
        if (s.handler) out += ` catch ${s.param ? s.param.name + " " : ""}${this.block(s.handler)}`;
        if (s.finalizer) out += ` finally ${this.block(s.finalizer)}`;
        return out;
      }
      case N.ImportDeclaration: {
        const src = s.isPath ? JSON.stringify(s.source) : s.source;
        if (s.specifiers) {
          return `from ${src} import ${s.specifiers.map((sp) => (sp.imported === sp.local.name ? sp.imported : `${sp.imported} as ${sp.local.name}`)).join(", ")}`;
        }
        const defaultAlias = s.isPath ? s.source.split("/").pop().replace(/\.kivo$/, "") : s.source.split(".").pop();
        return `import ${src}${s.isPath || s.alias.name !== defaultAlias ? " as " + s.alias.name : ""}`;
      }
      default:
        throw new Error(`formatter: unknown statement ${s.type}`);
    }
  }

  ifStatement(s) {
    let out = `if ${this.expr(s.test)} ${this.block(s.consequent)}`;
    if (s.alternate) {
      if (s.alternate.type === N.IfStatement) out += ` else ${this.ifStatement(s.alternate)}`;
      else out += ` else ${this.block(s.alternate)}`;
    }
    return out;
  }

  classDeclaration(s) {
    const head = `${s.exported ? "export " : ""}class ${s.name.name}${s.superClass ? " extends " + s.superClass.name : ""}`;
    const members = [...s.fields, ...s.methods].sort((a, b) => a.loc.start - b.loc.start);
    const end = s.loc.end - 1;
    if (!members.length) {
      const inner = this.pendingCommentsBefore(end);
      if (!inner.length) return `${head} {}`;
    }
    this.depth++;
    const lines = [];
    members.forEach((m, i) => {
      const leading = this.pendingCommentsBefore(m.loc.start);
      const first = leading.length ? leading[0].start : m.loc.start;
      if (i > 0) {
        const prev = members[i - 1];
        if (this.blankLineBefore(first) || prev.type !== m.type || m.type === N.FunctionDeclaration) lines.push("");
      }
      for (const c of leading) lines.push(this.ind() + this.commentText(c, this.ind()));
      let text;
      if (m.type === N.FieldDeclaration) {
        text = `${m.constant ? "const" : "let"} ${m.name.name}${m.typeAnnotation ? ": " + this.type(m.typeAnnotation) : ""}${m.value ? " = " + this.expr(m.value) : ""}`;
      } else {
        text = `${m.async ? "async " : ""}func ${m.name.name}(${this.params(m.params)})${m.returnType ? " -> " + this.type(m.returnType) : ""} ${this.block(m.body)}`;
      }
      const trailing = this.trailingComment(m.loc.end);
      lines.push(this.ind() + text + (trailing ? " " + trailing.text.trim() : ""));
    });
    for (const c of this.pendingCommentsBefore(end)) lines.push(this.ind() + this.commentText(c, this.ind()));
    this.depth--;
    return `${head} {\n${lines.join("\n")}\n${this.ind()}}`;
  }

  params(params) {
    return params
      .map((p) => `${p.rest ? "..." : ""}${p.name.name}${p.typeAnnotation ? ": " + this.type(p.typeAnnotation) : ""}${p.defaultValue ? " = " + this.expr(p.defaultValue) : ""}`)
      .join(", ");
  }

  pattern(t) {
    if (t.type === N.Identifier) return t.name;
    if (t.type === N.ObjectPattern) return `{ ${t.properties.map((p) => (p.key === p.value.name ? p.key : `${p.key}: ${p.value.name}`)).join(", ")} }`;
    return `[${[...t.elements.map((e) => e.name), ...(t.rest ? ["..." + t.rest.name] : [])].join(", ")}]`;
  }

  type(t) {
    switch (t.type) {
      case N.TypeName:
        return t.name;
      case N.NullableType:
        return this.type(t.inner) + "?";
      case N.ArrayType:
        return `[${this.type(t.element)}]`;
      case N.UnionType:
        return t.types.map((x) => this.type(x)).join(" | ");
      default:
        return "any";
    }
  }

  // ---------------------------------------------------------- expressions

  expr(node) {
    const text = this.exprInner(node);
    return node.parenthesized ? `(${text})` : text;
  }

  exprInner(node) {
    switch (node.type) {
      case N.Identifier:
        return node.name;
      case N.NumberLiteral:
        return node.raw ?? String(node.value);
      case N.StringLiteral:
      case N.TemplateString:
        return node.raw;
      case N.BooleanLiteral:
        return String(node.value);
      case N.NullLiteral:
        return "null";
      case N.SelfExpression:
        return "self";
      case N.SuperMemberExpression:
        return `super.${node.property}`;
      case N.ArrayExpression:
        return this.list(node, node.elements, "[", "]", (e) => this.element(e), false);
      case N.ObjectExpression:
        return this.list(node, node.properties, "{", "}", (p) => this.property(p), true);
      case N.BinaryExpression:
        return `${this.operand(node.left, node.operator, "left")} ${node.operator} ${this.operand(node.right, node.operator, "right")}`;
      case N.LogicalExpression:
        return `${this.operand(node.left, node.operator, "left")} ${node.operator} ${this.operand(node.right, node.operator, "right")}`;
      case N.UnaryExpression:
        return node.operator === "not" ? `not ${this.operand(node.argument, "not", "right")}` : `-${this.operand(node.argument, "unary", "right")}`;
      case N.RangeExpression:
        return `${this.operand(node.start, "range", "left")}${node.inclusive ? ".." : "..<"}${this.operand(node.end, "range", "right")}`;
      case N.AwaitExpression:
        return `await ${this.operand(node.argument, "unary", "right")}`;
      case N.FunctionExpression:
        return this.functionExpression(node);
      case N.MemberExpression:
        return `${this.postfixObject(node.object)}${node.optional ? "?." : "."}${node.property}`;
      case N.IndexExpression:
        return `${this.postfixObject(node.object)}${node.optional ? "?." : ""}[${this.expr(node.index)}]`;
      case N.CallExpression:
        return `${this.postfixObject(node.callee)}${node.optional ? "?." : ""}(${node.args.map((a) => this.element(a)).join(", ")})`;
      case N.SpreadElement:
        return `...${this.expr(node.argument)}`;
      default:
        throw new Error(`formatter: unknown expression ${node.type}`);
    }
  }

  postfixObject(node) {
    return this.expr(node);
  }

  operand(node, parentOp, side) {
    // parentheses that the user wrote are kept by expr(); this adds them only if
    // required for correctness (e.g. after rewriting nested structures)
    const text = this.expr(node);
    if (node.parenthesized) return text;
    const prec = precedenceOf(node);
    const parent = PRECEDENCE[parentOp];
    if (prec !== null && parent !== undefined && (prec < parent || (prec === parent && side === "right" && parentOp !== "??" && node.type !== N.UnaryExpression))) {
      return `(${text})`;
    }
    return text;
  }

  element(e) {
    if (e.type === N.SpreadElement) return `...${this.expr(e.argument)}`;
    return this.expr(e);
  }

  property(p) {
    if (p.type === N.SpreadElement) return `...${this.expr(p.argument)}`;
    if (p.shorthand) return p.key;
    const key = p.quoted || !/^[A-Za-z_]\w*$/.test(p.key) ? JSON.stringify(p.key) : p.key;
    return `${key}: ${this.expr(p.value)}`;
  }

  list(node, items, open, close, printItem, spaced) {
    if (!items.length) {
      const inner = this.pendingCommentsBefore(node.loc.end - 1);
      if (!inner.length) return open + close;
      this.depth++;
      const lines = inner.map((c) => this.ind() + this.commentText(c, this.ind()));
      this.depth--;
      return `${open}\n${lines.join("\n")}\n${this.ind()}${close}`;
    }
    const multiline = node.loc.endLine > node.loc.line && this.itemsOnSeparateLines(node, items);
    if (!multiline) {
      const inline = items.map(printItem).join(", ");
      const text = spaced ? `${open} ${inline} ${close}` : `${open}${inline}${close}`;
      if (!text.includes("\n") && text.length <= MAX_INLINE) return text;
    }
    this.depth++;
    const lines = [];
    items.forEach((item, i) => {
      for (const c of this.pendingCommentsBefore(item.loc.start)) lines.push(this.ind() + this.commentText(c, this.ind()));
      const text = printItem(item) + (i < items.length - 1 ? "," : "");
      const trailing = this.trailingComment(item.loc.end);
      lines.push(this.ind() + text + (trailing ? " " + trailing.text.trim() : ""));
    });
    for (const c of this.pendingCommentsBefore(node.loc.end - 1)) lines.push(this.ind() + this.commentText(c, this.ind()));
    this.depth--;
    return `${open}\n${lines.join("\n")}\n${this.ind()}${close}`;
  }

  // Keep a list on multiple lines when the author put items on separate lines.
  itemsOnSeparateLines(node, items) {
    if (items[0].loc.line > node.loc.line) return true;
    for (let i = 1; i < items.length; i++) if (items[i].loc.line > items[i - 1].loc.endLine) return true;
    return false;
  }

  functionExpression(node) {
    const prefix = node.async ? "async " : "";
    if (node.arrow) {
      const simple = node.params.length === 1 && !node.params[0].typeAnnotation && !node.params[0].defaultValue && !node.params[0].rest;
      const params = simple ? node.params[0].name.name : `(${this.params(node.params)})`;
      const body = node.expression ? this.arrowBody(node.body) : this.block(node.body);
      return `${prefix}${params} => ${body}`;
    }
    return `${prefix}func${node.name ? " " + node.name.name : ""}(${this.params(node.params)})${node.returnType ? " -> " + this.type(node.returnType) : ""} ${this.block(node.body)}`;
  }

  arrowBody(body) {
    const text = this.expr(body);
    // an object literal body needs no parentheses in KIVO (braces after => are a block)
    return text;
  }
}

function precedenceOf(node) {
  switch (node.type) {
    case N.BinaryExpression:
    case N.LogicalExpression:
      return PRECEDENCE[node.operator];
    case N.UnaryExpression:
      return node.operator === "not" ? PRECEDENCE.not : PRECEDENCE.unary;
    case N.RangeExpression:
      return PRECEDENCE.range;
    case N.FunctionExpression:
      return 0;
    case N.AwaitExpression:
      return PRECEDENCE.unary;
    default:
      return null;
  }
}

// Structural fingerprint of a program, ignoring positions and formatting.
function fingerprint(program) {
  return JSON.stringify(program.body, (key, value) => {
    if (key === "loc" || key === "propertyLoc" || key === "keyLoc" || key === "sourceLoc" || key === "raw" || key === "parenthesized" || key === "quoted" || key === "triple") return undefined;
    return value;
  });
}

class FormatterError extends Error {}

function format(source, { file = null } = {}) {
  const program = parse(source, { file });
  const comments = program.comments || [];
  const printer = new Printer(source, comments);
  const lines = printer.statementList(program.body, source.length + 1);
  // leftover comments (should not happen, but never lose them)
  for (const c of printer.comments.slice(printer.nextComment)) lines.push(c.text);
  let out = lines.join("\n").replace(/[ \t]+$/gm, "");
  out = out.replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "");
  if (out.length) out += "\n";

  // Safety net: the formatted program must be identical to the original.
  let reparsed;
  try {
    reparsed = parse(out, { file });
  } catch (err) {
    throw new FormatterError(`The formatter produced invalid code (this is a bug in KIVO): ${err.message}`);
  }
  if (fingerprint(reparsed) !== fingerprint(program)) {
    throw new FormatterError("The formatter would change the meaning of this file (this is a bug in KIVO). The file was left unchanged.");
  }
  if ((reparsed.comments || []).length !== comments.length) {
    throw new FormatterError("The formatter would lose a comment (this is a bug in KIVO). The file was left unchanged.");
  }
  return out;
}

module.exports = { format, FormatterError, fingerprint };
