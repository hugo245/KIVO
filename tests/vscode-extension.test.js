"use strict";

// Validates the VS Code extension manifest and runs extension.js against a
// small mock of the vscode API to exercise every provider.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const EXT = path.join(__dirname, "..", "packages", "vscode-kivo");
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, "package.json"), "utf8"));

test("manifest registers .kivo exclusively as the KIVO language", () => {
  const langs = manifest.contributes.languages;
  assert.equal(langs.length, 1);
  assert.equal(langs[0].id, "kivo");
  assert.deepEqual(langs[0].aliases, ["KIVO", "kivo"]);
  assert.deepEqual(langs[0].extensions, [".kivo"]);
  for (const p of [langs[0].configuration, langs[0].icon.light, langs[0].icon.dark, manifest.icon, manifest.main]) {
    assert.ok(fs.existsSync(path.join(EXT, p)), p);
  }
  const grammar = manifest.contributes.grammars[0];
  assert.equal(grammar.language, "kivo");
  assert.equal(grammar.scopeName, "source.kivo");
  assert.equal(manifest.contributes.configurationDefaults["[kivo]"]["editor.defaultFormatter"], `${manifest.publisher}.${manifest.name}`);
});

test("grammar and configuration files are valid", () => {
  const grammar = JSON.parse(fs.readFileSync(path.join(EXT, "syntaxes", "kivo.tmLanguage.json"), "utf8"));
  assert.equal(grammar.scopeName, "source.kivo");
  // every include points at an existing repository rule
  const includes = JSON.stringify(grammar).match(/"include":"#[^"]+"/g).map((s) => s.slice(12, -1));
  for (const name of includes) assert.ok(grammar.repository[name], `missing rule ${name}`);
  // the generated JSON matches its source
  assert.deepEqual(grammar, JSON.parse(JSON.stringify(require(path.join(EXT, "syntaxes", "grammar.js")))));
  const config = JSON.parse(fs.readFileSync(path.join(EXT, "language-configuration.json"), "utf8"));
  assert.equal(config.comments.lineComment, "//");
  assert.deepEqual(config.comments.blockComment, ["/*", "*/"]);
  new RegExp(config.indentationRules.increaseIndentPattern);
  assert.ok(new RegExp(config.indentationRules.increaseIndentPattern).test("func main() {"));
  assert.ok(new RegExp(config.indentationRules.decreaseIndentPattern).test("    }"));
  JSON.parse(fs.readFileSync(path.join(EXT, "snippets", "kivo.json"), "utf8"));
});

function mockVscode() {
  const registered = {};
  class Position {
    constructor(line, character) {
      this.line = line;
      this.character = character;
    }
  }
  class Range {
    constructor(start, end) {
      this.start = start;
      this.end = end;
    }
  }
  const simple = (name) =>
    class {
      constructor(...args) {
        this.args = args;
        this.kind = name;
      }
    };
  const collection = { items: new Map(), set(uri, d) { this.items.set(String(uri), d); }, delete(uri) { this.items.delete(String(uri)); }, dispose() {} };
  const register = (kind) => (selector, provider) => {
    registered[kind] = provider;
    return { dispose() {} };
  };
  return {
    registered,
    collection,
    api: {
      Position,
      Range,
      Diagnostic: class {
        constructor(range, message, severity) {
          Object.assign(this, { range, message, severity });
        }
      },
      DiagnosticSeverity: { Error: 0, Warning: 1 },
      CompletionItem: class {
        constructor(label, kind) {
          Object.assign(this, { label, kind });
        }
      },
      CompletionItemKind: new Proxy({}, { get: (_, k) => String(k) }),
      SymbolKind: new Proxy({}, { get: (_, k) => String(k) }),
      FoldingRangeKind: { Comment: "comment", Region: "region" },
      MarkdownString: class {
        constructor(value) {
          this.value = value;
        }
      },
      SnippetString: simple("snippet"),
      Hover: simple("hover"),
      Location: simple("location"),
      SignatureHelp: class {},
      SignatureInformation: class {
        constructor(label) {
          this.label = label;
        }
      },
      ParameterInformation: simple("param"),
      DocumentSymbol: class {
        constructor(name) {
          this.name = name;
        }
      },
      FoldingRange: class {
        constructor(start, end) {
          Object.assign(this, { start, end });
        }
      },
      TextEdit: { replace: (range, text) => ({ range, text }), insert: (pos, text) => ({ pos, text }) },
      Uri: { file: (p) => ({ fsPath: p, scheme: "file", toString: () => "file://" + p }) },
      languages: {
        createDiagnosticCollection: () => collection,
        registerCompletionItemProvider: register("completion"),
        registerHoverProvider: register("hover"),
        registerDefinitionProvider: register("definition"),
        registerSignatureHelpProvider: register("signature"),
        registerDocumentSymbolProvider: register("symbols"),
        registerFoldingRangeProvider: register("folding"),
        registerDocumentFormattingEditProvider: register("format"),
      },
      workspace: {
        textDocuments: [],
        getConfiguration: () => ({ get: (k, d) => d }),
        onDidOpenTextDocument: () => ({ dispose() {} }),
        onDidChangeTextDocument: () => ({ dispose() {} }),
        onDidSaveTextDocument: () => ({ dispose() {} }),
        onDidCloseTextDocument: () => ({ dispose() {} }),
        onDidChangeConfiguration: () => ({ dispose() {} }),
      },
      window: { activeTextEditor: null, setStatusBarMessage() {}, showWarningMessage() {}, createTerminal: () => ({ show() {}, sendText() {} }) },
      commands: { registerCommand: (name) => ({ name, dispose() {} }) },
    },
  };
}

function mockDocument(text, file = "/tmp/main.kivo") {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return {
    languageId: "kivo",
    uri: { scheme: "file", fsPath: file, toString: () => "file://" + file },
    getText: () => text,
    lineCount: starts.length,
    lineAt: (i) => ({ text: text.slice(starts[i], (starts[i + 1] ?? text.length + 1) - 1) }),
    offsetAt: (pos) => starts[pos.line] + pos.character,
    positionAt: (offset) => {
      let line = 0;
      while (line + 1 < starts.length && starts[line + 1] <= offset) line++;
      return { line, character: offset - starts[line] };
    },
  };
}

test("extension activates and every provider works", () => {
  const mock = mockVscode();
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    if (request === "vscode") return mock.api;
    return originalLoad.call(this, request, ...rest);
  };
  let ext;
  try {
    delete require.cache[require.resolve(path.join(EXT, "extension.js"))];
    ext = require(path.join(EXT, "extension.js"));
  } finally {
    Module._load = originalLoad;
  }
  const subscriptions = [];
  ext.activate({ subscriptions });
  for (const kind of ["completion", "hover", "definition", "signature", "symbols", "folding", "format"]) assert.ok(mock.registered[kind], kind);

  const src = 'let user = { name: "Hugo" }\n// Greets someone.\nfunc greet(name) {\n    print("Hello {name}")\n}\ngreet(user.name)\n';
  const doc = mockDocument(src);
  const pos = (offset) => doc.positionAt(offset);

  const completions = mock.registered.completion.provideCompletionItems(doc, pos(src.indexOf("user.name") + 5));
  assert.ok(completions.some((c) => c.label === "name"));

  const hover = mock.registered.hover.provideHover(doc, pos(src.lastIndexOf("greet") + 2));
  assert.match(hover.args[0].value, /func greet\(name\)/);
  assert.match(hover.args[0].value, /Greets someone/);

  const def = mock.registered.definition.provideDefinition(doc, pos(src.lastIndexOf("greet") + 1));
  assert.equal(def.args[1].line, 2);

  const symbols = mock.registered.symbols.provideDocumentSymbols(doc);
  assert.deepEqual(symbols.map((s) => s.name), ["user", "greet"]);

  const folds = mock.registered.folding.provideFoldingRanges(doc);
  assert.ok(folds.length >= 1);

  const ugly = mockDocument('if x>5{print("hi")}');
  const edits = mock.registered.format.provideDocumentFormattingEdits(ugly);
  assert.equal(edits[0].text, 'if x > 5 {\n    print("hi")\n}\n');

  // diagnostics come only from KIVO itself
  const bad = mockDocument("let user = 1\nprint(uesr)\n");
  mock.api.workspace.textDocuments = [bad];
  ext.activate({ subscriptions: [] });
  const diags = mock.collection.items.get(bad.uri.toString());
  assert.equal(diags.length, 1);
  assert.equal(diags[0].source, "kivo");
  assert.match(diags[0].message, /Unknown variable "uesr"\.\n\nDid you mean "user"\?/);
});
