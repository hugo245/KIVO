"use strict";

const childProcess = require("child_process");
const { native, defineModule, constant } = require("../native");
const { typeError, KivoError } = require("../errors");
const { describeType } = require("../values");

module.exports = (rt) =>
  defineModule("process", "Information about the running program.", {
    args: constant(rt.programArgs, "[string]", "Command line arguments passed after the script name."),
    platform: constant(process.platform, "string", 'Operating system: "linux", "darwin" (macOS) or "win32".'),
    pid: constant(process.pid, "int", "The process id."),
    cwd: native("cwd() -> string", "The current working directory.", () => process.cwd()),
    exit: native("exit(code?: int) -> void", "Stops the program immediately with the given exit code (default 0).", (code = 0) => {
      if (!Number.isInteger(code)) throw typeError("process.exit() needs a whole number.");
      rt.exit(code);
    }),
    run: native(
      "run(command: string, args?: [string], options?: object) -> object",
      "Runs a program and waits for it. Arguments are passed directly (no shell), so they are never interpreted as shell code. Returns { code, stdout, stderr }.",
      (command, args = [], options = {}) => {
        if (typeof command !== "string") throw typeError(`process.run() needs the command as a string, but got ${describeType(command)}.`);
        if (!Array.isArray(args) || args.some((a) => typeof a !== "string")) {
          throw typeError("process.run() arguments must be an array of strings.", '    process.run("git", ["status", "--short"])');
        }
        const r = childProcess.spawnSync(command, args, {
          encoding: "utf8",
          cwd: options && typeof options.cwd === "string" ? options.cwd : undefined,
          input: options && typeof options.input === "string" ? options.input : undefined,
          timeout: options && typeof options.timeout === "number" ? options.timeout : undefined,
          shell: false,
        });
        if (r.error) {
          if (r.error.code === "ENOENT") throw new KivoError(`Cannot run ${JSON.stringify(command)}: program not found.`, { kind: "IOError" });
          throw new KivoError(`Cannot run ${JSON.stringify(command)}: ${r.error.message}`, { kind: "IOError" });
        }
        return { code: r.status === null ? -1 : r.status, stdout: r.stdout, stderr: r.stderr };
      }
    ),
  });
