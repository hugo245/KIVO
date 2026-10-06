"use strict";

const path = require("path");
const { spawnSync } = require("child_process");
const core = require("../packages/core/src");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "packages", "cli", "bin", "kivo.js");

let counter = 0;

// Runs KIVO source in-process and returns { output, error }.
async function run(source) {
  const io = core.runtime.io;
  const original = io.write;
  let output = "";
  io.write = (text) => {
    output += text;
  };
  try {
    await core.runSource(source, path.join(ROOT, "tests", `<test-${counter++}>.kivo`));
    return { output, error: null };
  } catch (err) {
    return { output, error: core.formatError(err, { color: false }) };
  } finally {
    io.write = original;
  }
}

// Runs the kivo CLI as a separate process.
function cli(args, options = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "" }, ...options });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

module.exports = { run, cli, ROOT, CLI, core };
