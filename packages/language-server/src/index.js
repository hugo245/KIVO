"use strict";

// A Language Server Protocol server for KIVO, speaking JSON-RPC over stdio.
// Start it with `kivo lsp`. All intelligence comes from @kivo/language-service.

const { fileURLToPath } = require("url");
const ls = require("../../language-service/src");

const COMPLETION_KIND = { method: 2, function: 3, field: 5, variable: 6, class: 7, module: 9, property: 10, keyword: 14, snippet: 15, constant: 21, type: 25 };
const SYMBOL_KIND = { class: 5, method: 6, field: 8, constructor: 9, function: 12, variable: 13, constant: 14, struct: 23 };

class Document {
  constructor(uri, text, version) {
    this.uri = uri;
    this.version = version;
    this.setText(text);
  }
  setText(text) {
    this.text = text;
    this.lineStarts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === "\n") this.lineStarts.push(i + 1);
  }
  get file() {
    try {
      return this.uri.startsWith("file:") ? fileURLToPath(this.uri) : null;
    } catch {
      return null;
    }
  }
  // LSP positions count UTF-16 code units, like JavaScript strings.
  offsetAt({ line, character }) {
    if (line >= this.lineStarts.length) return this.text.length;
    return Math.min(this.lineStarts[line] + character, this.text.length);
  }
  positionAt(offset) {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo, character: offset - this.lineStarts[lo] };
  }
  range(start, end) {
    return { start: this.positionAt(start), end: this.positionAt(end) };
  }
}

class Server {
  constructor(input, output) {
    this.input = input;
    this.output = output;
    this.documents = new Map();
    this.timers = new Map();
    this.buffer = Buffer.alloc(0);
    this.shuttingDown = false;
  }

  start() {
    this.input.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
  }

  drain() {
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buffer.slice(0, headerEnd).toString("ascii");
      const m = /Content-Length: (\d+)/i.exec(header);
      if (!m) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }
      const length = Number(m[1]);
      if (this.buffer.length < headerEnd + 4 + length) return;
      const body = this.buffer.slice(headerEnd + 4, headerEnd + 4 + length).toString("utf8");
      this.buffer = this.buffer.slice(headerEnd + 4 + length);
      let message;
      try {
        message = JSON.parse(body);
      } catch {
        continue;
      }
      this.handle(message);
    }
  }

  send(message) {
    const body = JSON.stringify({ jsonrpc: "2.0", ...message });
    this.output.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
  }

  handle(msg) {
    const { id, method, params } = msg;
    if (method === undefined) return; // a response to something we sent
    const handler = this.methods[method];
    if (!handler) {
      if (id !== undefined) this.send({ id, error: { code: -32601, message: `Unhandled method ${method}` } });
      return;
    }
    let result;
    try {
      result = handler.call(this, params || {});
    } catch (err) {
      if (id !== undefined) this.send({ id, error: { code: -32603, message: String(err && err.message) } });
      return;
    }
    if (id !== undefined) this.send({ id, result: result === undefined ? null : result });
  }

  doc(params) {
    return this.documents.get(params.textDocument.uri);
  }

  publishDiagnostics(doc) {
    let list = [];
    try {
      list = ls.diagnostics(doc.text, doc.file);
    } catch {
      list = [];
    }
    this.send({
      method: "textDocument/publishDiagnostics",
      params: {
        uri: doc.uri,
        version: doc.version,
        diagnostics: list.map((d) => ({
          range: doc.range(d.start, d.end),
          severity: d.severity === "warning" ? 2 : 1,
          source: "kivo",
          message: d.hint ? `${d.message}\n\n${d.hint}` : d.message,
        })),
      },
    });
  }

  scheduleDiagnostics(doc) {
    clearTimeout(this.timers.get(doc.uri));
    this.timers.set(doc.uri, setTimeout(() => this.publishDiagnostics(doc), 150));
  }
}

Server.prototype.methods = {
  initialize() {
    return {
      capabilities: {
        textDocumentSync: { openClose: true, change: 1, save: { includeText: false } },
        completionProvider: { triggerCharacters: [".", '"'] },
        hoverProvider: true,
        definitionProvider: true,
        signatureHelpProvider: { triggerCharacters: ["(", ","] },
        documentFormattingProvider: true,
        documentSymbolProvider: true,
        foldingRangeProvider: true,
      },
      serverInfo: { name: "kivo", version: "0.1.0" },
    };
  },
  initialized() {},
  shutdown() {
    this.shuttingDown = true;
    return null;
  },
  exit() {
    process.exit(this.shuttingDown ? 0 : 1);
  },
  "$/cancelRequest"() {},
  "textDocument/didOpen"({ textDocument }) {
    const doc = new Document(textDocument.uri, textDocument.text, textDocument.version);
    this.documents.set(doc.uri, doc);
    this.publishDiagnostics(doc);
  },
  "textDocument/didChange"({ textDocument, contentChanges }) {
    const doc = this.documents.get(textDocument.uri);
    if (!doc || !contentChanges.length) return;
    doc.version = textDocument.version;
    doc.setText(contentChanges[contentChanges.length - 1].text);
    this.scheduleDiagnostics(doc);
  },
  "textDocument/didSave"() {
    for (const doc of this.documents.values()) this.scheduleDiagnostics(doc);
  },
  "textDocument/didClose"({ textDocument }) {
    this.documents.delete(textDocument.uri);
    this.send({ method: "textDocument/publishDiagnostics", params: { uri: textDocument.uri, diagnostics: [] } });
  },
  "textDocument/completion"(params) {
    const doc = this.doc(params);
    if (!doc) return [];
    const items = ls.completions(doc.text, doc.offsetAt(params.position), doc.file);
    const importLine = ls.importInsertLine(doc.text);
    return items.map((item) => {
      const out = { label: item.label, kind: COMPLETION_KIND[item.kind] || 1 };
      if (item.detail) out.detail = item.detail;
      if (item.documentation) out.documentation = { kind: "markdown", value: item.documentation };
      if (item.sortText) out.sortText = item.sortText;
      if (item.snippet) {
        out.insertText = item.snippet;
        out.insertTextFormat = 2;
        out.kind = COMPLETION_KIND.snippet;
      }
      if (item.autoImport) {
        out.additionalTextEdits = [{ range: { start: { line: importLine, character: 0 }, end: { line: importLine, character: 0 } }, newText: item.autoImport + "\n" }];
      }
      return out;
    });
  },
  "textDocument/hover"(params) {
    const doc = this.doc(params);
    if (!doc) return null;
    const h = ls.hover(doc.text, doc.offsetAt(params.position), doc.file);
    if (!h) return null;
    return { contents: { kind: "markdown", value: h.contents }, range: doc.range(h.start, h.end) };
  },
  "textDocument/definition"(params) {
    const doc = this.doc(params);
    if (!doc) return null;
    const d = ls.definition(doc.text, doc.offsetAt(params.position), doc.file);
    if (!d) return null;
    const uri = d.file && d.file !== doc.file ? require("url").pathToFileURL(d.file).href : doc.uri;
    const pos = { line: Math.max(0, d.line - 1), character: Math.max(0, d.column - 1) };
    return { uri, range: { start: pos, end: pos } };
  },
  "textDocument/signatureHelp"(params) {
    const doc = this.doc(params);
    if (!doc) return null;
    const s = ls.signatureHelp(doc.text, doc.offsetAt(params.position), doc.file);
    if (!s) return null;
    return {
      signatures: [{ label: s.label, documentation: s.documentation ? { kind: "markdown", value: s.documentation } : undefined, parameters: s.parameters.map((p) => ({ label: p })) }],
      activeSignature: 0,
      activeParameter: s.activeParameter,
    };
  },
  "textDocument/formatting"(params) {
    const doc = this.doc(params);
    if (!doc) return [];
    let formatted;
    try {
      formatted = ls.format(doc.text, doc.file);
    } catch {
      return [];
    }
    if (formatted === doc.text) return [];
    return [{ range: doc.range(0, doc.text.length), newText: formatted }];
  },
  "textDocument/documentSymbol"(params) {
    const doc = this.doc(params);
    if (!doc) return [];
    const convert = (s) => ({
      name: s.name,
      detail: s.detail || "",
      kind: SYMBOL_KIND[s.kind] || 13,
      range: doc.range(s.start, s.end),
      selectionRange: doc.range(s.selectionStart, s.selectionEnd),
      children: (s.children || []).map(convert),
    });
    return ls.documentSymbols(doc.text, doc.file).map(convert);
  },
  "textDocument/foldingRange"(params) {
    const doc = this.doc(params);
    if (!doc) return [];
    return ls
      .foldingRanges(doc.text)
      .filter((r) => r.endLine > r.startLine)
      .map((r) => ({ startLine: r.startLine, endLine: r.endLine, ...(r.kind ? { kind: r.kind } : {}) }));
  },
};

function startServer(input = process.stdin, output = process.stdout) {
  const server = new Server(input, output);
  server.start();
  return server;
}

module.exports = { startServer, Server, Document };
