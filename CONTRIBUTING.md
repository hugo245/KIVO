# Contributing to KIVO

Thanks for helping! KIVO aims to be easy to learn and pleasant to use, so contributions are judged by the [design rules](#design-rules) as much as by the code.

## Setup

```sh
git clone https://github.com/hugo245/kivo.git
cd kivo
npm test            # no install step: KIVO has no dependencies
npm link            # optional: puts `kivo` on your PATH
```

Requires Node.js 20+ (22.5+ for the database module).

## Layout

| Path | |
| --- | --- |
| `packages/lexer` | tokens and the lexer |
| `packages/parser` | AST definitions and the parser |
| `packages/checker` | static analysis |
| `packages/compiler` | AST → JavaScript for the runtime |
| `packages/runtime` | checked operations, values, standard library |
| `packages/core` | compile + run pipeline, module loading |
| `packages/formatter` | `kivo fmt` |
| `packages/language-service` | editor intelligence |
| `packages/language-server` | LSP server (`kivo lsp`) |
| `packages/cli` | the `kivo` command |
| `packages/vscode-kivo` | VS Code extension |
| `tests/` | `node:test` suites; `tests/programs` holds end-to-end KIVO programs |
| `examples/` | example programs (also formatted and checked in CI) |
| `docs/` | documentation |

See [docs/architecture.md](docs/architecture.md) for how they fit together.

## Making changes

- **New syntax**: add tokens in `packages/lexer/src/tokens.js`, a node type in `packages/parser/src/ast.js`, parse it, check it, compile it, format it, highlight it (`packages/vscode-kivo/syntaxes/grammar.js`), and document it in `docs/language.md`.
- **New standard library functions**: use `native("name(param: type) -> type", "Description.", fn)` — the signature drives arity checks, hover, completion and `docs/stdlib.md` (regenerate with `node scripts/gen-stdlib-docs.js`).
- **Errors**: every new error needs a clear message, a location, and a hint when the fix is predictable. Add a program to `tests/programs/errors/` with `// expect:` lines.
- **Behaviour**: add or extend a program in `tests/programs/` with its expected `.out` file.

Before sending a pull request:

```sh
npm test
npm run fmt:check
node packages/cli/bin/kivo.js check examples
```

## Design rules

1. The easiest obvious syntax usually wins.
2. Do not hide important programming concepts just to look easier.
3. Do hide unnecessary boilerplate.
4. Consistency matters more than clever syntax.
5. Errors should teach.
6. Simple programs should be extremely simple.
7. Complex programs must still be possible.
8. Avoid JavaScript's historical weirdness.
9. Do not depend on tons of unrelated frameworks.
10. Treat editor tooling as part of the language, not an afterthought.

Every feature must justify itself. "Language X has it" is not a reason on its own.
