"use strict";

const http = require("http");
const fs = require("fs");
const nodePath = require("path");
const { native, defineModule } = require("../native");
const { KivoError, typeError, formatRuntimeError, fromJsError } = require("../errors");
const { describeType, isPlainObject, isBytes, isPromise } = require("../values");
const { stringifyJson } = require("./json");
const io = require("../io");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".pdf": "application/pdf",
  ".wasm": "application/wasm",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
};

const STATUS_TEXT = http.STATUS_CODES;

// `throw web.error(404, "User not found")` inside a handler
function httpError(status, message) {
  if (!Number.isInteger(status) || status < 400 || status > 599) throw typeError("web.error() needs an HTTP error status from 400 to 599.");
  const e = new KivoError(message === undefined ? STATUS_TEXT[status] || "Error" : String(message), { kind: "HttpError" });
  e.status = status;
  e.expose = true;
  return e;
}

function compilePath(path) {
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw typeError(`Route paths must be strings starting with "/", but got ${typeof path === "string" ? JSON.stringify(path) : describeType(path)}.`, '    app.get("/users/:id", handler)');
  }
  const keys = [];
  const pattern = path
    .replace(/\/+$/, "")
    .split("/")
    .map((seg) => {
      if (seg.startsWith(":")) {
        keys.push(seg.slice(1));
        return "([^/]+)";
      }
      if (seg === "*") {
        keys.push("*");
        return "(.*)";
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { keys, regex: new RegExp("^" + (pattern || "") + "/?$") };
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    let v = part.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    try {
      v = decodeURIComponent(v);
    } catch {
      /* keep raw */
    }
    if (k && !Object.prototype.hasOwnProperty.call(out, k)) Object.defineProperty(out, k, { value: v, enumerable: true, writable: true, configurable: true });
  }
  return out;
}

function toObject(searchParams) {
  const out = {};
  for (const [k, v] of searchParams) Object.defineProperty(out, k, { value: v, enumerable: true, writable: true, configurable: true });
  return out;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(httpError(413, `Request body is larger than ${limit} bytes.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseBody(buf, contentType) {
  if (!buf.length) return null;
  const type = (contentType || "").split(";")[0].trim().toLowerCase();
  if (type === "application/json" || type.endsWith("+json")) {
    try {
      return JSON.parse(buf.toString("utf8"), (k, v) => (k === "__proto__" ? undefined : v));
    } catch {
      throw httpError(400, "Request body is not valid JSON.");
    }
  }
  if (type === "application/x-www-form-urlencoded") return toObject(new URLSearchParams(buf.toString("utf8")));
  if (type.startsWith("text/") || type === "") return buf.toString("utf8");
  return buf;
}

function cookieHeader(name, value, opts) {
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) throw typeError(`Invalid cookie name ${JSON.stringify(name)}.`);
  const o = opts || {};
  let s = `${name}=${encodeURIComponent(String(value))}`;
  s += `; Path=${o.path || "/"}`;
  if (typeof o.maxAge === "number") s += `; Max-Age=${Math.floor(o.maxAge)}`;
  if (o.domain) s += `; Domain=${o.domain}`;
  if (o.httpOnly !== false) s += "; HttpOnly";
  if (o.secure) s += "; Secure";
  s += `; SameSite=${o.sameSite || "Lax"}`;
  return s;
}

function createResponse(nodeRes, req, state) {
  const res = {};
  const ensureOpen = () => {
    if (state.sent) throw new KivoError("A response was already sent for this request.", { kind: "HttpError", hint: "Each request gets exactly one response. Use return after sending to stop the handler." });
  };
  const finish = (status, type, body) => {
    ensureOpen();
    state.sent = true;
    res.sent = true;
    nodeRes.statusCode = state.status || status;
    if (type && !nodeRes.getHeader("content-type")) nodeRes.setHeader("content-type", type);
    nodeRes.end(req.method === "HEAD" ? undefined : body);
  };
  Object.assign(res, {
    sent: false,
    status: native("status(code: int) -> Response", "Sets the status code. Returns res so calls can be chained: res.status(201).json(data)", (code) => {
      if (!Number.isInteger(code) || code < 100 || code > 599) throw typeError(`Invalid HTTP status ${JSON.stringify(code)}.`);
      state.status = code;
      return res;
    }),
    header: native("header(name: string, value: string) -> Response", "Sets a response header.", (name, value) => {
      if (typeof name !== "string") throw typeError("Header names must be strings.");
      if (/[\r\n]/.test(String(value))) throw typeError("Header values cannot contain line breaks.");
      nodeRes.setHeader(name, String(value));
      return res;
    }),
    json: native("json(value: any) -> void", "Sends a JSON response.", (value) => finish(200, "application/json; charset=utf-8", stringifyJson(value))),
    text: native("text(text: string) -> void", "Sends a plain text response.", (text) => finish(200, "text/plain; charset=utf-8", typeof text === "string" ? text : String(text))),
    html: native("html(html: string) -> void", "Sends an HTML response.", (html) => {
      if (typeof html !== "string") throw typeError(`res.html() needs a string, but got ${describeType(html)}.`);
      finish(200, "text/html; charset=utf-8", html);
    }),
    send: native("send(value: any) -> void", "Sends text, bytes or JSON depending on the value.", (value) => sendValue(res, value)),
    redirect: native("redirect(url: string, status?: int) -> void", "Redirects to another URL (status 302 by default).", (url, status = 302) => {
      if (typeof url !== "string") throw typeError("res.redirect() needs a URL string.");
      nodeRes.setHeader("location", url);
      state.status = status;
      finish(status, "text/plain; charset=utf-8", `Redirecting to ${url}`);
    }),
    cookie: native("cookie(name: string, value: string, options?: object) -> Response", "Sets a cookie. Options: { maxAge, httpOnly (default true), secure, sameSite (default \"Lax\"), path, domain }.", (name, value, opts) => {
      const prev = nodeRes.getHeader("set-cookie");
      const list = Array.isArray(prev) ? prev : prev ? [prev] : [];
      list.push(cookieHeader(name, value, opts));
      nodeRes.setHeader("set-cookie", list);
      return res;
    }),
    clearCookie: native("clearCookie(name: string) -> Response", "Removes a cookie.", (name) => {
      const prev = nodeRes.getHeader("set-cookie");
      const list = Array.isArray(prev) ? prev : prev ? [prev] : [];
      list.push(cookieHeader(name, "", { maxAge: 0 }));
      nodeRes.setHeader("set-cookie", list);
      return res;
    }),
    file: native("file(path: string) -> async void", "Sends a file.", (path) => sendFile(res, nodeRes, state, path, req)),
  });
  res._finish = finish;
  return res;
}

function sendValue(res, value) {
  if (value === null || value === undefined) return res._finish(204, null, undefined);
  if (typeof value === "string") return res._finish(200, "text/plain; charset=utf-8", value);
  if (isBytes(value)) return res._finish(200, "application/octet-stream", Buffer.from(value));
  return res._finish(200, "application/json; charset=utf-8", stringifyJson(value));
}

function sendFile(res, nodeRes, state, path, req) {
  if (typeof path !== "string") throw typeError("res.file() needs a path string.");
  return new Promise((resolve, reject) => {
    fs.stat(path, (err, st) => {
      if (err || !st.isFile()) {
        reject(httpError(404, "File not found."));
        return;
      }
      if (state.sent) {
        reject(new KivoError("A response was already sent for this request.", { kind: "HttpError" }));
        return;
      }
      state.sent = true;
      res.sent = true;
      nodeRes.statusCode = state.status || 200;
      nodeRes.setHeader("content-type", MIME[nodePath.extname(path).toLowerCase()] || "application/octet-stream");
      nodeRes.setHeader("content-length", st.size);
      if (req.method === "HEAD") {
        nodeRes.end();
        resolve(null);
        return;
      }
      const stream = fs.createReadStream(path);
      stream.on("error", reject);
      stream.on("end", () => resolve(null));
      stream.pipe(nodeRes);
    });
  });
}

function createApp(rt, options) {
  options = options || {};
  if (!isPlainObject(options)) throw typeError("web.app() options must be an object.");
  const bodyLimit = typeof options.bodyLimit === "number" ? options.bodyLimit : 1024 * 1024;
  const log = options.log === true;
  const routes = [];
  const middleware = [];
  let server = null;

  const app = {};

  function addRoute(method, path, handlers) {
    if (!handlers.length) throw typeError(`app.${method.toLowerCase()}() needs a handler function.`, `    app.${method.toLowerCase()}("${typeof path === "string" ? path : "/"}", func(req, res) {\n        res.text("Hello")\n    })`);
    for (const h of handlers) rt.core.expectFunction(h, "A route handler");
    routes.push({ method, path, ...compilePath(path), handlers });
  }

  const route = (method) =>
    native(`${method.toLowerCase()}(path: string, ...handlers: func(req, res)) -> void`, `Handles ${method} requests to path. Use :name for parameters, e.g. "/users/:id". The handler can send with res, or simply return a value (objects become JSON).`, (path, ...handlers) => addRoute(method, path, handlers));

  Object.assign(app, {
    get: route("GET"),
    post: route("POST"),
    put: route("PUT"),
    patch: route("PATCH"),
    delete: route("DELETE"),
    all: native("all(path: string, ...handlers: func(req, res)) -> void", "Handles every HTTP method for path.", (path, ...handlers) => addRoute("*", path, handlers)),
    use: native("use(pathOrHandler, handler?: func(req, res, next)) -> void", "Adds middleware that runs before routes. Call next() to continue.", (a, b) => {
      let prefix = "/";
      let fn = a;
      if (typeof a === "string") {
        prefix = a.replace(/\/+$/, "") || "/";
        fn = b;
      }
      rt.core.expectFunction(fn, "Middleware");
      middleware.push({ prefix, fn });
    }),
    static: native("static(urlPath: string, directory?: string) -> void", 'Serves files from a directory: app.static("/assets", "./public") or app.static("./public").', (a, b) => {
      let prefix = "/";
      let dir = a;
      if (b !== undefined) {
        prefix = a;
        dir = b;
      }
      if (typeof prefix !== "string" || typeof dir !== "string") throw typeError("app.static() needs strings.");
      const root = nodePath.resolve(dir);
      prefix = prefix.replace(/\/+$/, "");
      middleware.push({ prefix: prefix || "/", fn: staticHandler(root, prefix), native: true });
    }),
    listen: native("listen(port?: int, host?: string) -> async int", "Starts the server. Returns the port (useful with port 0).", (port = 3000, host) => {
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw typeError(`Invalid port ${JSON.stringify(port)}.`, "Ports are whole numbers from 0 to 65535, like 3000.");
      return new Promise((resolve) => {
        server = http.createServer((req, res) => handle(req, res));
        server.requestTimeout = 30000;
        server.headersTimeout = 20000;
        server.on("error", (err) => {
          const e =
            err.code === "EADDRINUSE"
              ? new KivoError(`Port ${port} is already in use.`, { kind: "WebError", hint: `Stop the other program using it, or pick another port:\n\n    app.listen(${port + 1})` })
              : err.code === "EACCES"
                ? new KivoError(`No permission to use port ${port}.`, { kind: "WebError", hint: "Ports below 1024 need administrator rights. Use a port like 3000." })
                : fromJsError(err);
          rt.reportFatal(e);
        });
        server.listen(port, host, () => {
          const actual = server.address().port;
          app.port = actual;
          if (options.quiet !== true && !rt.quiet) io.write(`KIVO web server running at http://${host || "localhost"}:${actual}\n`);
          resolve(actual);
        });
      });
    }),
    close: native("close() -> async void", "Stops the server.", () => new Promise((resolve) => (server ? server.close(() => resolve(null)) : resolve(null)))),
    port: null,
  });

  function staticHandler(root, prefix) {
    return (req, res, next, nodeReq, nodeRes, state) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      let rel = req.path.slice(prefix.length) || "/";
      try {
        rel = decodeURIComponent(rel);
      } catch {
        return next();
      }
      if (rel.includes("\0") || rel.split("/").some((seg) => seg.startsWith("."))) return next();
      let file = nodePath.join(root, rel);
      if (file !== root && !file.startsWith(root + nodePath.sep)) return next();
      try {
        if (fs.statSync(file).isDirectory()) file = nodePath.join(file, "index.html");
        if (!fs.statSync(file).isFile()) return next();
      } catch {
        return next();
      }
      return sendFile(res, nodeRes, state, file, req);
    };
  }

  async function runHandler(fn, req, res, next, nodeReq, nodeRes, state) {
    if (fn.length === 6 && !fn[Symbol.for("kivo.meta")]) return fn(req, res, next, nodeReq, nodeRes, state);
    let result = rt.core.invoke(fn, [req, res, next], undefined);
    if (isPromise(result)) result = await result;
    return result;
  }

  async function handle(nodeReq, nodeRes) {
    const started = Date.now();
    const state = { sent: false, status: 0 };
    nodeRes.setHeader("x-content-type-options", "nosniff");
    const url = new URL(nodeReq.url, "http://localhost");
    const req = {
      method: nodeReq.method,
      path: url.pathname,
      url: nodeReq.url,
      query: toObject(url.searchParams),
      params: {},
      headers: { ...nodeReq.headers },
      cookies: parseCookies(nodeReq.headers.cookie),
      body: null,
      ip: nodeReq.socket.remoteAddress || null,
    };
    const res = createResponse(nodeRes, req, state);
    try {
      if (!["GET", "HEAD", "OPTIONS", "DELETE"].includes(nodeReq.method) || nodeReq.headers["content-length"] || nodeReq.headers["transfer-encoding"]) {
        req.body = parseBody(await readBody(nodeReq, bodyLimit), nodeReq.headers["content-type"]);
      }
      const chain = [];
      for (const m of middleware) {
        if (m.prefix === "/" || req.path === m.prefix || req.path.startsWith(m.prefix + "/")) chain.push(m.fn);
      }
      let matched = null;
      let methodMismatch = false;
      for (const r of routes) {
        const m = r.regex.exec(req.path);
        if (!m) continue;
        if (r.method !== "*" && r.method !== req.method && !(req.method === "HEAD" && r.method === "GET")) {
          methodMismatch = true;
          continue;
        }
        matched = r;
        r.keys.forEach((k, i) => {
          let v = m[i + 1];
          try {
            v = decodeURIComponent(v);
          } catch {
            /* keep raw */
          }
          Object.defineProperty(req.params, k, { value: v, enumerable: true, writable: true, configurable: true });
        });
        break;
      }
      if (matched) chain.push(...matched.handlers);
      let index = 0;
      let lastResult = null;
      const next = async () => {
        if (state.sent) return null;
        const fn = chain[index++];
        if (!fn) return null;
        const nextFn = native("next() -> async void", "Continues with the next middleware or route handler.", () => next());
        const r = await runHandler(fn, req, res, nextFn, nodeReq, nodeRes, state);
        if (r !== null && r !== undefined) lastResult = r;
        if (!state.sent && r !== null && r !== undefined) sendValue(res, r);
        return null;
      };
      await next();
      if (!state.sent) {
        if (!matched) {
          state.status = methodMismatch ? 405 : 404;
          res._finish(state.status, "application/json; charset=utf-8", stringifyJson({ error: methodMismatch ? "Method not allowed" : "Not found" }));
        } else if (lastResult === null) {
          io.writeError(`KIVO web: ${req.method} ${matched.path} finished without sending a response (sent 204 No Content).\n`);
          res._finish(204, null, undefined);
        }
      }
    } catch (err) {
      const e = err instanceof KivoError ? err : fromJsError(err);
      if (e.kind === "ValidationError" && !e.status) {
        e.status = 400;
      }
      if (e.status) {
        if (!state.sent) {
          state.status = e.status;
          res._finish(e.status, "application/json; charset=utf-8", stringifyJson({ error: e.message }));
        }
      } else {
        io.writeError(`\n${formatRuntimeError(e, { color: process.stderr.isTTY })}\n\n`);
        if (!state.sent) {
          state.status = 500;
          res._finish(500, "application/json; charset=utf-8", stringifyJson({ error: "Internal Server Error" }));
        } else {
          nodeRes.end();
        }
      }
    }
    if (log) io.write(`${req.method} ${req.path} ${nodeRes.statusCode} ${Date.now() - started}ms\n`);
  }

  return app;
}

function cors(rt, options) {
  options = options || {};
  const origin = options.origin === undefined ? "*" : options.origin;
  const methods = options.methods || "GET,POST,PUT,PATCH,DELETE,OPTIONS";
  const headers = options.headers || "Content-Type,Authorization";
  const fn = (req, res, next, nodeReq, nodeRes, state) => {
    let allow = origin;
    if (Array.isArray(origin)) allow = origin.includes(req.headers.origin) ? req.headers.origin : null;
    if (allow) {
      nodeRes.setHeader("access-control-allow-origin", allow);
      if (allow !== "*") nodeRes.setHeader("vary", "Origin");
      if (options.credentials === true) nodeRes.setHeader("access-control-allow-credentials", "true");
    }
    if (req.method === "OPTIONS") {
      nodeRes.setHeader("access-control-allow-methods", Array.isArray(methods) ? methods.join(",") : methods);
      nodeRes.setHeader("access-control-allow-headers", Array.isArray(headers) ? headers.join(",") : headers);
      state.sent = true;
      nodeRes.statusCode = 204;
      nodeRes.end();
      return null;
    }
    return next();
  };
  return fn;
}

module.exports = (rt) =>
  defineModule("web", "A small, fast web framework for APIs and websites.", {
    app: native("app(options?: object) -> App", "Creates a web application. Options: { bodyLimit (bytes, default 1 MB), log (bool), quiet (bool) }.", (options) => createApp(rt, options)),
    cors: native("cors(options?: object) -> func", 'CORS middleware: app.use(web.cors()). Options: { origin ("*" or a list), methods, headers, credentials }.', (options) => cors(rt, options)),
    error: native("error(status: int, message?: string) -> error", 'An HTTP error to throw from a handler: throw web.error(404, "User not found")', httpError),
  });
