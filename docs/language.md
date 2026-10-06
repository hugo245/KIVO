# KIVO language reference (0.1)

## Source files

- KIVO source files use the `.kivo` extension and are UTF-8.
- Statements end at the end of a line. `;` may separate statements on one line.
- Inside `( )` and `[ ]` line breaks are ignored, so argument lists and arrays can span lines. Inside `{ }` (blocks and objects) line breaks separate statements or properties.
- A line may continue a method chain by starting with `.` or `?.`:

  ```kivo
  let names = users
      .filter(u => u.active)
      .map(u => u.name)
  ```

- A binary operator at the end of a line continues the expression on the next line.

## Comments

```kivo
// line comment
/* block comment (may be nested) */
```

A `//` comment block directly above a declaration is its documentation and is shown when hovering in the editor.

## Keywords

```
let const func return if else for in while break continue
import from export as class extends self super
async await try catch finally throw
and or not true false null
```

`type` is a keyword only at the start of a `type Name { ... }` declaration; elsewhere (`type(value)`, `user.type`) it is an ordinary name. Keywords can be used as property names (`request.from`, `{ class: "x" }`).

## Values and types

| Type | Examples | Notes |
| --- | --- | --- |
| `null` | `null` | the absence of a value |
| `bool` | `true`, `false` | |
| `number` | `42`, `3.14`, `1_000_000`, `0xff`, `0b1010`, `2e10` | one 64-bit floating point number type; `int` means "a whole number", `float` any number |
| `string` | `"text"`, `"""multi-line"""` | immutable, interpolated |
| `array` | `[1, 2, 3]` | ordered, mutable |
| `object` | `{ name: "Hugo" }` | string keys, insertion ordered |
| `func` | `func(x) { ... }`, `x => x * 2` | first-class |
| `range` | `1..10`, `0..<10` | whole numbers, inclusive / exclusive end |
| `bytes` | `fs.readBytes(path)`, `"x".bytes()` | binary data |
| class instances | `Player("Hugo")` | |
| `error` | the value in `catch error` | `message`, `kind`, `value`, `file`, `line`, `column` |

`type(value)` returns the name of a value's type as a string.

### No implicit conversions

KIVO never converts between types on its own:

| Expression | Result |
| --- | --- |
| `"5" + 2` | error — use `number("5") + 2` or `"5" + string(2)` |
| `"5" == 5` | `false` (different types are never equal) |
| `if 0 { }` | error — conditions must be `true` or `false` |
| `1 / 0` | error — division by zero |
| `[1] + [2]` | error — use `concat` or `[...a, ...b]` |

Conversions are explicit: `string(x)`, `number(text)`, `int(x)`, `text.toNumber()` (gives `null` instead of an error).

### Equality

`==` and `!=` compare numbers, strings, booleans and `null` by value, and arrays and plain objects **structurally** (`[1, 2] == [1, 2]` is `true`). Class instances and functions are equal only to themselves.

## Variables

```kivo
let name = "Hugo"
let count: int = 0
let nothing          // null
const max = 100
```

- `let` variables can be reassigned; `const` cannot.
- With a type annotation, every assignment is checked: `count = "x"` is an error.
- Variables are block scoped. A variable cannot be used before its declaration in the same function.
- Destructuring:

  ```kivo
  let { name, coins } = user
  let { name: userName } = user
  let [first, second] = pair
  let [head, ...rest] = items
  ```

## Operators

From lowest to highest precedence:

| Operators | Meaning |
| --- | --- |
| `or` | logical or (operands must be `bool`) |
| `and` | logical and |
| `not` | logical not |
| `==` `!=` `<` `>` `<=` `>=` | comparison (not chainable: write `0 < x and x < 10`) |
| `??` | `a ?? b` is `a` unless `a` is `null` |
| `..` `..<` | ranges |
| `+` `-` | add, subtract; `+` also joins two strings |
| `*` `/` `%` | multiply, divide, remainder (sign of the divisor, like Python) |
| `-x` `await x` | negation, await |
| `a.b` `a?.b` `a[i]` `a?.[i]` `f(x)` `f?.(x)` | member access, index, call |

Assignment is a statement, not an expression: `=`, `+=`, `-=`, `*=`, `/=`, `%=`. There is no `++`/`--`.

`<` `>` `<=` `>=` compare two numbers or two strings.

### Null safety

- `a?.b` is `null` if `a` is `null` **or** has no property `b`.
- `a?.b.c` short-circuits the whole chain when `a` is `null`.
- `a.b` on `null` is an error that explains what was null.
- `a ?? b` provides a default.

### Dot vs. brackets on objects

- `user.name` is for properties you expect to exist. A missing property is an error with a suggestion — this catches typos.
- `user[key]` is a lookup by a computed key and gives `null` when the key is missing — this is how you use an object as a dictionary.

## Strings

```kivo
"Hello {name}"           // interpolation of any expression
"Total: {price * 1.21}"
"Literal brace: \{"
"Escapes: \n \t \r \0 \\ \" é \u{1F600}"
"""
    Triple quoted text spans lines.
    Common indentation is removed.
    """
```

Strings have methods (`upper`, `split`, `replace`, `slice`, ...) — see [stdlib.md](stdlib.md#string-methods). `text[0]` gives one character.

## Functions

```kivo
func add(a, b) {
    return a + b
}

func greet(name: string = "World") -> string {
    return "Hello, {name}!"
}

func sum(...numbers) {
    return numbers.sum()
}

async func load(url) {
    let res = await http.get(url)
    return res.json()
}
```

- Function declarations are hoisted within their block: they can be called before they appear.
- Calling with the wrong number of arguments is an error (`greet expects 1 argument, but was called with 2`).
- Parameters with defaults must come after required parameters; a `...rest` parameter must be last.
- A function without `return` returns `null`.
- Parameter and return annotations are checked when the function runs.

Function expressions:

```kivo
let square = func(x) {
    return x * x
}
let double = x => x * 2
let add = (a, b) => a + b
let handler = (req, res) => {
    res.text("ok")
}
let point = (x, y) => { x: x, y: y }     // "=> {" followed by "key:" is an object
```

Closures capture variables by reference.

When the runtime calls your function as a callback (for example `items.map(f)`), it passes only as many arguments as `f` declares, so both `items.map(x => x * 2)` and `items.map((x, i) => x * i)` work.

## Control flow

```kivo
if condition {
} else if other {
} else {
}

for item in items { }          // arrays, strings (characters), ranges, objects (keys)
for i, item in items { }       // index and item; for objects: key and value
for i in 1..10 { }
while condition { }

break
continue
```

`for i in a..b` with `b < a` runs zero times.

## Errors

```kivo
try {
    risky()
} catch error {
    print(error.message, error.kind)
} finally {
    cleanup()
}

throw "message"
throw { message: "Not found", code: 404 }   // error.value.code == 404
```

`catch` may omit the variable: `catch { ... }`. `error.kind` is `"Error"` for thrown values and names like `"RuntimeError"`, `"TypeError"`, `"IOError"`, `"JSONError"` for errors raised by KIVO itself.

## Classes

```kivo
class Player {
    let name                 // field, starts as null
    let coins: int = 0       // typed field with a default
    const kind = "player"    // can only be set during init

    func init(name) {        // called by Player(...)
        self.name = name
    }

    func addCoins(amount: int) {
        self.coins += amount
    }
}

class Admin extends Player {
    func init(name) {
        super.init(name)
    }
}

let p = Player("Hugo")
```

- Create instances by calling the class — there is no `new`.
- Every field must be declared; assigning an undeclared field is an error.
- `self` is always the instance, also inside nested functions and lambdas.
- Methods can be passed around: `let f = p.addCoins` keeps `self` bound.
- `isinstance(value, Class)` checks the class (including parents).

## Type declarations

```kivo
type Address {
    city: string
    zip?: string             // optional field
}

type User {
    id: int
    name: string
    address: Address?
    tags: [string]
}

let u: User = { id: 1, name: "Hugo", address: null, tags: [] }
let checked = User(json.parse(text))   // validates and returns the value
```

`type` declares the shape of plain objects (for example JSON). Calling a type validates a value and throws a `ValidationError` describing the first problem; inside a `web` handler that becomes a `400` response.

### Type annotation syntax

| Syntax | Meaning |
| --- | --- |
| `string` `int` `float` `number` `bool` `array` `object` `bytes` `func` `range` `error` `any` `null` `void` | built-in types |
| `Player`, `User` | a class or a declared type |
| `T?` | `T` or `null` |
| `[T]` | array whose items are `T` |
| `A \| B` | either |

## Modules

```kivo
import math                          // standard module
import math as m
import mylib                         // local package from packages/mylib
import "./utils.kivo" as utils       // a file, as a namespace
from fs import read, write           // selected names
from "./utils.kivo" import calculatePrice, Cart as ShoppingCart
```

- Mark what a file offers with `export`: `export let`, `export const`, `export func`, `export class`, `export type`.
- Exports are live: importers always see the current value of an exported `let`.
- Imports are resolved before the rest of the file runs, wherever they appear (by convention at the top).
- Each file runs once, however often it is imported.
- File paths are relative to the importing file; the `.kivo` extension may be omitted.

## Async

- `async func` declares a function that may `await`.
- `await` is allowed at the top level of a file and inside `async` functions. Using it in a normal function is a compile error that tells you to add `async`.
- Calling an `async` function without `await` gives an "async result". Using it as if it were the value (`result.name`) is an error that reminds you to `await`.

## Program structure

- A program is a file; its top-level statements run from top to bottom.
- Uncaught errors stop the program with exit code 1 and print the KIVO error.
- `process.args` holds command line arguments; `process.exit(code)` stops the program.
