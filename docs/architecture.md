# Architecture

KIVO 0.1 is a compiler to JavaScript plus a runtime, running on Node.js. This document explains how the pieces fit together and why.

```
                ┌─────────────┐
 source.kivo ──►│   lexer     │  packages/lexer      tokens + comments
                └──────┬──────┘
                ┌──────▼──────┐
                │   parser    │  packages/parser     AST (every node has exact positions)
                └──────┬──────┘
                ┌──────▼──────┐
                │   checker   │  packages/checker    scopes, symbols, diagnostics
                └──────┬──────┘
                ┌──────▼──────┐
                │  compiler   │  packages/compiler   AST → JavaScript calling $rt.*
                └──────┬──────┘
                ┌──────▼──────┐
                │   runtime   │  packages/runtime    checked operations, values, stdlib
                └─────────────┘

 core              packages/core              ties the pipeline together, loads modules
 cli               packages/cli               the `kivo` command, `kivo build` bundler
 formatter         packages/formatter         AST → canonical source
 language-service  packages/language-service  completion, hover, definitions (editor-agnostic)
 vscode-kivo       packages/vscode-kivo       VS Code adapter, grammar, icon
 diagnostics       packages/diagnostics       shared Diagnostic type and error rendering
```

The packages only use relative `require` paths and Node built-ins — there are no npm dependencies.

## Why compile to JavaScript?

The goal for 0.1 was a working language with excellent developer experience, quickly, without painting ourselves into a corner. Compiling to JavaScript gives us:

- a fast JIT (V8) for free — tight loops and recursion run at native-like speed
- a mature event loop, so `async`/`await`, timers, HTTP and the web server work naturally
- the Node standard library (files, crypto, networking, SQLite) to build KIVO's own standard library on

The risk of this approach is *leaking JavaScript semantics*. KIVO avoids that by never emitting raw JavaScript operators for anything that could behave differently:

| KIVO | Generated code |
| --- | --- |
| `a + b` | `$rt.add(a, b, L)` — numbers or two strings, otherwise a KIVO error |
| `a == b` | `$rt.eq(a, b)` — structural equality, no coercion |
| `user.name` | `$rt.get(user, "name", L)` — null/missing checks with suggestions |
| `f(x)` | `$rt.call(f, [x], L)` — arity check, nice "not a function" errors |
| `if c { }` | `if ($rt.cond(c, L))` — must be a boolean |
| `for x in xs` | `for (let x of $rt.iter(xs, L))` |
| `for i in 1..n` | a counting loop with validated bounds |

`L` is an index into a location table that records file, line, column, the enclosing function and the source text of the operands. That is how runtime errors can say `"user" is null, so "name" cannot be accessed` and point at `main.kivo:12:16`.

User identifiers are prefixed (`k$name`) so they can never collide with JavaScript keywords, globals or the runtime.

## Lexer

Table-driven (`tokens.js` lists keywords and punctuation, longest match first), so adding syntax means adding a table entry. It produces `NEWLINE` tokens only where they matter (top level and inside `{ }`), handles string interpolation by lexing the embedded expressions in place (so their tokens keep exact positions), and recognises habits from other languages (`&&`, `===`, `++`, `'single quotes'`) to produce teaching errors. In *tolerant* mode (used by editors) it records errors and keeps going.

## Parser

A hand-written recursive descent parser with one function per precedence level. It records exact `loc` information for every node and supports error recovery (statements that fail to parse are skipped and reported) so the editor still gets symbols and completions while code is incomplete.

## Checker

Builds scopes and symbols, then reports: unknown names (with suggestions), use before declaration, reassigning constants, duplicate declarations, unknown modules and members, wrong argument counts, and literal values that contradict type annotations. Its symbol table and references also power hover, completion and go-to-definition.

The checker is deliberately conservative: it only reports what it knows for certain. A future type-inference pass slots in here.

## Runtime

- `values.js` — value model, `repr` (how values print), structural equality
- `core.js` — every checked operation compiled code calls
- `errors.js` — `KivoError`, the location table, conversion of host errors into KIVO errors
- `types.js` — runtime checks for type annotations and `type` declarations
- `methods.js` — string/array/range/bytes methods, each with a signature and documentation
- `builtins.js` — global functions
- `stdlib/*` — modules, created lazily on first import

Signatures and docs live next to the implementation (`native("read(path: string) -> string", "Reads a whole text file.", fn)`). The editor, `docs/stdlib.md` and arity checks all read them from there.

## Modules

`core` compiles each file into an async function `($rt, $B, $exports, $file)`. Exports are defined as live getters up front, so circular imports of functions work. Each file is loaded once. `kivo build` performs the same steps ahead of time and bundles the runtime and all modules into a single file.

## Editor tooling

`language-service` exposes offset-based functions (`completions`, `hover`, `definition`, `signatureHelp`, `diagnostics`, `documentSymbols`, `foldingRanges`, `format`). The VS Code extension is a thin adapter. A Language Server Protocol server for other editors is a thin wrapper around the same functions (planned for 0.2).

## Evolving beyond 0.1

The design keeps these doors open:

- **Other backends** — the AST and checker don't know about JavaScript. A bytecode VM, WebAssembly or native backend can be added next to `compiler` and reuse `runtime`'s semantics as the specification (the test suite runs programs end to end and is backend-independent).
- **Types** — annotations are already parsed into a type AST (`TypeName`, `NullableType`, `ArrayType`, `UnionType`); generics and interfaces extend that grammar.
- **Concurrency** — `async`/`await` is in place; workers can be offered as a module.
- **FFI / native libraries** — `native(...)` is already the boundary between KIVO and host code.
- **Packages** — module resolution goes through one function (`findPackage`), which the package manager will extend.
