"use strict";

// Shared diagnostic model used by every stage of the toolchain
// (lexer, parser, checker, runtime, formatter, editor tooling).

const KIND_TITLES = {
  syntax: "Syntax Error",
  name: "Name Error",
  type: "Type Error",
  runtime: "KIVO Error",
  import: "Import Error",
  thrown: "Uncaught Error",
};

class Diagnostic {
  constructor({ severity = "error", kind = "runtime", message, file = null, line = 0, column = 0, length = 1, hint = null, code = null, context = null }) {
    this.severity = severity;
    this.kind = kind;
    this.message = message;
    this.file = file;
    this.line = line;
    this.column = column;
    this.length = Math.max(1, length || 1);
    this.hint = hint;
    this.code = code;
    this.context = context; // e.g. "in func greet"
  }
}

// An error raised while compiling (lexing / parsing / checking).
class KivoCompileError extends Error {
  constructor(diagnostics) {
    const list = Array.isArray(diagnostics) ? diagnostics : [diagnostics];
    super(list[0] ? list[0].message : "compile error");
    this.name = "KivoCompileError";
    this.diagnostics = list;
  }
}

function syntaxError(message, token, hint, file) {
  return new KivoCompileError(
    new Diagnostic({
      kind: "syntax",
      message,
      file,
      line: token.line,
      column: token.column,
      length: token.end - token.start,
      hint,
    })
  );
}

const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  gray: "\x1b[90m",
};

function useColor(stream) {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(stream && stream.isTTY);
}

function painter(enabled) {
  const p = {};
  for (const [name, code] of Object.entries(ansi)) {
    p[name] = (s) => (enabled ? code + s + ansi.reset : String(s));
  }
  return p;
}

function displayPath(file) {
  if (!file) return "<input>";
  const path = require("path");
  const rel = path.relative(process.cwd(), file);
  return rel && !rel.startsWith("..") ? rel : file;
}

// Render a diagnostic the way KIVO shows it in the terminal.
function formatDiagnostic(diag, source, options = {}) {
  const c = painter(options.color ?? false);
  const out = [];
  const isWarning = diag.severity === "warning";
  const title = isWarning ? "KIVO Warning" : KIND_TITLES[diag.kind] || "KIVO Error";
  out.push((isWarning ? c.yellow : c.red)(c.bold(title)));
  out.push("");

  if (diag.line > 0) {
    let where = `${displayPath(diag.file)}:${diag.line}:${diag.column}`;
    if (diag.context) where += c.gray(`  (${diag.context})`);
    out.push(c.cyan(where));
    out.push("");
    if (source != null) {
      const lines = source.split(/\r?\n/);
      const text = lines[diag.line - 1];
      if (text !== undefined) {
        const gutter = String(diag.line).length + 1;
        const pad = (n) => " ".repeat(gutter - String(n).length);
        const prev = lines[diag.line - 2];
        if (prev !== undefined && prev.trim() !== "") {
          out.push(c.gray(`${pad(diag.line - 1)}${diag.line - 1} | `) + c.dim(prev.replace(/\t/g, "    ")));
        }
        out.push(c.gray(`${pad(diag.line)}${diag.line} | `) + text.replace(/\t/g, "    "));
        const before = text.slice(0, diag.column - 1).replace(/\t/g, "    ");
        const maxLen = Math.max(1, Math.min(diag.length, text.length - (diag.column - 1)));
        out.push(c.gray(`${" ".repeat(gutter)} | `) + " ".repeat(before.length) + (isWarning ? c.yellow : c.red)("^".repeat(maxLen)));
        out.push("");
      }
    }
  } else if (diag.file) {
    out.push(c.cyan(displayPath(diag.file)));
    out.push("");
  }

  out.push(c.bold(diag.message));
  if (diag.hint) {
    out.push("");
    out.push(String(diag.hint));
  }
  return out.join("\n");
}

// Levenshtein distance, used for "did you mean" suggestions.
function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        cur[j] = Math.min(cur[j], prev[j - 1]); // transposition
      }
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

function suggest(name, candidates) {
  let best = null;
  let bestScore = Infinity;
  const lower = name.toLowerCase();
  for (const cand of candidates) {
    if (cand === name) continue;
    const d = cand.toLowerCase() === lower ? 0.5 : editDistance(lower, cand.toLowerCase());
    const limit = name.length <= 3 ? 1 : name.length <= 6 ? 2 : 3;
    if (d <= limit && d < bestScore) {
      best = cand;
      bestScore = d;
    }
  }
  return best;
}

module.exports = { Diagnostic, KivoCompileError, syntaxError, formatDiagnostic, painter, useColor, editDistance, suggest, displayPath };
