# Getting started with KIVO

This guide teaches KIVO from zero. Every example is a complete program: save it as a `.kivo` file and run it with `kivo run file.kivo`.

## 1. Printing

```kivo
print("Hello world")
```

`print` accepts any number of values and separates them with spaces:

```kivo
print("The answer is", 42)
```

## 2. Variables

```kivo
let name = "Hugo"
print(name)

name = "Alex"
print(name)
```

`let` creates a variable. Use `const` for a value that never changes:

```kivo
const pi = 3.14159
```

Assigning to a constant is an error — KIVO tells you before the program even starts.

## 3. Strings

Anything inside `{ }` in a string is evaluated:

```kivo
let name = "Hugo"
let coins = 500
print("Hello {name}, you have {coins} coins")
print("Next year: {coins * 2}")
```

To write a literal brace, escape it: `"\{"`. Text spanning several lines uses triple quotes:

```kivo
let letter = """
    Dear {name},
    Thanks for trying KIVO.
    """
```

## 4. Functions

```kivo
func greet(name) {
    print("Hello {name}")
}

greet("World")
```

Functions return values with `return`:

```kivo
func add(a, b) {
    return a + b
}

print(add(2, 3))
```

Parameters can have defaults:

```kivo
func greet(name = "World") {
    return "Hello, {name}!"
}
```

Functions are values. Short functions can use `=>`:

```kivo
let double = x => x * 2
let add = (a, b) => a + b
print(double(21), add(1, 2))
```

## 5. Conditions

```kivo
let coins = 150

if coins > 100 {
    print("Rich")
} else if coins > 10 {
    print("Okay")
} else {
    print("Poor")
}
```

Combine conditions with `and`, `or` and `not`:

```kivo
if coins > 100 and not banned {
    print("Welcome to the VIP room")
}
```

Conditions must be `true` or `false`. KIVO does not guess whether `0`, `""` or `null` count as false — compare explicitly: `if count != 0`, `if name != ""`, `if user != null`.

## 6. Loops

```kivo
for i in 1..3 {
    print(i)          // 1, 2, 3
}

for i in 0..<3 {
    print(i)          // 0, 1, 2
}

let players = ["Hugo", "Alex"]
for player in players {
    print(player)
}

for index, player in players {
    print(index, player)
}

let count = 3
while count > 0 {
    print(count)
    count -= 1
}
```

`break` leaves a loop, `continue` skips to the next round.

## 7. Arrays

```kivo
let users = ["Hugo", "Alex", "Sam"]

print(users[0])          // Hugo
print(len(users))        // 3
users.push("Kim")
print(users.contains("Kim"))

let numbers = [5, 3, 8, 1]
print(numbers.sort())                 // [1, 3, 5, 8]
print(numbers.map(n => n * 10))       // [50, 30, 80, 10]
print(numbers.filter(n => n > 3))     // [5, 8]
print(numbers.sum())                  // 17
```

Reading past the end of an array is an error that tells you the valid indexes — not a silent `undefined`.

## 8. Objects

```kivo
let user = {
    name: "Hugo",
    coins: 500,
    admin: true
}

print(user.name)
user.coins += 100
user.email = "hugo@example.com"

for key, value in user {
    print(key, value)
}
```

Misspelling a property is an error with a suggestion (`Did you mean "name"?`). When a property may be missing, use `?.` and `??`:

```kivo
let city = user?.address?.city ?? "Unknown"
```

Square brackets look up a key that is computed at runtime, and give `null` when it is missing — handy for using objects as dictionaries:

```kivo
let counts = {}
for word in ["a", "b", "a"] {
    counts[word] = (counts[word] ?? 0) + 1
}
print(counts)    // { a: 2, b: 1 }
```

## 9. Errors

```kivo
import fs

try {
    let data = fs.read("data.json")
} catch error {
    print("Could not load:", error.message)
}
```

You can throw any value:

```kivo
throw "Something went wrong"
```

## 10. Imports

Standard modules:

```kivo
import math
import fs

print(math.sqrt(16))
fs.write("hello.txt", "Hi!")
print(fs.read("hello.txt"))
```

Only some names:

```kivo
from json import parse, stringify
```

Your own files — mark what other files may use with `export`:

```kivo
// utils.kivo
export func calculatePrice(value) {
    return value * 1.21
}
```

```kivo
// main.kivo
from "./utils.kivo" import calculatePrice

print(calculatePrice(100))
```

## 11. Classes

```kivo
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
print(player.coins)
```

Fields are declared with `let`. Assigning a field that was never declared is an error, which catches typos like `self.cions`.

## 12. Types (optional)

You never have to write types, but you can — and KIVO checks them:

```kivo
func multiply(a: float, b: float) -> float {
    return a * b
}

let username: string = "Hugo"
let tags: [string] = ["new", "vip"]
let nickname: string? = null      // ? means "or null"
```

Describe the shape of data with `type`, and call the type to validate a value:

```kivo
type User {
    id: int
    username: string
    email?: string
}

let user = User(json.parse(text))   // error if the data has the wrong shape
```

## 13. Async

Operations that wait — network requests, timers — are `async`. Use `await` to get their result:

```kivo
import http

async func loadTodo() {
    let response = await http.get("https://jsonplaceholder.typicode.com/todos/1")
    return response.json()
}

let todo = await loadTodo()
print(todo.title)
```

If you forget `await`, KIVO says so instead of handing you a mysterious "Promise" object.

## Next steps

- [Language reference](language.md)
- [Standard library](stdlib.md)
- [Building web APIs](web.md)
- [Examples](../examples)
