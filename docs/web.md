# Web applications with `web`

`web` is KIVO's built-in web framework. It is small on purpose: routes, middleware and responses, with safe defaults.

```kivo
import web

let app = web.app()

app.get("/", func(req, res) {
    res.json({ message: "Hello from KIVO" })
})

app.get("/hello/:name", func(req, res) {
    res.json({ message: "Hello {req.params.name}" })
})

app.listen(3000)
```

## Routes

```kivo
app.get(path, handler)
app.post(path, handler)
app.put(path, handler)
app.patch(path, handler)
app.delete(path, handler)
app.all(path, handler)          // every method
```

- `:name` segments become `req.params.name`: `"/users/:id"`.
- `*` matches the rest of the path: `"/files/*"` → `req.params["*"]`.
- `HEAD` requests are answered by `GET` routes.
- A request to an existing path with the wrong method gets `405`; unknown paths get `404` (`{ "error": "Not found" }`).
- Several handlers can be given; they run in order like middleware: `app.get("/admin", requireLogin, showAdmin)`.

## Two ways to respond

Use `res`:

```kivo
app.get("/users/:id", func(req, res) {
    res.status(200).json(findUser(req.params.id))
})
```

…or simply return a value. Objects and arrays become JSON, strings become text:

```kivo
app.get("/users", req => users)
app.get("/health", req => { ok: true })
app.get("/robots.txt", req => "User-agent: *")
```

### The request

| Field | |
| --- | --- |
| `req.method` | `"GET"`, `"POST"`, ... |
| `req.path` | `"/users/5"` |
| `req.url` | path plus query string |
| `req.params` | route parameters |
| `req.query` | query string values (`?page=2` → `req.query.page == "2"`) |
| `req.headers` | lowercase header names |
| `req.cookies` | cookies sent by the client |
| `req.body` | parsed body: JSON → objects, forms → objects, `text/*` → string, otherwise bytes |
| `req.ip` | client address |

### The response

| Method | |
| --- | --- |
| `res.status(code)` | set the status, returns `res` for chaining |
| `res.header(name, value)` | set a header |
| `res.json(value)` | send JSON |
| `res.text(text)` | send plain text |
| `res.html(html)` | send HTML |
| `res.send(value)` | text, bytes or JSON depending on the value |
| `res.redirect(url, status?)` | redirect (302 by default) |
| `res.cookie(name, value, options?)` | set a cookie — `HttpOnly` and `SameSite=Lax` by default |
| `res.clearCookie(name)` | remove a cookie |
| `await res.file(path)` | send a file |

## Errors

Throw `web.error` to answer with an HTTP error:

```kivo
app.get("/users/:id", func(req) {
    let user = users.find(u => u.id == number(req.params.id))
    if user == null {
        throw web.error(404, "User not found")
    }
    return user
})
```

Any other error becomes a `500 { "error": "Internal Server Error" }` response — the details are **not** sent to the client, but the full KIVO error (file, line, source) is printed in the server's terminal.

## Validating input

Declare the shape you expect with `type` and call it. Invalid input is answered with `400` and a message explaining what is wrong:

```kivo
type NewUser {
    username: string
    age?: int
}

app.post("/users", func(req, res) {
    let input = NewUser(req.body)
    res.status(201).json(createUser(input))
})
```

```
POST /users  {"age": "x"}
400 {"error": "Value does not match type NewUser: field \"username\" is missing."}
```

## Middleware

```kivo
app.use(func(req, res, next) {
    print(req.method, req.path)
    return next()
})

app.use("/admin", func(req, res, next) {
    if req.headers?.authorization != "Bearer secret" {
        throw web.error(401, "Not allowed")
    }
    return next()
})

app.use(web.cors())                          // allow all origins
app.use(web.cors({ origin: ["https://example.com"], credentials: true }))
```

## Static files

```kivo
app.static("./public")                 // served at /
app.static("/assets", "./public")      // served at /assets
```

Paths are resolved inside the directory only: `..`, encoded traversal (`%2e%2e`, `..%2f`) and hidden files (`.env`, `.git`) are never served. Directories serve their `index.html`.

## Options and limits

```kivo
let app = web.app({
    bodyLimit: 1024 * 1024,   // bytes, default 1 MB; larger bodies get 413
    log: true,                // print "GET /path 200 3ms" for every request
    quiet: false              // set true to hide the startup line
})

let port = await app.listen(0)   // 0 picks a free port; listen returns the port
await app.close()
```

Safe defaults: `X-Content-Type-Options: nosniff` on every response, no `X-Powered-By` header, request and header timeouts, a body size limit, JSON parsing that ignores `__proto__` keys, header values that cannot contain line breaks.

## Not yet in 0.1

WebSockets, sessions, multipart file uploads and streaming responses are planned for 0.2. The internals (route matching, request/response objects, middleware chain) are structured so they can be added without changing the API above.
