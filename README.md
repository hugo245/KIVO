<p align="center">
  <img src="docs/kivo-logo.png" width="96" alt="KIVO logo">
</p>

# KIVO

**A simple programming language that scales with you.**

KIVO combines the simplicity of scripting languages with the tooling and capabilities needed to build real applications.

```kivo
func greet(name) {
    print("Hello {name}")
}

greet("World")
```

- **Easy to read** — braces, `let`, `func`, `if`, `for … in`. If you know Lua, Python or JavaScript you can read KIVO today.
- **No surprises** — `"5" + 2` is an error, not `"52"`. Conditions must be `true` or `false`. Division by zero is an error, not `Infinity`.
- **Errors that teach** — exact file, line and column, the source line, what went wrong, and how to fix it.
- **Optional types** — write `func add(a, b)` while learning, `func add(a: int, b: int) -> int` when it matters. Annotations are checked.
- **Batteries included** — files, JSON, HTTP, a web framework, SQLite, crypto, testing and more.
- **Tooling is part of the language** — formatter, checker, test runner, bundler and a VS Code extension with diagnostics, autocomplete and hover.

---

## Contents

- [Installation](#installation)
- [Hello world](#hello-world)
- [Language basics](#language-basics)
- [Errors that teach](#errors-that-teach)
- [Building a web API](#building-a-web-api)
- [The `kivo` command](#the-kivo-command)
- [VS Code extension](#vs-code-extension)
- [Projects](#projects)
- [How it works](#how-it-works)
- [Current status](#current-status)
- [Roadmap](#roadmap)
- [Contributing](#contributing)

## Installation

KIVO 0.1 runs on [Node.js](https://nodejs.org) 20 or newer (22.5+ for the `database` module). It has no npm dependencies.

```sh
git clone https://github.com/hugo245/kivo.git
cd kivo
npm link            # puts the `kivo` command on your PATH
kivo --version      # KIVO 0.1.0
```

Without `npm link` you can always run `node packages/cli/bin/kivo.js` instead of `kivo`.

## Hello world

Create `hello.kivo`:

```kivo
let name = "Hugo"

func greet(name) {
    print("Hello {name}")
}

for i in 1..3 {
    greet(name)
}
```

Run it:

```
$ kivo run hello.kivo
Hello Hugo
Hello Hugo
Hello Hugo
```

`kivo hello.kivo` works too.

## Language basics

The full guide is in [docs/getting-started.md](docs/getting-started.md) and the reference in [docs/language.md](docs/language.md). Here is the short version.

```kivo
// Variables and constants
let name = "Hugo"
let coins = 500
const pi = 3.14159

// Optional types
let username: string = "Hugo"
let balance: float = 19.95

// Strings interpolate anything in { }
print("Hello {name}, you have {coins + 10} coins")

// Functions are values
func add(a, b) {
    return a + b
}
let double = x => x * 2
let square = func(x) {
    return x * x
}

// Conditions and loops
if coins > 100 {
    print("Rich")
} else {
    print("Poor")
}

for i in 1..10 { }          // 1 to 10
for i in 0..<10 { }         // 0 to 9
for player in players { }   // items
for index, player in players { }
for key, value in settings { }

while running {
    update()
}

// Arrays and objects
let users = ["Hugo", "Alex", "Sam"]
let user = {
    name: "Hugo",
    coins: 500,
    admin: true
}
print(user.name, users[0], len(users))
print(users.map(u => u.upper()).join(", "))

// Null safety
let city = user?.address?.city ?? "Unknown"

// Errors
try {
    let data = fs.read("data.json")
} catch error {
    print(error.message)
}
throw "Something went wrong"

// Classes
class Player {
    let name
    let coins = 0

    func init(name) {
        self.name = name
    }

    func addCoins(amount) {
        self.coins += amount
    }
}

let player = Player("Hugo")
player.addCoins(100)

// Shapes for data, checked when you call them
type User {
    id: int
    username: string
    email?: string
}
let checked = User(json.parse(text))

// Modules
import math
from fs import read, write
from "./utils.kivo" import calculatePrice

// Async
async func loadUsers() {
    let response = await http.get("https://example.com/users")
    return response.json()
}
```

## Errors that teach

```kivo
let user = null
print(user.name)
```

```
KIVO Error

main.kivo:2:12

 1 | let user = null
 2 | print(user.name)
   |            ^^^^

"user" is null, so "name" cannot be accessed.

Try checking it first:

    if user != null {
        ...user.name...
    }

Or use ?. to get null instead of an error:

    user?.name
```

KIVO never converts types behind your back:

```
Type Error

main.kivo:2:7

 1 | let age = "5"
 2 | print(age + 2)
   |       ^^^^^^^

Cannot add a string and a number.

KIVO never converts types behind your back. Convert explicitly:

    number(age) + 2     // math
    age + string(2)     // text
```

Many mistakes are caught before the program runs, by `kivo check` and live in the editor:

```
Name Error

main.kivo:3:7

Unknown variable "uesr".

Did you mean "user"?
```

Habits from other languages get specific advice: `&&` suggests `and`, `undefined` suggests `null`, `this` suggests `self`, `function` suggests `func`, `for (…)` shows KIVO's loop syntax. See [docs/errors.md](docs/errors.md).

## Building a web API

```kivo
import web

let app = web.app()

app.get("/", func(req, res) {
    res.json({
        message: "Hello from KIVO"
    })
})

app.get("/hello/:name", func(req, res) {
    res.json({
        message: "Hello {req.params.name}"
    })
})

// Handlers can also just return a value: objects become JSON
app.get("/api/status", req => { ok: true })

app.listen(3000)
```

```
$ kivo run server.kivo
KIVO web server running at http://localhost:3000
```

The framework supports all HTTP methods, route parameters, query strings, JSON/form bodies (with a size limit), middleware, cookies, CORS, static files (protected against path traversal), `throw web.error(404, "Not found")`, and request validation with `type` declarations (invalid input becomes a `400`). See [docs/web.md](docs/web.md) and [examples/web-server](examples/web-server).

A database is one import away:

```kivo
import database

let db = database.sqlite("app.db")
let users = db.table("users")
    .where("coins", ">", 100)
    .orderBy("coins", "desc")
    .limit(20)
    .get()
```

Every value is sent as a bound parameter and table/column names are validated, so the query builder cannot produce SQL injection.

## The `kivo` command

```
kivo <file.kivo>       Run a file
kivo run [file]        Run a program (defaults to the entry in kivo.toml)
kivo dev [file]        Run and restart automatically when .kivo files change
kivo check [files...]  Find errors without running anything
kivo fmt [files...]    Format code (--check to only report)
kivo test [files...]   Run *.test.kivo files
kivo build [file]      Bundle a program into one file that runs with plain Node.js
kivo new <name>        Create a new project
kivo --version
kivo help
```

```
$ kivo check
KIVO 0.1.0

✓ parsed src/main.kivo
✓ parsed src/users.kivo
✓ no errors
```

`kivo fmt` turns `if x>5{print("hi")}` into

```kivo
if x > 5 {
    print("hi")
}
```

It keeps comments and verifies that the formatted program is identical to the original before writing anything.

## VS Code extension

`packages/vscode-kivo` is a full VS Code extension:

- `.kivo` files open in the **KIVO** language mode with a KIVO file icon — never as JavaScript, TypeScript or plain text, so there are no stray red squiggles from other validators
- syntax highlighting for keywords, strings and `{interpolation}`, numbers, comments, functions, classes, types, properties and operators
- bracket matching, auto-closing, auto-indent, comment toggling, folding, snippets
- live **KIVO diagnostics** (the same checker as `kivo check`)
- **autocomplete**: keywords, built-ins, standard modules (with automatic `import`), variables and functions in scope, object properties, module members, string/array methods
- hover documentation, signature help, go to definition, outline
- **Format Document**, and a ▶ button to run the current file

Install it from the repository:

```sh
npm run vscode:install     # copies the extension into ~/.vscode/extensions
# or build a .vsix and install it with "Extensions: Install from VSIX..."
npm run vscode:package     # creates dist/kivo-0.1.0.vsix
```

See [docs/editor.md](docs/editor.md) for details and extension development.

## Projects

Simple scripts need no configuration. Larger applications use a `kivo.toml`:

```
my-app/
├── kivo.toml
├── src/
│   ├── main.kivo
│   └── users.kivo
├── tests/
│   └── users.test.kivo
└── packages/
```

```toml
[project]
name = "my-app"
version = "0.1.0"

[run]
entry = "src/main.kivo"
```

`kivo new my-app` creates this layout. `import name` loads a local package from `packages/name/`. The package manager design is in [docs/package-manager.md](docs/package-manager.md).

Tests use the `testing` module:

```kivo
from testing import test, equal
from "../src/greeting.kivo" import greet

test("greets by name", func() {
    equal(greet("KIVO"), "Hello, KIVO!")
})
```

## How it works

```
KIVO source
   ↓
lexer            packages/lexer       tokens, string interpolation, teaching errors
   ↓
parser           packages/parser      AST with exact positions, error recovery for editors
   ↓
checker          packages/checker     names, imports, arity, literal type checks
   ↓
compiler         packages/compiler    AST → JavaScript that only calls the KIVO runtime
   ↓
KIVO runtime     packages/runtime     checked operations, values, errors, standard library
```

KIVO compiles to JavaScript and runs on Node's V8 engine, which makes it fast and gives it a mature async model and networking stack. The generated code never relies on JavaScript semantics for anything that could behave surprisingly: every operator, property access, call, loop and condition goes through a checked runtime helper that knows KIVO's rules and points back to the KIVO source. You never see or touch the generated JavaScript.

The packages are separate on purpose: `packages/language-service` powers the editor without depending on VS Code, `packages/formatter` works on the AST, and the compiler backend can be replaced (bytecode VM, WebAssembly, native) without touching the front end. Details in [docs/architecture.md](docs/architecture.md).

## Current status

KIVO is at **0.1** — a complete, working vertical slice, not a finished language. What works today:

- the language described above: variables, constants, optional types (checked), functions, closures, lambdas, default and rest parameters, classes with inheritance, `type` declarations, destructuring, ranges, `try`/`catch`/`finally`/`throw`, `?.` and `??`, modules with `import`/`from`/`export`, `async`/`await` including top-level await
- standard library: `math`, `fs`, `path`, `json`, `time`, `process`, `env`, `random`, `crypto`, `http`, `web`, `database` (SQLite), `testing` — reference in [docs/stdlib.md](docs/stdlib.md)
- CLI: `run`, `dev`, `check`, `fmt`, `test`, `build`, `new`
- VS Code extension with diagnostics, completion, hover, definitions, formatting
- 110+ automated tests, including every example program

Known limitations of 0.1:

- the static checker knows names, imports, arity and literal types; it does not yet infer types through expressions
- the web framework has no WebSockets, sessions or multipart uploads yet
- no package registry yet (`kivo add` is designed but not implemented)
- one number type (64-bit float); `int` annotations check for whole numbers

## Roadmap

- **0.2** — Language Server Protocol server (wrapping `packages/language-service`) for other editors, rename/references, type inference in the checker, WebSockets and sessions in `web`, multipart uploads
- **0.3** — package manager (`kivo add`, `kivo remove`, `kivo update`, lockfile, registry), `match` expressions, interfaces
- **Later** — generics, workers and concurrency, FFI, a bytecode VM or WebAssembly backend, native compilation

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

```sh
npm test                 # run the test suite
npm run fmt:check        # check formatting of examples and test programs
node scripts/gen-stdlib-docs.js   # regenerate docs/stdlib.md
```

## License

[MIT](LICENSE)
