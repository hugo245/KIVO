# KIVO for Visual Studio Code

Language support for [KIVO](https://github.com/hugo245/kivo) — a simple programming language that scales with you.

## Features

- **KIVO language mode** — every `.kivo` file opens as KIVO (shown as `KIVO` in the language picker) with its own file icon. No JavaScript or TypeScript tooling ever touches these files.
- **Syntax highlighting** for keywords, strings and `{interpolation}`, numbers, comments, functions, classes, types, properties and operators.
- **Diagnostics from KIVO itself** while you type:

  ```
  Unknown variable "uesr".

  Did you mean "user"?
  ```

- **Autocomplete** — keywords, built-in functions, standard modules (choosing `math` adds `import math` for you), variables and functions in scope, object properties (`user.` → `name`, `coins`), string and array methods, module members (`fs.` → `read`, `write`, …).
- **Hover** — signatures and documentation for built-ins, modules and your own functions (doc comments directly above a declaration are shown).
- **Signature help**, **go to definition** (also across `from "./file.kivo" import ...`), **outline**, **folding**.
- **Format Document** with the KIVO formatter.
- **Run** — the ▶ button in the editor title runs the current file (`kivo run`).

## Requirements

The extension contains the complete KIVO toolchain. Running programs from the editor needs [Node.js](https://nodejs.org) 20 or newer on your `PATH`. If you installed the `kivo` command globally you can set `"kivo.command": "kivo"`.

## Settings

| Setting | Default | |
| --- | --- | --- |
| `kivo.diagnostics.enabled` | `true` | Show KIVO errors while typing |
| `kivo.command` | `""` | Command used to run KIVO in the terminal |

## File icons

KIVO contributes its icon as the language's default file icon (`contributes.languages[].icon`), the mechanism VS Code provides for this. The default *Seti* file icon theme shows it. Third-party icon themes show it when they enable language icons for file types they don't know (`showLanguageModeIcons`); otherwise they display their own generic icon.
