"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { core, run } = require("./helpers");

// Starts a KIVO web app in-process on a random port.
async function startApp(source) {
  const io = core.runtime.io;
  const write = io.write;
  const writeError = io.writeError;
  const logs = [];
  io.write = (t) => logs.push(t);
  io.writeError = (t) => logs.push(t);
  try {
    const exports = await core.runSource(source, path.join(__dirname, "<web>.kivo"));
    return { port: exports.port, app: exports.app, logs, restore: () => ((io.write = write), (io.writeError = writeError)) };
  } catch (e) {
    io.write = write;
    io.writeError = writeError;
    throw e;
  }
}

const SERVER = `
import web

type NewUser {
    username: string
}

export let app = web.app()
let users = [{ id: 1, name: "Hugo" }]

app.use(func(req, res, next) {
    res.header("x-powered-by-kivo", "yes")
    return next()
})

app.get("/", func(req, res) {
    res.json({ message: "Hello from KIVO" })
})

app.get("/hello/:name", func(req, res) {
    res.json({ message: "Hello {req.params.name}" })
})

app.get("/users", req => users)
app.get("/text", req => "plain text")
app.get("/query", req => { return { page: req.query.page ?? "1" } })

app.post("/users", func(req, res) {
    let input = NewUser(req.body)
    res.status(201).json({ id: 2, name: input.username })
})

app.get("/missing", func(req) {
    throw web.error(404, "No such thing")
})

app.get("/crash", func(req) {
    let x = null
    return x.field
})

app.get("/cookie", func(req, res) {
    res.cookie("session", "abc").json({ seen: req.cookies?.visit ?? null })
})

export let port = await app.listen(0)
`;

test("web framework: routes, params, JSON, errors, middleware", async () => {
  const { port, app, logs, restore } = await startApp(SERVER);
  const base = `http://127.0.0.1:${port}`;
  try {
    let r = await fetch(base + "/");
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { message: "Hello from KIVO" });
    assert.equal(r.headers.get("x-powered-by-kivo"), "yes");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");

    r = await fetch(base + "/hello/Hugo");
    assert.deepEqual(await r.json(), { message: "Hello Hugo" });

    r = await fetch(base + "/users");
    assert.deepEqual(await r.json(), [{ id: 1, name: "Hugo" }]);

    r = await fetch(base + "/text");
    assert.equal(await r.text(), "plain text");
    assert.match(r.headers.get("content-type"), /text\/plain/);

    r = await fetch(base + "/query?page=3");
    assert.deepEqual(await r.json(), { page: "3" });

    r = await fetch(base + "/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "Sam" }) });
    assert.equal(r.status, 201);
    assert.deepEqual(await r.json(), { id: 2, name: "Sam" });

    r = await fetch(base + "/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nope: 1 }) });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /field "username" is missing/);

    r = await fetch(base + "/users", { method: "POST", headers: { "content-type": "application/json" }, body: "{oops" });
    assert.equal(r.status, 400);

    r = await fetch(base + "/missing");
    assert.equal(r.status, 404);
    assert.deepEqual(await r.json(), { error: "No such thing" });

    r = await fetch(base + "/nowhere");
    assert.equal(r.status, 404);

    r = await fetch(base + "/users", { method: "DELETE" });
    assert.equal(r.status, 405);

    r = await fetch(base + "/crash");
    assert.equal(r.status, 500);
    assert.deepEqual(await r.json(), { error: "Internal Server Error" });
    assert.ok(logs.join("").includes('"x" is null, so "field" cannot be accessed.'), "the KIVO error is logged");

    r = await fetch(base + "/cookie", { headers: { cookie: "visit=1" } });
    assert.deepEqual(await r.json(), { seen: "1" });
    assert.match(r.headers.get("set-cookie"), /session=abc; Path=\/; HttpOnly; SameSite=Lax/);

    r = await fetch(base + "/", { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(2 * 1024 * 1024) });
    assert.equal(r.status, 413);
  } finally {
    await app.close();
    restore();
  }
});

test("web framework: static files cannot escape their directory", async () => {
  const dir = path.join(__dirname, "..", "examples", "web-server", "public");
  const { port, app, restore } = await startApp(`import web\nexport let app = web.app()\napp.static("/static", ${JSON.stringify(dir)})\nexport let port = await app.listen(0)\n`);
  try {
    let r = await fetch(`http://127.0.0.1:${port}/static/`);
    assert.equal(r.status, 200);
    assert.match(await r.text(), /Served by KIVO/);
    for (const evil of ["/static/../api.kivo", "/static/..%2fapi.kivo", "/static/%2e%2e/api.kivo", "/static/.hidden"]) {
      r = await fetch(`http://127.0.0.1:${port}${evil}`);
      assert.equal(r.status, 404, evil);
    }
  } finally {
    await app.close();
    restore();
  }
});

test("http client talks to a KIVO server", async () => {
  const { app, restore } = await startApp(`
import web
export let app = web.app()
app.get("/data", req => { items: [1, 2, 3], q: req.query.q ?? null })
app.post("/echo", req => req.body)
export let port = await app.listen(0)
`);
  try {
    const port = app.port;
    const r = await run(`
import http
let res = await http.get("http://127.0.0.1:${port}/data", { query: { q: "kivo" } })
print(res.status, res.ok, res.json().items, res.json().q)
let echo = await http.post("http://127.0.0.1:${port}/echo", { name: "Hugo" })
print(echo.json().name, echo.headers["content-type"])
let missing = await http.get("http://127.0.0.1:${port}/nope")
print(missing.status, missing.ok)
try {
    await http.get("http://127.0.0.1:1/unreachable")
} catch e {
    print(e.kind)
}
`);
    assert.equal(r.error, null, r.error);
    assert.equal(r.output, "200 true [1, 2, 3] kivo\nHugo application/json; charset=utf-8\n404 false\nHttpError\n");
  } finally {
    await app.close();
    restore();
  }
});

