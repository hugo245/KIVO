# Editor support

## VS Code

The extension lives in [`packages/vscode-kivo`](../packages/vscode-kivo). It contains the complete KIVO toolchain, so it works without installing anything else (running programs from the editor needs Node.js on your `PATH`).

### Install

From the repository root:

```sh
npm run vscode:install      # builds dist/kivo-0.1.0.vsix and installs it with `code --install-extension`
```

Then reload VS Code (`Developer: Reload Window`). Alternatively:

```sh
npm run vscode:package      # creates dist/kivo-0.1.0.vsix
```

and install it with **Extensions → … → Install from VSIX…** (or `code --install-extension dist/kivo-0.1.0.vsix`).

### What you get

- `.kivo` files are registered to the `kivo` language only (listed as **KIVO** in the language picker), so JavaScript/TypeScript validators never run on them.
- The KIVO file icon (via `contributes.languages[].icon`, shown by the default Seti icon theme).
- Syntax highlighting, bracket matching and colorization, auto-closing pairs, auto-indent, `//` and `/* */` comment toggling, folding (braces, comment blocks, `// region`).
- Diagnostics from the KIVO checker as you type. Only real KIVO errors are shown, with their hints.
- Completion: keywords (with snippets), built-ins, standard modules (picking one adds the `import`), variables/functions/classes in scope, object properties, module members, methods of strings/arrays, fields and methods on `self`, members of `web` apps/requests/responses and database tables.
- Hover with signatures and docs (including `//` doc comments above your own declarations).
- Signature help, go to definition (also into imported files), document outline.
- Format Document (`kivo fmt`), and the ▶ **Run File** button.

### Settings

| Setting | Default | |
| --- | --- | --- |
| `kivo.diagnostics.enabled` | `true` | live diagnostics |
| `kivo.command` | `""` | command for running KIVO in the terminal; empty uses the bundled toolchain via `node` |

The extension also sets KIVO defaults for `.kivo` files: 4-space indentation, KIVO as the default formatter, and word-based suggestions off (so completion only offers real KIVO names).

### Developing the extension

1. Open the repository in VS Code.
2. Run the **Run KIVO Extension** launch configuration (F5). It starts an Extension Development Host with the extension loaded straight from `packages/vscode-kivo` — the toolchain is resolved from the monorepo, so edits to the compiler or language service apply after reloading the window.
3. The grammar is generated: edit `syntaxes/grammar.js`, then run `node packages/vscode-kivo/syntaxes/grammar.js`.

## Other editors (Language Server Protocol)

`kivo lsp` starts a Language Server Protocol server over stdio. It provides diagnostics, completion (including automatic imports), hover, signature help, go to definition, formatting, document symbols and folding — the same features as the VS Code extension.

**Neovim** (0.10+):

```lua
vim.filetype.add({ extension = { kivo = "kivo" } })
vim.api.nvim_create_autocmd("FileType", {
  pattern = "kivo",
  callback = function()
    vim.lsp.start({ name = "kivo", cmd = { "kivo", "lsp" }, root_dir = vim.fs.root(0, { "kivo.toml", ".git" }) })
  end,
})
```

**Helix** (`languages.toml`):

```toml
[language-server.kivo]
command = "kivo"
args = ["lsp"]

[[language]]
name = "kivo"
scope = "source.kivo"
file-types = ["kivo"]
comment-token = "//"
indent = { tab-width = 4, unit = "    " }
language-servers = ["kivo"]
```

**Zed, Sublime Text (LSP package), Emacs (eglot), JetBrains (LSP4IJ)**: configure a server with the command `kivo lsp` for `*.kivo` files.

The TextMate grammar in `packages/vscode-kivo/syntaxes/kivo.tmLanguage.json` can be used by editors that support TextMate grammars for highlighting.

### Embedding the language service

All language intelligence is in [`packages/language-service`](../packages/language-service), which has no editor dependencies:

```js
const ls = require("./packages/language-service/src");
ls.diagnostics(source, file);          // [{ severity, message, hint, start, end }]
ls.completions(source, offset, file);  // [{ label, kind, detail, documentation }]
ls.hover(source, offset, file);
ls.definition(source, offset, file);
ls.signatureHelp(source, offset, file);
ls.documentSymbols(source, file);
ls.format(source, file);
```
