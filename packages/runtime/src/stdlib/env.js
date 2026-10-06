"use strict";

const fs = require("fs");
const { native, defineModule } = require("../native");
const { typeError, KivoError } = require("../errors");
const { describeType } = require("../values");

function name(v) {
  if (typeof v !== "string") throw typeError(`Environment variable names must be strings, but got ${describeType(v)}.`);
  return v;
}

// Minimal .env parser: KEY=value, # comments, optional quotes.
function parseDotEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, "\n").replace(/\\"/g, '"');
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    out[m[1]] = value;
  }
  return out;
}

module.exports = () =>
  defineModule("env", "Read environment variables and .env files.", {
    get: native("get(name: string, default?: string) -> string?", "The value of an environment variable, or default (null) if it is not set.", (n, def = null) => {
      const v = process.env[name(n)];
      return v === undefined ? def : v;
    }),
    require: native("require(name: string) -> string", "The value of an environment variable. Throws a clear error if it is not set.", (n) => {
      const v = process.env[name(n)];
      if (v === undefined || v === "") {
        throw new KivoError(`The environment variable ${n} is not set.`, { kind: "ConfigError", hint: `Set it before starting the program:\n\n    ${n}=value kivo run main.kivo\n\nor put it in a .env file and call env.load().` });
      }
      return v;
    }),
    has: native("has(name: string) -> bool", "Returns true if the environment variable is set.", (n) => process.env[name(n)] !== undefined),
    set: native("set(name: string, value: string) -> void", "Sets an environment variable for this program.", (n, v) => {
      if (typeof v !== "string") throw typeError(`env.set() needs a string value, but got ${describeType(v)}.`);
      process.env[name(n)] = v;
    }),
    all: native("all() -> object", "All environment variables as an object.", () => ({ ...process.env })),
    load: native("load(path?: string) -> int", "Loads variables from a .env file (existing variables are kept). Returns how many were loaded.", (path = ".env") => {
      if (typeof path !== "string") throw typeError("env.load() needs a path string.");
      if (!fs.existsSync(path)) return 0;
      const values = parseDotEnv(fs.readFileSync(path, "utf8"));
      let n = 0;
      for (const [k, v] of Object.entries(values)) {
        if (process.env[k] === undefined) {
          process.env[k] = v;
          n++;
        }
      }
      return n;
    }),
  });

module.exports.parseDotEnv = parseDotEnv;
