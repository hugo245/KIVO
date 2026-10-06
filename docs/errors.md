# Errors in KIVO

KIVO treats error messages as part of the language. Every error says **what happened**, **where** (file, line, column and the source line), and — where KIVO can tell — **how to fix it**.

## When errors are found

1. **While you type** — the VS Code extension runs the checker on every change.
2. **Before running** — `kivo run` checks the whole file first; nothing runs if there is a syntax or name error.
3. **While running** — runtime errors point at the exact operation that failed.

## Examples

### Using null

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

### Mixing types

```
Cannot add a string and a number.

KIVO never converts types behind your back. Convert explicitly:

    number(age) + 2     // math
    age + string(2)     // text
```

### Typos

```
Unknown variable "uesr".

Did you mean "user"?
```

The same suggestions work for object properties, class fields, module members (`math.sqr` → `sqrt`), modules (`import maths` → `math`), types and CLI commands.

### Wrong number of arguments

```
greet expects 1 argument, but is called with 2.

func greet(name)
```

### Conditions that are not booleans

```
"count" is a number (0), but a condition must be true or false.

KIVO does not guess whether values count as true. Compare it explicitly:

    if count != 0 { ... }
```

### Habits from other languages

| You wrote | KIVO says |
| --- | --- |
| `a && b`, `a \|\| b`, `!a` | use `and`, `or`, `not` |
| `a === b` | use `==` (it never converts types) |
| `x++` | use `x += 1` |
| `'text'`, `` `text` `` | strings use double quotes; interpolation works in every string |
| `var x = 1` | use `let` |
| `function f()`, `def f()` | use `func` |
| `elif` | use `else if` |
| `if x > 1:` | use braces |
| `for (i = 0; ...)` | shows `for i in 0..<10` |
| `undefined`, `nil`, `None` | KIVO has `null` |
| `this` | use `self` |
| `new Player()` | call the class: `Player()` |
| `console.log`, `println` | use `print` |
| `-- comment` | comments start with `//` |
| `items[items.length]` | use `push` to add items |
| `items[-1]` | use `items.last()` |

### Async results

```
"response" is an async result that has not finished yet, so "json" cannot be accessed.

Did you forget await?

    let result = await ...
```

## Catching errors

```kivo
try {
    let config = json.parse(fs.read("config.json"))
} catch error {
    print(error.kind, error.message)    // IOError Cannot read "config.json": it does not exist.
    print(error.file, error.line)
}
```

| `error.kind` | Raised when |
| --- | --- |
| `Error` | you `throw` a value |
| `RuntimeError` | an operation is impossible (null access, index out of range, ...) |
| `TypeError` | a value has the wrong type |
| `ValidationError` | a value does not match a `type` declaration |
| `NameError` | a name is not defined |
| `ImportError` | a module or file cannot be imported |
| `IOError` | a file system or process operation failed |
| `JSONError` | invalid JSON |
| `HttpError` | an HTTP request failed |
| `DatabaseError` | a database query failed |
| `AssertionError` | `assert` or a `testing` check failed |

## Never JavaScript errors

KIVO runs on V8, but you should never see a JavaScript error message or stack trace. If you do, that is a bug in KIVO — please report it. Setting `KIVO_DEBUG=1` adds the internal stack to errors that come from the host, which helps when reporting such bugs.
