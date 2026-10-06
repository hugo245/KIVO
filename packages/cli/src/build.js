"use strict";

// `kivo build`: compiles a program and every module it imports, and bundles
// them together with the KIVO runtime into one self-contained file that runs
// with plain Node.js — no KIVO installation needed on the target machine.

const fs = require("fs");
const path = require("path");
const { NodeType: N } = require("../../parser/src");
const { findPackage, resolveImport, findProjectRoot, readManifest } = require("../../core/src/project");
const { VERSION } = require("./version");

const RUNTIME_ENTRY = path.resolve(__dirname, "../../runtime/src/index.js");
const TESTING_ENTRY = path.resolve(__dirname, "../../runtime/src/stdlib/testing.js");
const STDLIB = new Set(require("../../runtime/src/stdlib").names);

// Minimal CommonJS bundler for the runtime's own files.
function bundleRuntime() {
  const ids = new Map();
  const order = [];
  const resolveFile = (from, spec) => {
    const base = path.resolve(path.dirname(from), spec);
    for (const candidate of [base, base + ".js", path.join(base, "index.js")]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    throw new Error(`build: cannot resolve ${spec} from ${from}`);
  };
  const visit = (file) => {
    if (ids.has(file)) return ids.get(file);
    const id = order.length;
    ids.set(file, id);
    order.push({ file, code: null });
    let code = fs.readFileSync(file, "utf8");
    code = code.replace(/require\((["'])(\.{1,2}\/[^"']*)\1\)/g, (_, q, spec) => `__kivo_require(${visit(resolveFile(file, spec))})`);
    order[id].code = code;
    return id;
  };
  visit(RUNTIME_ENTRY);
  visit(TESTING_ENTRY);
  const modules = order.map((m, id) => `  ${id}: function (module, exports, require) {\n${m.code}\n  }`).join(",\n");
  return { modules, ids };
}

function collectModules(entry, core) {
  const root = findProjectRoot(path.dirname(entry)) || path.dirname(entry);
  const rel = (abs) => path.relative(root, abs).split(path.sep).join("/");
  const modules = [];
  const seen = new Map();
  const resolveMap = {};
  const packageMap = {};
  let locBase = 0;
  const queue = [entry];
  while (queue.length) {
    const abs = queue.shift();
    if (seen.has(abs)) continue;
    const source = fs.readFileSync(abs, "utf8");
    const result = core.compileToJs(source, abs, locBase);
    const relName = rel(abs);
    const locations = result.locations.map((l) => ({ ...l, file: relName }));
    locBase += locations.length;
    seen.set(abs, relName);
    modules.push({ abs, rel: relName, source, code: result.code, locations });
    for (const s of result.program.body) {
      if (s.type !== N.ImportDeclaration) continue;
      if (s.isPath) {
        const target = resolveImport(s.source, abs);
        resolveMap[`${relName}\0${s.source}`] = rel(target);
        queue.push(target);
      } else if (!STDLIB.has(s.source)) {
        const target = findPackage(s.source, abs);
        if (target) {
          packageMap[`${relName}\0${s.source}`] = rel(target);
          queue.push(target);
        }
      }
    }
  }
  return { root, modules, resolveMap, packageMap, entryRel: rel(entry) };
}

function build(entry, { output = null } = {}) {
  const core = require("../../core/src");
  const { root, modules, resolveMap, packageMap, entryRel } = collectModules(entry, core);
  const runtime = bundleRuntime();
  let name = path.basename(entry, ".kivo");
  const projectRoot = findProjectRoot(path.dirname(entry));
  if (projectRoot) {
    try {
      name = readManifest(projectRoot).name;
    } catch {
      /* fall back to file name */
    }
  }
  const outFile = path.resolve(output || path.join(projectRoot || path.dirname(entry), "dist", `${name}.js`));

  const sources = {};
  const locations = [];
  for (const m of modules) {
    sources[m.rel] = m.source;
    locations.push(...m.locations);
  }
  const compiled = modules.map((m) => `  ${JSON.stringify(m.rel)}: async function ($rt, $B, $exports, $file) {\n${m.code}\n  }`).join(",\n");

  const program = `#!/usr/bin/env node
// Built with KIVO ${VERSION} from ${entryRel}. Run with: node ${path.basename(outFile)}
"use strict";
const __kivo_modules = {
${runtime.modules}
};
const __kivo_cache = {};
function __kivo_require(id) {
  if (__kivo_cache[id]) return __kivo_cache[id].exports;
  const module = { exports: {} };
  __kivo_cache[id] = module;
  __kivo_modules[id](module, module.exports, require);
  return module.exports;
}
const runtime = __kivo_require(${runtime.ids.get(RUNTIME_ENTRY)});
const testing = __kivo_require(${runtime.ids.get(TESTING_ENTRY)});
const { rt, builtins, errors, values } = runtime;
const SOURCES = ${JSON.stringify(sources)};
for (const file of Object.keys(SOURCES)) errors.registerSource(file, SOURCES[file]);
errors.registerLocations(${JSON.stringify(locations)});
const PROGRAM = {
${compiled}
};
const RESOLVE = ${JSON.stringify(resolveMap)};
const PACKAGES = ${JSON.stringify(packageMap)};
const loaded = new Map();
async function load(file) {
  if (loaded.has(file)) return loaded.get(file);
  const exportsObj = {};
  Object.defineProperty(exportsObj, values.MODULE, { value: file.split("/").pop().replace(/\\.kivo$/, "") });
  loaded.set(file, exportsObj);
  await PROGRAM[file](rt, builtins, exportsObj, file);
  return exportsObj;
}
rt.loader = {
  importFile(spec, from, l) {
    const target = RESOLVE[from + "\\0" + spec];
    if (!target) throw rt.fail("Cannot find the file \\"" + spec + "\\".", l, null, "ImportError");
    return load(target);
  },
  importPackage(name, l) {
    const loc = errors.locationOf(l);
    const target = loc && PACKAGES[loc.file + "\\0" + name];
    if (!target) throw rt.fail("Unknown module \\"" + name + "\\".", l, null, "ImportError");
    return load(target);
  },
};
const color = Boolean(process.stderr.isTTY) && !process.env.NO_COLOR;
const fatal = (err) => {
  process.stderr.write(errors.formatRuntimeError(err, { color }) + "\\n");
  process.exit(1);
};
rt.reportFatal = fatal;
process.on("unhandledRejection", fatal);
rt.programArgs.push(...process.argv.slice(2));
load(${JSON.stringify(entryRel)})
  .then(async () => {
    if (testing.registry.tests.length) {
      const r = await testing.runAll(rt, { color });
      if (r.failed) process.exitCode = 1;
    }
  })
  .catch(fatal);
`;
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, program, { mode: 0o755 });
  void root;
  return { output: outFile, size: Buffer.byteLength(program), modules: modules.map((m) => m.abs) };
}

module.exports = { build };
