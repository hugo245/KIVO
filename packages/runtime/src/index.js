"use strict";

const core = require("./core");
const methods = require("./methods");
const values = require("./values");
const errors = require("./errors");
const types = require("./types");
const { builtins } = require("./builtins");
const stdlib = require("./stdlib");
const io = require("./io");
const { native, defineModule } = require("./native");
const { suggest } = require("../../diagnostics/src");

core._setMethods(methods);
methods._setCore(core);

// The object compiled code receives as `$rt`.
const rt = Object.assign(Object.create(null), core, {
  core,
  io,
  programArgs: [],
  quiet: false,
  // Set by the host (see @kivo/core) to load .kivo files and packages.
  loader: null,

  importModule(name, l) {
    if (stdlib.has(name)) return stdlib.load(name, rt);
    if (rt.loader && rt.loader.importPackage) {
      return rt.loader.importPackage(name, l);
    }
    const close = suggest(name, stdlib.names);
    throw core.fail(`Unknown module "${name}".`, l, close ? `Did you mean "${close}"?` : `Standard modules: ${stdlib.names.join(", ")}`, "ImportError");
  },

  importFile(spec, fromFile, l) {
    if (!rt.loader) throw core.fail(`Cannot import files in this environment.`, l, null, "ImportError");
    return rt.loader.importFile(spec, fromFile, l);
  },

  importMember(mod, name, l) {
    if (Object.prototype.hasOwnProperty.call(mod, name)) return mod[name];
    const label = mod[values.MODULE] || "module";
    const close = suggest(name, Object.keys(mod));
    throw core.fail(`"${label}" has no export named "${name}".`, l, close ? `Did you mean "${close}"?` : `It exports: ${Object.keys(mod).join(", ") || "(nothing)"}`, "ImportError");
  },

  exportLive(exportsObj, name, getter) {
    Object.defineProperty(exportsObj, name, { get: getter, enumerable: true, configurable: false });
  },

  undefinedVariable(name, l) {
    throw core.fail(`"${name}" is not defined.`, l, null, "NameError");
  },

  destructArray(value, count, hasRest, l) {
    if (!Array.isArray(value)) {
      throw core.fail(`Cannot unpack ${values.describeType(value)} into [ ... ].`, l, "Only arrays can be unpacked with let [a, b] = ...", "TypeError");
    }
    if (value.length < count || (!hasRest && value.length > count)) {
      throw core.fail(`Cannot unpack an array of ${value.length} items into ${count} variables.`, l, null, "TypeError");
    }
    return value;
  },

  exit(code) {
    process.exit(code);
  },

  reportFatal(err) {
    io.writeError(errors.formatRuntimeError(err, { color: process.stderr.isTTY && !process.env.NO_COLOR }) + "\n");
    rt.exit(1);
  },
});

module.exports = {
  rt,
  builtins,
  methods,
  values,
  errors,
  types,
  stdlib,
  io,
  native,
  defineModule,
  KivoError: errors.KivoError,
  formatRuntimeError: errors.formatRuntimeError,
};
