"use strict";

// Drives `kivo lsp` over stdio like an editor would.

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("child_process");
const { CLI } = require("./helpers");

function client() {
  const proc = spawn(process.execPath, [CLI, "lsp"], { stdio: ["pipe", "pipe", "inherit"] });
  let buffer = Buffer.alloc(0);
  let nextId = 1;
  const pending = new Map();
  const notifications = [];
  const waiters = [];
  proc.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const end = buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      const len = Number(/Content-Length: (\d+)/.exec(buffer.slice(0, end).toString())[1]);
      if (buffer.length < end + 4 + len) return;
      const msg = JSON.parse(buffer.slice(end + 4, end + 4 + len).toString());
      buffer = buffer.slice(end + 4 + len);
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      } else {
        notifications.push(msg);
        waiters.splice(0).forEach((w) => w());
      }
    }
  });
  const write = (msg) => {
    const body = JSON.stringify({ jsonrpc: "2.0", ...msg });
    proc.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  };
  return {
    request(method, params) {
      const id = nextId++;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        write({ id, method, params });
      });
    },
    notify(method, params) {
      write({ method, params });
    },
    async notification(method) {
      while (true) {
        const found = notifications.find((n) => n.method === method);
        if (found) {
          notifications.splice(notifications.indexOf(found), 1);
          return found;
        }
        await new Promise((r) => waiters.push(r));
      }
    },
    proc,
  };
}

test("kivo lsp: diagnostics, completion, hover, formatting", async () => {
  const c = client();
  const init = await c.request("initialize", { capabilities: {} });
  assert.equal(init.result.serverInfo.name, "kivo");
  assert.ok(init.result.capabilities.completionProvider);
  c.notify("initialized", {});

  const uri = "file:///tmp/lsp-test.kivo";
  const text = 'let user = { name: "Hugo" }\nprint(uesr.name)\nprint(user.)\n';
  c.notify("textDocument/didOpen", { textDocument: { uri, languageId: "kivo", version: 1, text } });
  const diag = await c.notification("textDocument/publishDiagnostics");
  assert.equal(diag.params.uri, uri);
  assert.ok(diag.params.diagnostics.length >= 1);
  assert.ok(diag.params.diagnostics.every((d) => d.source === "kivo"));

  const completion = await c.request("textDocument/completion", { textDocument: { uri }, position: { line: 2, character: 11 } });
  assert.deepEqual(completion.result.map((i) => i.label), ["name"]);

  c.notify("textDocument/didChange", { textDocument: { uri, version: 2 }, contentChanges: [{ text: 'let user = { name: "Hugo" }\nprint(uesr.name)\n' }] });
  const diag2 = await c.notification("textDocument/publishDiagnostics");
  assert.equal(diag2.params.diagnostics.length, 1);
  assert.match(diag2.params.diagnostics[0].message, /Unknown variable "uesr"\.\n\nDid you mean "user"\?/);
  assert.deepEqual(diag2.params.diagnostics[0].range, { start: { line: 1, character: 6 }, end: { line: 1, character: 10 } });

  const hover = await c.request("textDocument/hover", { textDocument: { uri }, position: { line: 1, character: 2 } });
  assert.match(hover.result.contents.value, /func print/);

  const uri2 = "file:///tmp/lsp-format.kivo";
  c.notify("textDocument/didOpen", { textDocument: { uri: uri2, languageId: "kivo", version: 1, text: 'if x>5{print("hi")}' } });
  const edits = await c.request("textDocument/formatting", { textDocument: { uri: uri2 }, options: { tabSize: 4, insertSpaces: true } });
  assert.equal(edits.result[0].newText, 'if x > 5 {\n    print("hi")\n}\n');

  const shutdown = await c.request("shutdown", null);
  assert.equal(shutdown.result, null);
  const exited = new Promise((resolve) => c.proc.on("exit", resolve));
  c.notify("exit", null);
  assert.equal(await exited, 0);
});
