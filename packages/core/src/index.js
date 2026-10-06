"use strict";

// The KIVO engine: source -> lexer -> parser -> checker -> compiler -> runtime.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { parse, NodeType: N } = require("../../parser/src");
const { check } = require("../../checker/src");
const { compile } = require("../../compiler/src");
const runtime = require("../../runtime/src");
const { KivoCompileError, Diagnostic, formatDiagnostic } = require("../../diagnostics/src");
const { findPackage, resolveImport, findProjectRoot, readManifest } = require("./project");
const testing = require("../../runtime/src/stdlib/testing");

const { rt, builtins, errors, values } = runtime;
const BUILTIN_NAMES = Object.keys(builtins);

function readSource(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (err) {
    throw new KivoCompileError(new Diagnostic({ kind: "import", message: err.code === "ENOENT" ? `Cannot find the file "${file}".` : `Cannot read "${file}": ${err.message}`, file: null }));
  }
}

// ---------------------------------------------------------------- analysis

const exportCache = new Map(); // file -> { mtime, info }

// Describes what a .kivo file exports, for checking imports statically.
function exportInfo(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  const cached = exportCache.get(file);
  if (cached && cached.mtime === stat.mtimeMs) return cached.info;
  let info;
  try {
    const source = fs.readFileSync(file, "utf8");
    const program = parse(source, { file });
    const exports = [];
    for (const s of program.body) {
      if (!s.exported) continue;
      if (s.type === N.FunctionDeclaration) {
        let min = 0;
        let max = 0;
        for (const p of s.params) {
          if (p.rest) {
            max = Infinity;
            break;
          }
          max++;
          if (!p.defaultValue) min++;
        }
        const sig = `${s.async ? "async " : ""}func ${s.name.name}(${s.params.map((p) => (p.rest ? "..." : "") + p.name.name).join(", ")})`;
        exports.push({ name: s.name.name, kind: "func", sig, min, max, loc: s.name.loc, file });
      } else if (s.type === N.VariableDeclaration) {
        const names = s.target.type === N.Identifier ? [s.target.name] : s.target.type === N.ObjectPattern ? s.target.properties.map((p) => p.value.name) : s.target.elements.map((e) => e.name);
        for (const name of names) exports.push({ name, kind: "value", sig: `${s.kind} ${name}`, loc: s.target.loc, file });
      } else {
        exports.push({ name: s.name.name, kind: s.type === N.ClassDeclaration ? "class" : "type", sig: `${s.type === N.ClassDeclaration ? "class" : "type"} ${s.name.name}`, loc: s.name.loc, file });
      }
    }
    info = { exports };
  } catch (err) {
    info = { error: err.diagnostics ? err.diagnostics[0].message + ` (line ${err.diagnostics[0].line})` : err.message, exports: [] };
  }
  exportCache.set(file, { mtime: stat.mtimeMs, info });
  return info;
}

function checkerOptions(file, source) {
  return {
    file,
    source,
    importInfo: file ? (spec) => exportInfo(resolveImport(spec, file)) : null,
    packageExists: file ? (name) => Boolean(findPackage(name, file)) : null,
  };
}

// Parse + check. Returns { program, diagnostics } and never throws for user errors.
function analyze(source, file = null) {
  let program;
  try {
    program = parse(source, { file });
  } catch (err) {
    if (err instanceof KivoCompileError) return { program: null, diagnostics: err.diagnostics };
    throw err;
  }
  const result = check(program, checkerOptions(file, source));
  return { program, diagnostics: result.diagnostics, symbols: result.symbols, references: result.references };
}

// Compiles source to a JavaScript module function. Throws KivoCompileError.
function compileModule(source, file) {
  const { program, diagnostics } = analyze(source, file);
  const errorsOnly = diagnostics.filter((d) => d.severity === "error");
  if (!program || errorsOnly.length) throw new KivoCompileError(errorsOnly.length ? errorsOnly : diagnostics);
  errors.registerSource(file, source);
  const { code, locations } = compile(program, { file, source, locBase: errors.nextLocationBase(), builtinNames: BUILTIN_NAMES });
  errors.registerLocations(locations);
  const wrapped = `(async function ($rt, $B, $exports, $file) {\n${code}\n})`;
  return vm.runInThisContext(wrapped, { filename: file });
}

// Returns the generated JavaScript (for `kivo build` and debugging).
function compileToJs(source, file, locBase = 0) {
  const { program, diagnostics } = analyze(source, file);
  const errorsOnly = diagnostics.filter((d) => d.severity === "error");
  if (!program || errorsOnly.length) throw new KivoCompileError(errorsOnly.length ? errorsOnly : diagnostics);
  return { program, ...compile(program, { file, source, locBase, builtinNames: BUILTIN_NAMES }) };
}

// ---------------------------------------------------------------- loading

const moduleCache = new Map(); // absolute file -> { exports, done }

function moduleLabel(file) {
  return path.basename(file, ".kivo");
}

async function loadFile(file) {
  const abs = path.resolve(file);
  const cached = moduleCache.get(abs);
  if (cached) return cached.exports;
  const source = readSource(abs);
  const fn = compileModule(source, abs);
  const exportsObj = {};
  Object.defineProperty(exportsObj, values.MODULE, { value: moduleLabel(abs) });
  const entry = { exports: exportsObj, done: false };
  moduleCache.set(abs, entry);
  await fn(rt, builtins, exportsObj, abs);
  entry.done = true;
  return exportsObj;
}

const loader = {
  async importFile(spec, fromFile, l) {
    const target = resolveImport(spec, fromFile);
    if (!fs.existsSync(target)) {
      throw rt.fail(`Cannot find the file "${spec}".`, l, `Looked for:\n\n    ${target}`, "ImportError");
    }
    try {
      return await loadFile(target);
    } catch (err) {
      if (err instanceof KivoCompileError) throw err;
      throw err;
    }
  },
  async importPackage(name, l) {
    const loc = errors.locationOf(l);
    const from = loc && loc.file ? loc.file : path.join(process.cwd(), "main.kivo");
    const entry = findPackage(name, from);
    if (!entry) {
      throw rt.fail(`Unknown module "${name}".`, l, `It is not a standard module, and no package named "${name}" was found in the packages/ directory of this project.`, "ImportError");
    }
    return loadFile(entry);
  },
};

rt.loader = loader;

// ---------------------------------------------------------------- reporting

function formatError(err, { color = false } = {}) {
  if (err instanceof KivoCompileError) {
    return err.diagnostics
      .slice(0, 10)
      .map((d) => formatDiagnostic(d, d.file ? safeRead(d.file) : null, { color }))
      .join("\n\n" + (color ? "\x1b[90m" + "─".repeat(40) + "\x1b[0m" : "─".repeat(40)) + "\n\n") + (err.diagnostics.length > 10 ? `\n\n... and ${err.diagnostics.length - 10} more` : "");
  }
  return errors.formatRuntimeError(err, { color });
}

function safeRead(file) {
  if (errors.sources.has(file)) return errors.sources.get(file);
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- running

let fatalHandlersInstalled = false;

function installFatalHandlers(color) {
  if (fatalHandlersInstalled) return;
  fatalHandlersInstalled = true;
  const onFatal = (err) => {
    runtime.io.writeError(formatError(err, { color }) + "\n");
    process.exitCode = 1;
    rt.exit(1);
  };
  process.on("unhandledRejection", onFatal);
  process.on("uncaughtException", onFatal);
  rt.reportFatal = onFatal;
}

// Runs a .kivo file as the program entry point. Resolves to an exit code.
async function runFile(file, { args = [], color = false, quiet = false } = {}) {
  rt.programArgs.length = 0;
  rt.programArgs.push(...args);
  rt.quiet = quiet;
  installFatalHandlers(color);
  try {
    await loadFile(file);
    if (testing.registry.tests.length) {
      const result = await testing.runAll(rt, { color });
      if (result.failed) return 1;
    }
    return 0;
  } catch (err) {
    runtime.io.writeError(formatError(err, { color }) + "\n");
    return 1;
  }
}

// Runs source text directly (used by tests and the REPL-like eval).
async function runSource(source, file = path.join(process.cwd(), "<eval>.kivo")) {
  const fn = compileModule(source, file);
  const exportsObj = {};
  await fn(rt, builtins, exportsObj, file);
  return exportsObj;
}

function resetModules() {
  moduleCache.clear();
  exportCache.clear();
}

module.exports = {
  checkerOptions,
  analyze,
  compileModule,
  compileToJs,
  runFile,
  runSource,
  loadFile,
  formatError,
  resetModules,
  exportInfo,
  findProjectRoot,
  readManifest,
  runtime,
  rt,
  testing,
  BUILTIN_NAMES,
};
