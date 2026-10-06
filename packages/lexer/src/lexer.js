"use strict";

const { TokenType, KEYWORDS, PUNCTUATION, FOREIGN_OPERATORS } = require("./tokens");
const { Diagnostic, KivoCompileError } = require("../../diagnostics/src");

const T = TokenType;

function isDigit(ch) {
  return ch >= "0" && ch <= "9";
}
function isIdentStart(ch) {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || (ch > "\x7f" && /\p{L}/u.test(ch));
}
function isIdentPart(ch) {
  return isIdentStart(ch) || isDigit(ch) || (ch > "\x7f" && /[\p{L}\p{N}]/u.test(ch));
}

const OPENERS = { "(": ")", "[": "]", "{": "}" };

class Lexer {
  constructor(source, file = null) {
    this.source = source.replace(/^\uFEFF/, "");
    this.file = file;
    this.pos = 0;
    this.line = 1;
    this.lineStart = 0;
    this.tokens = [];
    this.comments = [];
    // Stack of open brackets. Newlines are only significant at the top level
    // and directly inside { } blocks — inside ( ) and [ ] they are ignored,
    // so long argument lists and arrays can span lines freely.
    this.brackets = [];
    this.pendingNewline = false;
  }

  error(message, start, length = 1, hint = null) {
    const { line, column } = this.positionOf(start);
    return new KivoCompileError(new Diagnostic({ kind: "syntax", message, file: this.file, line, column, length, hint }));
  }

  positionOf(offset) {
    if (!this.lineStarts) {
      this.lineStarts = [0];
      for (let i = 0; i < this.source.length; i++) if (this.source[i] === "\n") this.lineStarts.push(i + 1);
    }
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - this.lineStarts[lo] + 1 };
  }

  peek(offset = 0) {
    return this.source[this.pos + offset] ?? "";
  }

  newlinesSignificant() {
    const top = this.brackets[this.brackets.length - 1];
    return top === undefined || top === "{";
  }

  make(type, value, start, extra) {
    const tok = {
      type,
      value,
      start,
      end: this.pos,
      line: this.tokenLine,
      column: start - this.tokenLineStart + 1,
      newlineBefore: this.pendingNewline,
    };
    if (extra) Object.assign(tok, extra);
    this.pendingNewline = false;
    return tok;
  }

  push(tok) {
    this.tokens.push(tok);
    return tok;
  }

  tokenize() {
    while (true) {
      const tok = this.next();
      if (tok.type === T.EOF) {
        if (this.brackets.length) {
          const open = this.openStack[this.openStack.length - 1];
          throw this.error(`This "${open.ch}" is never closed.`, open.pos, 1, `Add a matching "${OPENERS[open.ch]}".`);
        }
        this.push(tok);
        return this.tokens;
      }
      this.push(tok);
    }
  }

  // Skips whitespace and comments. Emits a NEWLINE token when appropriate.
  skipTrivia() {
    while (this.pos < this.source.length) {
      const ch = this.peek();
      if (ch === " " || ch === "\t" || ch === "\r") {
        this.pos++;
      } else if (ch === "\n") {
        this.pos++;
        this.line++;
        this.lineStart = this.pos;
        if (this.newlinesSignificant()) this.sawNewline = true;
        this.pendingNewline = true;
      } else if (ch === "/" && this.peek(1) === "/") {
        const start = this.pos;
        while (this.pos < this.source.length && this.peek() !== "\n") this.pos++;
        this.comments.push(this.commentAt(start, "line"));
      } else if (ch === "/" && this.peek(1) === "*") {
        const start = this.pos;
        this.pos += 2;
        let depth = 1;
        while (this.pos < this.source.length && depth > 0) {
          if (this.peek() === "/" && this.peek(1) === "*") {
            depth++;
            this.pos += 2;
          } else if (this.peek() === "*" && this.peek(1) === "/") {
            depth--;
            this.pos += 2;
          } else {
            if (this.peek() === "\n") {
              this.line++;
              this.lineStart = this.pos + 1;
              if (this.newlinesSignificant()) this.sawNewline = true;
              this.pendingNewline = true;
            }
            this.pos++;
          }
        }
        if (depth > 0) throw this.error("This comment is never closed.", start, 2, 'Close it with "*/".');
        this.comments.push(this.commentAt(start, "block"));
      } else {
        break;
      }
    }
  }

  commentAt(start, kind) {
    const pos = this.positionOf(start);
    return { kind, text: this.source.slice(start, this.pos), start, end: this.pos, line: pos.line, column: pos.column };
  }

  next() {
    this.openStack = this.openStack || [];
    this.sawNewline = false;
    this.skipTrivia();
    if (this.sawNewline) {
      const last = this.tokens[this.tokens.length - 1];
      if (last && last.type !== T.NEWLINE && last.type !== T.LEFT_BRACE && last.type !== T.SEMICOLON) {
        const pos = this.positionOf(last.end);
        const tok = { type: T.NEWLINE, value: "\n", start: last.end, end: last.end, line: pos.line, column: pos.column, newlineBefore: false };
        this.pendingNewline = true;
        return tok;
      }
    }

    this.tokenLine = this.line;
    this.tokenLineStart = this.lineStart;
    const start = this.pos;
    if (this.pos >= this.source.length) return this.make(T.EOF, "", start);

    const ch = this.peek();

    if (isDigit(ch)) return this.number();
    if (isIdentStart(ch)) return this.identifier();
    if (ch === '"') return this.string();
    if (ch === "'") {
      throw this.error("KIVO strings use double quotes.", start, 1, 'Write "text" instead of \'text\'.');
    }
    if (ch === "`") {
      throw this.error("KIVO strings use double quotes.", start, 1, 'Interpolation works in every string:\n\n    "Hello {name}"\n\nFor text spanning several lines use triple quotes: """ ... """');
    }

    if (ch === "-" && this.peek(1) === "-" && this.isLineStart(start)) {
      throw this.error("KIVO comments start with \"//\".", start, 2, "    // this is a comment\n\n    /* this is a\n       block comment */");
    }
    for (const [op, hint] of FOREIGN_OPERATORS) {
      if (this.source.startsWith(op, this.pos)) {
        if (op === "!" && this.peek(1) === "=") continue;
        if (op === "&" && this.peek(1) === "&") continue;
        throw this.error(`"${op}" is not a KIVO operator.`, start, op.length, hint);
      }
    }

    for (const [text, type] of PUNCTUATION) {
      if (this.source.startsWith(text, this.pos)) {
        this.pos += text.length;
        this.trackBracket(text, start);
        return this.make(type, text, start);
      }
    }

    throw this.error(`Unexpected character "${ch}".`, start, 1);
  }

  isLineStart(offset) {
    for (let i = offset - 1; i >= 0; i--) {
      const c = this.source[i];
      if (c === "\n") return true;
      if (c !== " " && c !== "\t") return false;
    }
    return true;
  }

  trackBracket(text, start) {
    if (OPENERS[text]) {
      this.brackets.push(text);
      this.openStack.push({ ch: text, pos: start });
    } else if (text === ")" || text === "]" || text === "}") {
      const top = this.brackets[this.brackets.length - 1];
      if (top === undefined) {
        throw this.error(`Unexpected "${text}" — there is nothing to close here.`, start, 1);
      }
      if (OPENERS[top] !== text) {
        const open = this.openStack[this.openStack.length - 1];
        const { line } = this.positionOf(open.pos);
        throw this.error(`Expected "${OPENERS[top]}" to close the "${top}" on line ${line}, but found "${text}".`, start, 1);
      }
      this.brackets.pop();
      this.openStack.pop();
    }
  }

  number() {
    const start = this.pos;
    let text;
    if (this.peek() === "0" && /[xXbBoO]/.test(this.peek(1))) {
      const kind = this.peek(1).toLowerCase();
      this.pos += 2;
      const re = kind === "x" ? /[0-9a-fA-F_]/ : kind === "b" ? /[01_]/ : /[0-7_]/;
      while (re.test(this.peek())) this.pos++;
      text = this.source.slice(start, this.pos);
      const digits = text.slice(2).replace(/_/g, "");
      if (!digits) throw this.error(`Invalid number "${text}".`, start, text.length);
      const value = parseInt(digits, kind === "x" ? 16 : kind === "b" ? 2 : 8);
      this.checkNumberEnd(start);
      return this.make(T.NUMBER, value, start, { raw: text });
    }
    while (isDigit(this.peek()) || (this.peek() === "_" && isDigit(this.peek(1)))) this.pos++;
    if (this.peek() === "." && isDigit(this.peek(1))) {
      this.pos++;
      while (isDigit(this.peek()) || (this.peek() === "_" && isDigit(this.peek(1)))) this.pos++;
    }
    if (/[eE]/.test(this.peek()) && (isDigit(this.peek(1)) || (/[+-]/.test(this.peek(1)) && isDigit(this.peek(2))))) {
      this.pos += 2;
      while (isDigit(this.peek())) this.pos++;
    }
    this.checkNumberEnd(start);
    text = this.source.slice(start, this.pos);
    return this.make(T.NUMBER, Number(text.replace(/_/g, "")), start, { raw: text });
  }

  checkNumberEnd(start) {
    if (isIdentStart(this.peek())) {
      let end = this.pos;
      while (isIdentPart(this.source[end] ?? "")) end++;
      throw this.error(`Invalid number "${this.source.slice(start, end)}".`, start, end - start, "Names cannot start with a digit.");
    }
  }

  identifier() {
    const start = this.pos;
    while (this.pos < this.source.length && isIdentPart(this.peek())) this.pos++;
    const text = this.source.slice(start, this.pos);
    const kw = Object.prototype.hasOwnProperty.call(KEYWORDS, text) ? KEYWORDS[text] : null;
    if (kw === T.TRUE) return this.make(kw, true, start);
    if (kw === T.FALSE) return this.make(kw, false, start);
    if (kw === T.NULL) return this.make(kw, null, start);
    if (kw) return this.make(kw, text, start);
    return this.make(T.IDENTIFIER, text, start);
  }

  // Strings: "text {expr} text". Triple quoted strings may span lines.
  // The token carries `parts`: text segments and already-lexed expression tokens.
  string() {
    const start = this.pos;
    const triple = this.source.startsWith('"""', this.pos);
    this.pos += triple ? 3 : 1;
    const parts = [];
    let text = "";
    const startLine = this.tokenLine;
    const startLineStart = this.tokenLineStart;

    while (true) {
      if (this.pos >= this.source.length) {
        throw this.error("This string is never closed.", start, triple ? 3 : 1, triple ? 'Close it with """.' : 'Add a closing " at the end of the text.');
      }
      const ch = this.peek();
      if (triple && this.source.startsWith('"""', this.pos)) {
        this.pos += 3;
        break;
      }
      if (!triple && ch === '"') {
        this.pos++;
        break;
      }
      if (ch === "\n") {
        if (!triple) {
          throw this.error("This string is never closed.", start, 1, 'Strings must end on the same line. Add a closing ", or use """ for text spanning several lines.');
        }
        text += "\n";
        this.pos++;
        this.line++;
        this.lineStart = this.pos;
        continue;
      }
      if (ch === "\\") {
        text += this.escape();
        continue;
      }
      if (ch === "{") {
        if (text) parts.push({ kind: "text", value: text });
        text = "";
        parts.push(this.interpolation());
        continue;
      }
      text += ch;
      this.pos++;
    }
    if (text || parts.length === 0) parts.push({ kind: "text", value: text });

    if (triple) dedentParts(parts);

    this.tokenLine = startLine;
    this.tokenLineStart = startLineStart;
    const value = parts.every((p) => p.kind === "text") ? parts.map((p) => p.value).join("") : null;
    return this.make(T.STRING, value, start, { parts, raw: this.source.slice(start, this.pos), triple });
  }

  escape() {
    const start = this.pos;
    const next = this.peek(1);
    this.pos += 2;
    switch (next) {
      case "n": return "\n";
      case "t": return "\t";
      case "r": return "\r";
      case "0": return "\0";
      case "\\": return "\\";
      case '"': return '"';
      case "{": return "{";
      case "}": return "}";
      case "u": {
        if (this.peek() === "{") {
          const close = this.source.indexOf("}", this.pos);
          const hex = close > 0 ? this.source.slice(this.pos + 1, close) : "";
          if (!/^[0-9a-fA-F]{1,6}$/.test(hex)) throw this.error("Invalid unicode escape.", start, 2, 'Use \\u{1F600} with 1–6 hex digits.');
          this.pos = close + 1;
          return String.fromCodePoint(parseInt(hex, 16));
        }
        const hex = this.source.slice(this.pos, this.pos + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw this.error("Invalid unicode escape.", start, 2, 'Use \\u00e9 (4 hex digits) or \\u{1F600}.');
        this.pos += 4;
        return String.fromCharCode(parseInt(hex, 16));
      }
      default:
        throw this.error(`Unknown escape "\\${next}".`, start, 2, 'Valid escapes: \\n \\t \\r \\0 \\\\ \\" \\{ \\} \\u{...}\nTo write a backslash, use "\\\\".');
    }
  }

  // Lexes the tokens of `{ expr }` inside a string, sharing this lexer's state
  // so every token keeps its exact source position.
  interpolation() {
    const open = this.pos;
    this.pos++; // {
    const savedBrackets = this.brackets;
    const savedOpen = this.openStack;
    const savedTokens = this.tokens;
    this.brackets = ["("]; // newlines are not significant inside interpolation
    this.openStack = [{ ch: "(", pos: open }];
    this.tokens = [];
    let depth = 0;
    while (true) {
      this.skipTriviaInline(open);
      if (this.pos >= this.source.length || this.peek() === "\n") {
        throw this.error("This interpolation is never closed.", open, 1, 'Add a "}" — or write \\{ to put a literal brace in the text.');
      }
      if (this.peek() === "}" && depth === 0) {
        this.pos++;
        break;
      }
      if (this.peek() === "{") depth++;
      if (this.peek() === "}") depth--;
      let tok;
      try {
        tok = this.next();
      } catch (err) {
        if (err.diagnostics && !err.diagnostics[0].hint) {
          err.diagnostics[0].hint = 'This is inside "{...}" in a string, which holds an expression.\nTo write a literal brace in text, escape it: \\{';
        }
        throw err;
      }
      this.tokens.push(tok);
    }
    const tokens = this.tokens;
    this.brackets = savedBrackets;
    this.openStack = savedOpen;
    this.tokens = savedTokens;
    if (tokens.length === 0) {
      throw this.error("Empty interpolation \"{}\".", open, 2, 'Put an expression inside, like "{name}", or write \\{ for a literal brace.');
    }
    // Tokens inside a `{ }` that belongs to the expression (object literals) must not be
    // tracked as a bracket of the outer program.
    const pos = this.positionOf(open);
    return { kind: "expr", tokens, start: open, end: this.pos, line: pos.line, column: pos.column };
  }

  skipTriviaInline() {
    while (this.peek() === " " || this.peek() === "\t") this.pos++;
  }
}

// Removes common leading indentation from triple quoted strings and drops the
// first and last line if they are blank. Lets multi-line text be indented with the code.
function dedentParts(parts) {
  const full = parts.map((p) => (p.kind === "text" ? p.value : "\u0000")).join("");
  const lines = full.split("\n");
  let minIndent = Infinity;
  lines.forEach((line, i) => {
    if (i === 0 || line.trim() === "") return;
    const indent = line.match(/^[ \t]*/)[0].length;
    minIndent = Math.min(minIndent, indent);
  });
  if (minIndent === Infinity) minIndent = 0;
  const indentRe = new RegExp("\\n[ \\t]{0," + minIndent + "}", "g");
  for (const p of parts) {
    if (p.kind === "text") p.value = p.value.replace(indentRe, "\n");
  }
  const first = parts[0];
  if (first && first.kind === "text") first.value = first.value.replace(/^[ \t]*\n/, "");
  const last = parts[parts.length - 1];
  if (last && last.kind === "text") last.value = last.value.replace(/\n[ \t]*$/, "");
}

function tokenize(source, file = null) {
  const lexer = new Lexer(source, file);
  const tokens = lexer.tokenize();
  return { tokens, comments: lexer.comments };
}

module.exports = { Lexer, tokenize };
