"use strict";

// VS Code adapter for the KIVO language service. All language intelligence
// lives in @kivo/language-service; this file only converts between VS Code's
// API and the service's offset-based results.

const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

// When developing inside the monorepo the live toolchain is used; a packaged
// extension carries its own copy in ./kivo (see scripts/build-vscode.js).
function locateToolchain() {
  const candidates = [path.join(__dirname, ".."), path.join(__dirname, "kivo", "packages")];
  for (const base of candidates) {
    if (fs.existsSync(path.join(base, "language-service", "src", "index.js"))) {
      return { packages: base, cli: path.join(base, "cli", "bin", "kivo.js") };
    }
  }
  return null;
}

const COMPLETION_KINDS = {
  keyword: vscode.CompletionItemKind.Keyword,
  function: vscode.CompletionItemKind.Function,
  method: vscode.CompletionItemKind.Method,
  variable: vscode.CompletionItemKind.Variable,
  constant: vscode.CompletionItemKind.Constant,
  class: vscode.CompletionItemKind.Class,
  module: vscode.CompletionItemKind.Module,
  field: vscode.CompletionItemKind.Field,
  property: vscode.CompletionItemKind.Property,
  type: vscode.CompletionItemKind.TypeParameter,
};

const SYMBOL_KINDS = {
  function: vscode.SymbolKind.Function,
  class: vscode.SymbolKind.Class,
  method: vscode.SymbolKind.Method,
  constructor: vscode.SymbolKind.Constructor,
  field: vscode.SymbolKind.Field,
  variable: vscode.SymbolKind.Variable,
  constant: vscode.SymbolKind.Constant,
  struct: vscode.SymbolKind.Struct,
};

let ls = null;
let toolchain = null;
let diagnosticCollection = null;
const pending = new Map();

function service() {
  if (ls) return ls;
  toolchain = locateToolchain();
  if (!toolchain) throw new Error("The KIVO toolchain was not found inside the extension.");
  ls = require(path.join(toolchain.packages, "language-service", "src", "index.js"));
  return ls;
}

function fileOf(document) {
  return document.uri.scheme === "file" ? document.uri.fsPath : null;
}

function range(document, start, end) {
  return new vscode.Range(document.positionAt(start), document.positionAt(end));
}

// ---------------------------------------------------------------- diagnostics

function refreshDiagnostics(document) {
  if (document.languageId !== "kivo") return;
  const enabled = vscode.workspace.getConfiguration("kivo", document.uri).get("diagnostics.enabled", true);
  if (!enabled) {
    diagnosticCollection.delete(document.uri);
    return;
  }
  let list;
  try {
    list = service().diagnostics(document.getText(), fileOf(document));
  } catch (err) {
    console.error("KIVO diagnostics failed:", err);
    return;
  }
  const result = list.map((d) => {
    const diag = new vscode.Diagnostic(range(document, d.start, d.end), d.hint ? `${d.message}\n\n${d.hint}` : d.message, d.severity === "warning" ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error);
    diag.source = "kivo";
    return diag;
  });
  diagnosticCollection.set(document.uri, result);
}

function scheduleDiagnostics(document) {
  if (document.languageId !== "kivo") return;
  const key = document.uri.toString();
  clearTimeout(pending.get(key));
  pending.set(
    key,
    setTimeout(() => {
      pending.delete(key);
      refreshDiagnostics(document);
    }, 200)
  );
}

// ---------------------------------------------------------------- providers

const completionProvider = {
  provideCompletionItems(document, position) {
    const items = service().completions(document.getText(), document.offsetAt(position), fileOf(document));
    return items.map((item) => {
      const ci = new vscode.CompletionItem(item.label, COMPLETION_KINDS[item.kind] ?? vscode.CompletionItemKind.Text);
      if (item.detail) ci.detail = item.detail;
      if (item.documentation) ci.documentation = new vscode.MarkdownString(item.documentation);
      if (item.sortText) ci.sortText = item.sortText;
      if (item.snippet) {
        ci.insertText = new vscode.SnippetString(item.snippet);
        ci.kind = vscode.CompletionItemKind.Snippet;
        ci.detail = ci.detail || `${item.label} snippet`;
      }
      if (item.autoImport) {
        const line = service().importInsertLine(document.getText());
        ci.additionalTextEdits = [vscode.TextEdit.insert(new vscode.Position(line, 0), item.autoImport + "\n")];
        ci.detail = `${item.detail} (adds the import)`;
      }
      return ci;
    });
  },
};

const hoverProvider = {
  provideHover(document, position) {
    const h = service().hover(document.getText(), document.offsetAt(position), fileOf(document));
    if (!h) return null;
    return new vscode.Hover(new vscode.MarkdownString(h.contents), range(document, h.start, h.end));
  },
};

const definitionProvider = {
  provideDefinition(document, position) {
    const d = service().definition(document.getText(), document.offsetAt(position), fileOf(document));
    if (!d) return null;
    const uri = d.file && d.file !== fileOf(document) ? vscode.Uri.file(d.file) : document.uri;
    const pos = new vscode.Position(Math.max(0, d.line - 1), Math.max(0, d.column - 1));
    return new vscode.Location(uri, pos);
  },
};

const signatureHelpProvider = {
  provideSignatureHelp(document, position) {
    const s = service().signatureHelp(document.getText(), document.offsetAt(position), fileOf(document));
    if (!s) return null;
    const info = new vscode.SignatureInformation(s.label, s.documentation ? new vscode.MarkdownString(s.documentation) : undefined);
    info.parameters = s.parameters.map((p) => new vscode.ParameterInformation(p));
    const help = new vscode.SignatureHelp();
    help.signatures = [info];
    help.activeSignature = 0;
    const rest = s.parameters.findIndex((p) => p.startsWith("..."));
    help.activeParameter = rest >= 0 ? Math.min(s.activeParameter, rest) : s.activeParameter;
    return help;
  },
};

const symbolProvider = {
  provideDocumentSymbols(document) {
    const convert = (s) => {
      const sym = new vscode.DocumentSymbol(s.name, s.detail || "", SYMBOL_KINDS[s.kind] ?? vscode.SymbolKind.Variable, range(document, s.start, s.end), range(document, s.selectionStart, s.selectionEnd));
      sym.children = (s.children || []).map(convert);
      return sym;
    };
    return service().documentSymbols(document.getText(), fileOf(document)).map(convert);
  },
};

const foldingProvider = {
  provideFoldingRanges(document) {
    return service()
      .foldingRanges(document.getText())
      .filter((r) => r.endLine > r.startLine)
      .map((r) => new vscode.FoldingRange(r.startLine, r.endLine, r.kind === "comment" ? vscode.FoldingRangeKind.Comment : r.kind === "region" ? vscode.FoldingRangeKind.Region : undefined));
  },
};

const formattingProvider = {
  provideDocumentFormattingEdits(document) {
    const text = document.getText();
    let formatted;
    try {
      formatted = service().format(text, fileOf(document));
    } catch (err) {
      const msg = err.diagnostics ? `KIVO: cannot format — ${err.diagnostics[0].message} (line ${err.diagnostics[0].line})` : `KIVO: ${err.message}`;
      vscode.window.setStatusBarMessage(msg, 5000);
      return [];
    }
    if (formatted === text) return [];
    return [vscode.TextEdit.replace(new vscode.Range(document.positionAt(0), document.positionAt(text.length)), formatted)];
  },
};

// ---------------------------------------------------------------- commands

function quote(arg) {
  return /^[\w./:\\-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '\\"')}"`;
}

function kivoCommand(document) {
  const configured = vscode.workspace.getConfiguration("kivo", document && document.uri).get("command", "").trim();
  if (configured) return configured;
  service();
  return `node ${quote(toolchain.cli)}`;
}

let terminal = null;

function runInTerminal(args, document) {
  if (!terminal || terminal.exitStatus !== undefined) {
    terminal = vscode.window.createTerminal({ name: "KIVO" });
  }
  terminal.show(true);
  const cwd = document && document.uri.scheme === "file" ? path.dirname(document.uri.fsPath) : null;
  if (cwd) terminal.sendText(`cd ${quote(cwd)}`);
  terminal.sendText(`${kivoCommand(document)} ${args.map(quote).join(" ")}`);
}

async function withSavedKivoFile(fn) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "kivo") {
    vscode.window.showWarningMessage("Open a .kivo file first.");
    return;
  }
  if (editor.document.isUntitled) {
    vscode.window.showWarningMessage("Save the file before running it.");
    return;
  }
  await editor.document.save();
  fn(editor.document);
}

// ---------------------------------------------------------------- activation

function activate(context) {
  diagnosticCollection = vscode.languages.createDiagnosticCollection("kivo");
  context.subscriptions.push(diagnosticCollection);

  const selector = { language: "kivo" };
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(selector, completionProvider, ".", '"'),
    vscode.languages.registerHoverProvider(selector, hoverProvider),
    vscode.languages.registerDefinitionProvider(selector, definitionProvider),
    vscode.languages.registerSignatureHelpProvider(selector, signatureHelpProvider, "(", ","),
    vscode.languages.registerDocumentSymbolProvider(selector, symbolProvider),
    vscode.languages.registerFoldingRangeProvider(selector, foldingProvider),
    vscode.languages.registerDocumentFormattingEditProvider(selector, formattingProvider),
    vscode.workspace.onDidOpenTextDocument(refreshDiagnostics),
    vscode.workspace.onDidChangeTextDocument((e) => scheduleDiagnostics(e.document)),
    vscode.workspace.onDidSaveTextDocument(() => {
      // re-check open files: an imported file may have changed
      for (const d of vscode.workspace.textDocuments) if (d.languageId === "kivo") scheduleDiagnostics(d);
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => diagnosticCollection.delete(doc.uri)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("kivo")) vscode.workspace.textDocuments.forEach(refreshDiagnostics);
    }),
    vscode.commands.registerCommand("kivo.run", () => withSavedKivoFile((doc) => runInTerminal(["run", doc.uri.fsPath], doc))),
    vscode.commands.registerCommand("kivo.dev", () => withSavedKivoFile((doc) => runInTerminal(["dev", doc.uri.fsPath], doc))),
    vscode.commands.registerCommand("kivo.check", () => runInTerminal(["check"], vscode.window.activeTextEditor && vscode.window.activeTextEditor.document)),
    vscode.commands.registerCommand("kivo.test", () => runInTerminal(["test"], vscode.window.activeTextEditor && vscode.window.activeTextEditor.document))
  );

  vscode.workspace.textDocuments.forEach(refreshDiagnostics);
}

function deactivate() {
  for (const t of pending.values()) clearTimeout(t);
  pending.clear();
}

module.exports = { activate, deactivate };
