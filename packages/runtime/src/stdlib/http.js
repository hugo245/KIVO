"use strict";

const { native, defineModule } = require("../native");
const { KivoError, typeError } = require("../errors");
const { describeType, isPlainObject, isBytes } = require("../values");
const { parseJson, stringifyJson } = require("./json");

const DEFAULT_TIMEOUT = 30000;
const MAX_RESPONSE_BYTES = 50 * 1024 * 1024;

function makeResponse(url, res, bodyText) {
  const headers = {};
  res.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return {
    url,
    status: res.status,
    ok: res.ok,
    statusText: res.statusText,
    headers,
    body: bodyText,
    text: native("text() -> string", "The response body as text.", () => bodyText),
    json: native("json() -> any", "Parses the response body as JSON.", () => {
      try {
        return parseJson(bodyText);
      } catch (e) {
        e.message = `The response from ${url} is not valid JSON: ${e.message.replace(/^Invalid JSON/, "").replace(/^: /, "")}`;
        throw e;
      }
    }),
  };
}

function buildUrl(url, query) {
  if (typeof url !== "string") throw typeError(`The URL must be a string, but got ${describeType(url)}.`);
  let u;
  try {
    u = new URL(url);
  } catch {
    throw typeError(`Invalid URL ${JSON.stringify(url)}.`, 'URLs need a scheme and host, like "https://example.com/api".');
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw typeError(`Only http and https URLs are supported, got ${JSON.stringify(u.protocol)}.`);
  if (query !== undefined && query !== null) {
    if (!isPlainObject(query)) throw typeError("options.query must be an object.");
    for (const [k, v] of Object.entries(query)) if (v !== null && v !== undefined) u.searchParams.set(k, String(v));
  }
  return u.toString();
}

async function request(method, url, body, options) {
  options = options || {};
  if (!isPlainObject(options)) throw typeError(`Request options must be an object, but got ${describeType(options)}.`);
  const target = buildUrl(url, options.query);
  const headers = {};
  if (options.headers !== undefined) {
    if (!isPlainObject(options.headers)) throw typeError("options.headers must be an object.");
    for (const [k, v] of Object.entries(options.headers)) headers[k.toLowerCase()] = String(v);
  }
  let payload;
  if (body !== undefined && body !== null) {
    if (typeof body === "string") {
      payload = body;
      if (!headers["content-type"]) headers["content-type"] = "text/plain; charset=utf-8";
    } else if (isBytes(body)) {
      payload = body;
      if (!headers["content-type"]) headers["content-type"] = "application/octet-stream";
    } else {
      payload = stringifyJson(body);
      if (!headers["content-type"]) headers["content-type"] = "application/json";
    }
  }
  const timeout = typeof options.timeout === "number" ? options.timeout : DEFAULT_TIMEOUT;
  let res;
  try {
    res = await fetch(target, { method, headers, body: payload, signal: AbortSignal.timeout(timeout), redirect: options.redirect === false ? "manual" : "follow" });
  } catch (err) {
    if (err && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new KivoError(`The request to ${target} timed out after ${timeout} ms.`, { kind: "HttpError", hint: "Increase the limit with { timeout: 60000 } in the options." });
    }
    const reason = (err && err.cause && (err.cause.code || err.cause.message)) || (err && err.message) || "unknown error";
    throw new KivoError(`Could not connect to ${target} (${reason}).`, { kind: "HttpError", hint: "Check the URL and your network connection." });
  }
  const reader = res.body ? res.body.getReader() : null;
  const chunks = [];
  let size = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_RESPONSE_BYTES) {
        reader.cancel();
        throw new KivoError(`The response from ${target} is larger than ${MAX_RESPONSE_BYTES / 1024 / 1024} MB.`, { kind: "HttpError" });
      }
      chunks.push(value);
    }
  }
  return makeResponse(target, res, Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8"));
}

module.exports = () =>
  defineModule("http", "Make HTTP requests. All functions are async — use them with await.", {
    get: native("get(url: string, options?: object) -> async Response", "Sends a GET request. Options: { headers, query, timeout }.", (url, options) => request("GET", url, null, options)),
    post: native("post(url: string, body?: any, options?: object) -> async Response", "Sends a POST request. Objects are sent as JSON.", (url, body, options) => request("POST", url, body, options)),
    put: native("put(url: string, body?: any, options?: object) -> async Response", "Sends a PUT request. Objects are sent as JSON.", (url, body, options) => request("PUT", url, body, options)),
    patch: native("patch(url: string, body?: any, options?: object) -> async Response", "Sends a PATCH request. Objects are sent as JSON.", (url, body, options) => request("PATCH", url, body, options)),
    delete: native("delete(url: string, options?: object) -> async Response", "Sends a DELETE request.", (url, options) => request("DELETE", url, null, options)),
    request: native("request(options: object) -> async Response", "Sends a request: { method, url, body, headers, query, timeout }.", (options) => {
      if (!isPlainObject(options)) throw typeError("http.request() needs an options object.", '    http.request({ method: "GET", url: "https://example.com" })');
      return request(String(options.method || "GET").toUpperCase(), options.url, options.body, options);
    }),
  });

module.exports.describe = () => {
  const META = Symbol.for("kivo.meta");
  const r = makeResponse("", { status: 200, ok: true, statusText: "OK", headers: new Map() }, "");
  const out = {};
  for (const [k, v] of Object.entries(r)) out[k] = typeof v === "function" ? { kind: "func", sig: v[META].sig, doc: v[META].doc } : { kind: "value", sig: k, doc: { url: "The final URL.", status: "HTTP status code, like 200.", ok: "true when the status is 200-299.", statusText: 'Status text, like "OK".', headers: "Response headers (lowercase names).", body: "The response body as text." }[k] || "" };
  return out;
};
