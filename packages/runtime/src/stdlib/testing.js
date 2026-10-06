"use strict";

const { native, defineModule } = require("../native");
const { KivoError, typeError, fromJsError, locationOf, toDiagnostic } = require("../errors");
const { repr, equals, isPromise, describeType } = require("../values");
const { displayPath, painter } = require("../../../diagnostics/src");
const io = require("../io");

// Tests registered with testing.test(). The runtime runs them when the program finishes.
const registry = { tests: [], ran: false };

function failure(message) {
  return new KivoError(message, { kind: "AssertionError" });
}

async function runAll(rt, { color = false } = {}) {
  const c = painter(color);
  const tests = registry.tests.splice(0);
  registry.ran = true;
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    const start = Date.now();
    try {
      let r = rt.core.invoke(t.fn, [], undefined);
      if (isPromise(r)) r = await r;
      passed++;
      io.write(`${c.green("✓")} ${t.name} ${c.gray(`(${Date.now() - start}ms)`)}\n`);
    } catch (err) {
      failed++;
      const e = fromJsError(err);
      io.write(`${c.red("✗")} ${t.name}\n`);
      io.write(`    ${e.message.split("\n").join("\n    ")}\n`);
      const loc = e.loc != null ? locationOf(e.loc) : null;
      if (loc) io.write(c.gray(`    at ${displayPath(loc.file)}:${loc.line}:${loc.column}\n`));
      else void toDiagnostic;
    }
  }
  return { passed, failed, total: tests.length };
}

module.exports = (rt) =>
  defineModule("testing", "Write automated tests. Run them with: kivo test", {
    test: native("test(name: string, fn: func) -> void", "Registers a test. It runs after the file has loaded.", (name, fn) => {
      if (typeof name !== "string") throw typeError(`testing.test() needs a name string, but got ${describeType(name)}.`);
      rt.core.expectFunction(fn, "The test body");
      registry.tests.push({ name, fn });
    }),
    equal: native("equal(actual, expected, message?: string) -> void", "Fails the test unless actual == expected.", (a, b, msg) => {
      if (!equals(a, b)) throw failure(`${msg ? msg + ": " : ""}expected ${repr(b, true)}, but got ${repr(a, true)}`);
    }),
    notEqual: native("notEqual(actual, unexpected, message?: string) -> void", "Fails the test if actual == unexpected.", (a, b, msg) => {
      if (equals(a, b)) throw failure(`${msg ? msg + ": " : ""}expected a value different from ${repr(b, true)}`);
    }),
    ok: native("ok(condition: bool, message?: string) -> void", "Fails the test unless condition is true.", (cnd, msg) => {
      if (cnd !== true) throw failure(msg ? String(msg) : `expected true, but got ${repr(cnd, true)}`);
    }),
    throws: native("throws(fn: func, contains?: string) -> error", "Fails the test unless fn throws an error (whose message contains the given text). Returns the error.", (fn, contains) => {
      rt.core.expectFunction(fn, "testing.throws()'s argument");
      let r;
      try {
        r = rt.core.invoke(fn, [], undefined);
      } catch (err) {
        const e = fromJsError(err);
        if (contains !== undefined && !e.message.includes(String(contains))) {
          throw failure(`expected an error containing ${repr(String(contains), true)}, but the error was ${repr(e.message, true)}`);
        }
        return e;
      }
      if (isPromise(r)) throw failure("testing.throws() got an async function. Use await testing.throwsAsync(fn) instead.");
      throw failure("expected an error, but none was thrown");
    }),
    fail: native("fail(message?: string) -> void", "Fails the test immediately.", (msg) => {
      throw failure(msg === undefined ? "failed" : String(msg));
    }),
  });

module.exports.registry = registry;
module.exports.runAll = runAll;
