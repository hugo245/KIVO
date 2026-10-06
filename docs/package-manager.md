# Package management (design)

Status: **design**. KIVO 0.1 implements local packages (`packages/<name>/`); `kivo add` and the registry are planned for 0.3. This document describes where we are heading so that today's project layout stays compatible.

## Goals

- Adding a dependency is one command: `kivo add postgres`.
- Builds are reproducible: a lockfile pins exact versions and content hashes.
- No install scripts. Installing a package never runs code (a common supply-chain attack vector).
- Packages are plain KIVO source with a `kivo.toml`; nothing to compile.
- Small and understandable. No peer dependencies, no hoisting rules.

## What works today (0.1)

```kivo
import greeter
```

looks for a package named `greeter` in the project's `packages/` directory:

```
my-app/
├── kivo.toml
├── src/main.kivo
└── packages/
    └── greeter/
        ├── kivo.toml        # optional: [run] entry = "src/main.kivo"
        └── src/main.kivo
```

The entry is `[run].entry` from the package's `kivo.toml`, or `src/main.kivo`, `main.kivo`, `src/lib.kivo`. Standard modules always win over packages with the same name. Dotted names map to directories: `import acme.utils` → `packages/acme/utils/`.

## Manifest

```toml
[project]
name = "my-app"
version = "0.1.0"
kivo = ">=0.3"            # language version required

[run]
entry = "src/main.kivo"

[dependencies]
postgres = "1.2.0"        # exact, or a range: "^1.2", "~1.2.3"
discord = "3.1.0"
utils = { path = "../shared/utils" }
http2 = { git = "https://github.com/acme/http2-kivo", tag = "v0.4.0" }

[dev-dependencies]
mock-server = "0.2.0"
```

## Commands

| Command | Effect |
| --- | --- |
| `kivo add postgres` | resolve the latest version, add it to `[dependencies]`, install, update `kivo.lock` |
| `kivo add postgres@1.2` | a specific version or range |
| `kivo remove postgres` | remove from the manifest, the lockfile and `packages/` |
| `kivo update [name]` | update within the allowed ranges |
| `kivo install` | install exactly what `kivo.lock` says (used in CI) |

## Lockfile

`kivo.lock` (TOML, committed to version control):

```toml
[[package]]
name = "postgres"
version = "1.2.0"
source = "registry+https://packages.kivo.dev"
checksum = "sha256:9f2c..."
dependencies = ["bytes-utils 0.3.1"]
```

## Resolution

- Semantic versioning. One version of each package per project — if two dependencies need incompatible versions of the same package, resolution fails with a message naming both. (This keeps the dependency tree understandable; it can be relaxed later if real projects need it.)
- Installed packages live in `packages/<name>/`, which is exactly where `import` already looks. Vendoring is therefore the default, and a project with its `packages/` directory checked in builds offline.

## Security

- No install or build scripts.
- Every download is verified against the lockfile checksum.
- Packages are source code you can read in `packages/`.
- Future: package capabilities in the manifest (`uses = ["net", "fs"]`) that the runtime can enforce, so a JSON library cannot open sockets.

## Registry

A simple static HTTP API (`GET /packages/<name>/index.json`, `GET /packages/<name>/<version>.tar.gz`) so it can be mirrored or self-hosted with any file server.
