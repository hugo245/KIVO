# Standard library reference

> Generated from the runtime by `node scripts/gen-stdlib-docs.js` — do not edit by hand.

## Built-in functions

Available everywhere, no import needed.

| Function | Description |
| --- | --- |
| `print(...values) -> void` | Prints values to the console, separated by spaces. |
| `len(value: string \| array \| object) -> int` | Number of characters in a string, items in an array, or keys in an object. |
| `type(value) -> string` | Name of the value's type: "string", "number", "bool", "array", "object", "func", "null", or a class name. |
| `string(value) -> string` | Converts any value to text. |
| `number(value: string \| number) -> number` | Converts text to a number. Throws an error if the text is not a number. |
| `int(value: string \| number) -> int` | Converts to a whole number, dropping any fraction. |
| `keys(object: object) -> [string]` | The property names of an object. |
| `values(object: object) -> array` | The property values of an object. |
| `has(object: object, key: string) -> bool` | Returns true if the object has the property key. |
| `remove(object: object, key: string) -> bool` | Removes a property from an object. Returns true if it existed. |
| `range(start: int, end: int, step?: int) -> [int]` | An array of numbers from start up to (not including) end. |
| `assert(condition: bool, message?: string) -> void` | Throws an error if condition is false. |
| `input(prompt?: string) -> string?` | Reads one line of text typed by the user (null at end of input). |
| `isinstance(value, cls: class) -> bool` | Returns true if value is an instance of the class (or a subclass). |

## String methods

Called on any string: `"hello".upper()`.

| Member | Description |
| --- | --- |
| `length: int` | Number of characters. |
| `upper() -> string` | Returns the text in UPPERCASE. |
| `lower() -> string` | Returns the text in lowercase. |
| `trim() -> string` | Removes whitespace from both ends. |
| `trimStart() -> string` | Removes whitespace from the start. |
| `trimEnd() -> string` | Removes whitespace from the end. |
| `split(separator?: string) -> [string]` | Splits the text into an array. Without a separator, splits on whitespace. |
| `lines() -> [string]` | Splits the text into lines. |
| `chars() -> [string]` | Returns an array of the characters in the text. |
| `contains(text: string) -> bool` | Returns true if the text contains the given text. |
| `startsWith(prefix: string) -> bool` | Returns true if the text starts with prefix. |
| `endsWith(suffix: string) -> bool` | Returns true if the text ends with suffix. |
| `indexOf(text: string) -> int` | Position of the first occurrence of text, or -1. |
| `count(text: string) -> int` | Counts how often text occurs. |
| `replace(old: string, new: string) -> string` | Replaces every occurrence of old with new. |
| `replaceFirst(old: string, new: string) -> string` | Replaces the first occurrence of old with new. |
| `slice(start: int, end?: int) -> string` | Part of the text from start up to (not including) end. Negative numbers count from the end. |
| `repeat(times: int) -> string` | Repeats the text. |
| `padStart(length: int, fill?: string) -> string` | Pads the start until the text has the given length. |
| `padEnd(length: int, fill?: string) -> string` | Pads the end until the text has the given length. |
| `reverse() -> string` | Returns the text reversed. |
| `isEmpty() -> bool` | Returns true if the text is "". |
| `isBlank() -> bool` | Returns true if the text is empty or only whitespace. |
| `at(index: int) -> string?` | Character at index, or null if out of range. Negative indexes count from the end. |
| `toNumber() -> number?` | Parses the text as a number, or returns null if it is not a number. |
| `bytes() -> bytes` | Encodes the text as UTF-8 bytes. |

## Array methods

Methods that return arrays (`map`, `filter`, `sort`, `reverse`, `slice`, ...) return new arrays and never change the original. `push`, `pop`, `shift`, `unshift`, `insert`, `remove`, `removeAt` and `clear` change the array in place.

| Member | Description |
| --- | --- |
| `length: int` | Number of items. |
| `push(...items) -> void` | Adds items to the end of the array. |
| `pop() -> any` | Removes and returns the last item (null if empty). |
| `shift() -> any` | Removes and returns the first item (null if empty). |
| `unshift(...items) -> void` | Adds items to the start of the array. |
| `insert(index: int, item) -> void` | Inserts item at index. |
| `removeAt(index: int) -> any` | Removes the item at index and returns it. |
| `remove(item) -> bool` | Removes the first item equal to item. Returns true if something was removed. |
| `clear() -> void` | Removes all items. |
| `contains(item) -> bool` | Returns true if the array contains item. |
| `indexOf(item) -> int` | Index of the first item equal to item, or -1. |
| `join(separator?: string) -> string` | Joins the items into one string. |
| `map(fn: func(item, index)) -> array` | Returns a new array with fn applied to every item. |
| `filter(fn: func(item, index) -> bool) -> array` | Returns the items for which fn returns true. |
| `find(fn: func(item) -> bool) -> any` | Returns the first item for which fn returns true, or null. |
| `findIndex(fn: func(item) -> bool) -> int` | Index of the first item for which fn returns true, or -1. |
| `any(fn: func(item) -> bool) -> bool` | Returns true if fn returns true for at least one item. |
| `all(fn: func(item) -> bool) -> bool` | Returns true if fn returns true for every item. |
| `count(fn?: func(item) -> bool) -> int` | Number of items (for which fn returns true). |
| `each(fn: func(item, index)) -> void` | Calls fn for every item. |
| `reduce(fn: func(total, item), initial) -> any` | Combines all items into one value, starting from initial. |
| `sort(key?: func(item)) -> array` | Returns a sorted copy. Pass a key function (item => item.name) or a compare function ((a, b) => a - b). |
| `reverse() -> array` | Returns a reversed copy. |
| `slice(start: int, end?: int) -> array` | Copy of the items from start up to (not including) end. Negative numbers count from the end. |
| `concat(...arrays) -> array` | Returns a new array with the other arrays appended. |
| `first() -> any` | The first item, or null if empty. |
| `last() -> any` | The last item, or null if empty. |
| `isEmpty() -> bool` | Returns true if the array has no items. |
| `sum() -> number` | Adds up all numbers. |
| `min() -> number?` | Smallest number, or null if empty. |
| `max() -> number?` | Largest number, or null if empty. |
| `average() -> number?` | Average of all numbers, or null if empty. |
| `unique() -> array` | Copy without duplicate items. |
| `flat() -> array` | Flattens one level of nested arrays. |
| `groupBy(key: func(item)) -> object` | Groups items into an object by the (string) key fn returns. |
| `copy() -> array` | Returns a shallow copy. |

## Range methods

Ranges are created with `start..end` (inclusive) or `start..<end` (exclusive).

| Member | Description |
| --- | --- |
| `start: int` | First number. |
| `end: int` | Last number (or the bound, for ..<). |
| `length: int` | How many numbers the range contains. |
| `toArray() -> [int]` | All numbers in the range as an array. |
| `contains(n: number) -> bool` | Returns true if n is in the range. |
| `map(fn: func(n)) -> array` | Applies fn to every number in the range. |
| `filter(fn: func(n) -> bool) -> array` | Numbers in the range for which fn returns true. |
| `each(fn: func(n)) -> void` | Calls fn for every number in the range. |
| `sum() -> number` | Adds up all numbers in the range. |

## Bytes methods

| Member | Description |
| --- | --- |
| `length: int` | Number of bytes. |
| `text(encoding?: string) -> string` | Decodes the bytes as text (default utf8). |
| `hex() -> string` | The bytes as a hexadecimal string. |
| `base64() -> string` | The bytes as a base64 string. |
| `slice(start: int, end?: int) -> bytes` | Part of the bytes. |
| `toArray() -> [int]` | The bytes as an array of numbers. |

## Error fields

Available on the value bound by `catch error`.

| Member | Description |
| --- | --- |
| `message: string` | What went wrong. |
| `kind: string` | The kind of error, like "Error", "TypeError" or "IOError". |
| `value: any` | The value that was thrown. |
| `file: string?` | File where the error happened. |
| `line: int?` | Line where the error happened. |
| `column: int?` | Column where the error happened. |

## Modules

- [`math`](#math) — Mathematical functions and constants.
- [`fs`](#fs) — Read and write files and directories.
- [`path`](#path) — Work with file paths.
- [`json`](#json) — Convert between KIVO values and JSON text.
- [`time`](#time) — Dates, times and waiting.
- [`process`](#process) — Information about the running program.
- [`env`](#env) — Read environment variables and .env files.
- [`random`](#random) — Random numbers and choices (cryptographically secure).
- [`crypto`](#crypto) — Hashing, password storage and secure random values.
- [`http`](#http) — Make HTTP requests. All functions are async — use them with await.
- [`web`](#web) — A small, fast web framework for APIs and websites.
- [`testing`](#testing) — Write automated tests. Run them with: kivo test
- [`database`](#database) — SQL databases with safe, parameterized queries. Currently: SQLite.

### math

Mathematical functions and constants.

```kivo
import math
```

| Member | Description |
| --- | --- |
| `math.pi: float` | The ratio of a circle's circumference to its diameter (3.14159...). |
| `math.e: float` | Euler's number (2.71828...). |
| `math.inf: float` | Positive infinity. |
| `math.floor(x: number) -> number` | Rounds down to a whole number. |
| `math.ceil(x: number) -> number` | Rounds up to a whole number. |
| `math.round(x: number, digits?: int) -> number` | Rounds to the nearest whole number, or to the given number of decimal digits. |
| `math.trunc(x: number) -> number` | Drops the fractional part. |
| `math.abs(x: number) -> number` | Absolute value. |
| `math.sign(x: number) -> number` | -1, 0 or 1 depending on the sign of x. |
| `math.sqrt(x: number) -> number` | Square root. |
| `math.pow(base: number, exponent: number) -> number` | base raised to the power exponent. |
| `math.exp(x: number) -> number` | e raised to the power x. |
| `math.log(x: number, base?: number) -> number` | Natural logarithm, or logarithm with the given base. |
| `math.log10(x: number) -> number` | Base-10 logarithm. |
| `math.sin(x: number) -> number` | Sine (radians). |
| `math.cos(x: number) -> number` | Cosine (radians). |
| `math.tan(x: number) -> number` | Tangent (radians). |
| `math.asin(x: number) -> number` | Arc sine. |
| `math.acos(x: number) -> number` | Arc cosine. |
| `math.atan(x: number) -> number` | Arc tangent. |
| `math.atan2(y: number, x: number) -> number` | Angle of the point (x, y) in radians. |
| `math.min(...values: number) -> number` | The smallest of the given numbers. |
| `math.max(...values: number) -> number` | The largest of the given numbers. |
| `math.clamp(x: number, low: number, high: number) -> number` | Limits x to the range low..high. |
| `math.isNaN(x: number) -> bool` | Returns true if x is not a number (nan). |
| `math.isInteger(x) -> bool` | Returns true if x is a whole number. |

### fs

Read and write files and directories.

```kivo
import fs
```

| Member | Description |
| --- | --- |
| `fs.read(path: string) -> string` | Reads a whole text file (UTF-8). |
| `fs.readBytes(path: string) -> bytes` | Reads a whole file as bytes. |
| `fs.readLines(path: string) -> [string]` | Reads a text file and splits it into lines. |
| `fs.write(path: string, content: string \| bytes) -> void` | Writes a file, replacing it if it exists. |
| `fs.append(path: string, content: string \| bytes) -> void` | Adds content to the end of a file (creating it if needed). |
| `fs.exists(path: string) -> bool` | Returns true if a file or directory exists at path. |
| `fs.isFile(path: string) -> bool` | Returns true if path is a file. |
| `fs.isDir(path: string) -> bool` | Returns true if path is a directory. |
| `fs.list(path?: string) -> [string]` | Names of the files and directories inside a directory. |
| `fs.mkdir(path: string) -> void` | Creates a directory (and any missing parent directories). |
| `fs.remove(path: string) -> void` | Deletes a file or an empty directory. |
| `fs.removeAll(path: string) -> void` | Deletes a directory and everything inside it. Be careful. |
| `fs.copy(from: string, to: string) -> void` | Copies a file. |
| `fs.move(from: string, to: string) -> void` | Moves or renames a file or directory. |
| `fs.size(path: string) -> int` | Size of a file in bytes. |
| `fs.modified(path: string) -> number` | Time the file was last modified (milliseconds since 1970). |

### path

Work with file paths.

```kivo
import path
```

| Member | Description |
| --- | --- |
| `path.join(...parts: string) -> string` | Joins path segments with the right separator. |
| `path.resolve(...parts: string) -> string` | Turns a path into an absolute path. |
| `path.dirname(path: string) -> string` | The directory part of a path. |
| `path.basename(path: string, ext?: string) -> string` | The last part of a path (optionally without the extension). |
| `path.extname(path: string) -> string` | The extension of a path, like ".kivo". |
| `path.normalize(path: string) -> string` | Cleans up .. and . segments. |
| `path.relative(from: string, to: string) -> string` | The relative path from one path to another. |
| `path.isAbsolute(path: string) -> bool` | Returns true if the path is absolute. |
| `path.separator: string` | The path separator of this system ("/" or "\"). |

### json

Convert between KIVO values and JSON text.

```kivo
import json
```

| Member | Description |
| --- | --- |
| `json.parse(text: string) -> any` | Parses JSON text into KIVO values. |
| `json.stringify(value, indent?: int) -> string` | Converts a value to JSON text. |
| `json.pretty(value) -> string` | Converts a value to nicely indented JSON text. |

### time

Dates, times and waiting.

```kivo
import time
```

| Member | Description |
| --- | --- |
| `time.now() -> number` | Current time in milliseconds since 1 January 1970 (UTC). |
| `time.clock() -> number` | High-precision milliseconds, for measuring how long something takes. |
| `time.since(start: number) -> number` | Milliseconds elapsed since a value returned by time.clock(). |
| `time.sleep(ms: number) -> async void` | Waits for the given number of milliseconds. Use with await. |
| `time.iso(time?: number) -> string` | The time as an ISO 8601 string, like "2026-01-31T12:00:00.000Z". |
| `time.date(time?: number) -> object` | The local date and time as an object: { year, month, day, hour, minute, second, weekday }. |
| `time.parse(text: string) -> number` | Parses a date string (like an ISO date) into milliseconds since 1970. |

### process

Information about the running program.

```kivo
import process
```

| Member | Description |
| --- | --- |
| `process.args: [string]` | Command line arguments passed after the script name. |
| `process.platform: string` | Operating system: "linux", "darwin" (macOS) or "win32". |
| `process.pid: int` | The process id. |
| `process.cwd() -> string` | The current working directory. |
| `process.exit(code?: int) -> void` | Stops the program immediately with the given exit code (default 0). |
| `process.run(command: string, args?: [string], options?: object) -> object` | Runs a program and waits for it. Arguments are passed directly (no shell), so they are never interpreted as shell code. Returns { code, stdout, stderr }. |

### env

Read environment variables and .env files.

```kivo
import env
```

| Member | Description |
| --- | --- |
| `env.get(name: string, default?: string) -> string?` | The value of an environment variable, or default (null) if it is not set. |
| `env.require(name: string) -> string` | The value of an environment variable. Throws a clear error if it is not set. |
| `env.has(name: string) -> bool` | Returns true if the environment variable is set. |
| `env.set(name: string, value: string) -> void` | Sets an environment variable for this program. |
| `env.all() -> object` | All environment variables as an object. |
| `env.load(path?: string) -> int` | Loads variables from a .env file (existing variables are kept). Returns how many were loaded. |

### random

Random numbers and choices (cryptographically secure).

```kivo
import random
```

| Member | Description |
| --- | --- |
| `random.int(min: int, max: int) -> int` | A random whole number from min to max (both included). |
| `random.float(min?: number, max?: number) -> float` | A random number from min (default 0) up to max (default 1). |
| `random.bool() -> bool` | Randomly true or false. |
| `random.choice(items: array) -> any` | A random item from the array. |
| `random.shuffle(items: array) -> array` | A shuffled copy of the array. |
| `random.uuid() -> string` | A random UUID (version 4). |

### crypto

Hashing, password storage and secure random values.

```kivo
import crypto
```

| Member | Description |
| --- | --- |
| `crypto.hash(algorithm: string, data: string \| bytes) -> string` | Hex digest of data. Algorithms: "sha256", "sha384", "sha512", "sha1", "md5". |
| `crypto.sha256(data: string \| bytes) -> string` | SHA-256 hex digest. |
| `crypto.sha512(data: string \| bytes) -> string` | SHA-512 hex digest. |
| `crypto.hmac(algorithm: string, key: string \| bytes, data: string \| bytes) -> string` | HMAC hex digest, for signing messages. |
| `crypto.hashPassword(password: string) -> string` | Hashes a password for storage (scrypt with a random salt). |
| `crypto.verifyPassword(password: string, hash: string) -> bool` | Checks a password against a hash from crypto.hashPassword(). |
| `crypto.randomBytes(count: int) -> bytes` | Secure random bytes. |
| `crypto.token(bytes?: int) -> string` | A secure random hex token (default 32 bytes), for session ids and API keys. |
| `crypto.uuid() -> string` | A random UUID (version 4). |
| `crypto.equal(a: string, b: string) -> bool` | Compares two secrets in constant time (prevents timing attacks). |
| `crypto.base64(data: string \| bytes) -> string` | Encodes data as base64. |
| `crypto.fromBase64(text: string) -> bytes` | Decodes base64 text into bytes. |

### http

Make HTTP requests. All functions are async — use them with await.

```kivo
import http
```

| Member | Description |
| --- | --- |
| `http.get(url: string, options?: object) -> async Response` | Sends a GET request. Options: { headers, query, timeout }. |
| `http.post(url: string, body?: any, options?: object) -> async Response` | Sends a POST request. Objects are sent as JSON. |
| `http.put(url: string, body?: any, options?: object) -> async Response` | Sends a PUT request. Objects are sent as JSON. |
| `http.patch(url: string, body?: any, options?: object) -> async Response` | Sends a PATCH request. Objects are sent as JSON. |
| `http.delete(url: string, options?: object) -> async Response` | Sends a DELETE request. |
| `http.request(options: object) -> async Response` | Sends a request: { method, url, body, headers, query, timeout }. |

### web

A small, fast web framework for APIs and websites.

```kivo
import web
```

| Member | Description |
| --- | --- |
| `web.app(options?: object) -> App` | Creates a web application. Options: { bodyLimit (bytes, default 1 MB), log (bool), quiet (bool) }. |
| `web.cors(options?: object) -> func` | CORS middleware: app.use(web.cors()). Options: { origin ("*" or a list), methods, headers, credentials }. |
| `web.error(status: int, message?: string) -> error` | An HTTP error to throw from a handler: throw web.error(404, "User not found") |

### testing

Write automated tests. Run them with: kivo test

```kivo
import testing
```

| Member | Description |
| --- | --- |
| `testing.test(name: string, fn: func) -> void` | Registers a test. It runs after the file has loaded. |
| `testing.equal(actual, expected, message?: string) -> void` | Fails the test unless actual == expected. |
| `testing.notEqual(actual, unexpected, message?: string) -> void` | Fails the test if actual == unexpected. |
| `testing.ok(condition: bool, message?: string) -> void` | Fails the test unless condition is true. |
| `testing.throws(fn: func, contains?: string) -> error` | Fails the test unless fn throws an error (whose message contains the given text). Returns the error. |
| `testing.fail(message?: string) -> void` | Fails the test immediately. |

### database

SQL databases with safe, parameterized queries. Currently: SQLite.

```kivo
import database
```

| Member | Description |
| --- | --- |
| `database.sqlite(path: string) -> Database` | Opens (or creates) a SQLite database file. Use ":memory:" for a temporary in-memory database. |

