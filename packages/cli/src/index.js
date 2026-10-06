"use strict";

const fs = require("fs");
const path = require("path");
const { VERSION } = require("./version");
const { kivoFiles } = require("./files");
const { painter, useColor, formatDiagnostic, displayPath } = require("../../diagnostics/src");

const color = useColor(process.stdout);
const errColor = useColor(process.stderr);
const c = painter(color);
const ce = painter(errColor);

function out(text = "") {
  process.stdout.write(text + "\n");
}
function err(text = "") {
  process.stderr.write(text + "\n");
}

function header() {
  out(c.bold("KIVO") + " " + c.gray(VERSION));
  out();
}

const HELP = `${c.bold("KIVO")} ${c.gray(VERSION)} — a simple programming language that scales with you

${c.bold("Usage")}
  kivo <file.kivo> [args...]     Run a file
  kivo <command> [options]

${c.bold("Commands")}
  run [file] [args...]   Run a program (defaults to the entry in kivo.toml)
  dev [file]             Run and restart automatically when files change
  check [files...]       Find errors without running anything
  fmt [files...]         Format code (use --check to only report)
  test [files...]        Run *.test.kivo files
  build [file]           Bundle a program into a single runnable file in dist/
  new <name>             Create a new project
  version                Print the version
  help                   Show this help

${c.bold("Examples")}
  kivo hello.kivo
  kivo run server.kivo
  kivo fmt src/
  kivo check
`;

// Resolves the program file: explicit argument, or [run].entry from kivo.toml.
function resolveEntry(arg) {
  if (arg) {
    const file = path.resolve(arg);
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      const core = loadCore();
      const root = core.findProjectRoot(file);
      if (root) return core.readManifest(root).entry;
      const main = path.join(file, "main.kivo");
      if (fs.existsSync(main)) return main;
    }
    if (!fs.existsSync(file)) {
      const withExt = file.endsWith(".kivo") ? null : file + ".kivo";
      if (withExt && fs.existsSync(withExt)) return withExt;
      fail(`Cannot find the file "${arg}".`, `Run it from the directory that contains it, or pass the full path.`);
    }
    return file;
  }
  const core = loadCore();
  const root = core.findProjectRoot(process.cwd());
  if (root) {
    const manifest = core.readManifest(root);
    if (!fs.existsSync(manifest.entry)) fail(`The entry file "${path.relative(process.cwd(), manifest.entry)}" from kivo.toml does not exist.`, `Create it, or change [run] entry in ${path.relative(process.cwd(), manifest.file) || "kivo.toml"}.`);
    return manifest.entry;
  }
  if (fs.existsSync("main.kivo")) return path.resolve("main.kivo");
  fail("No file to run.", "Pass a file:\n\n    kivo run main.kivo\n\nor create a project with a kivo.toml:\n\n    kivo new my-app");
  return null;
}

class CliError extends Error {
  constructor(message, hint) {
    super(message);
    this.hint = hint;
  }
}

function fail(message, hint) {
  throw new CliError(message, hint);
}

let coreModule = null;
function loadCore() {
  if (!coreModule) coreModule = require("../../core/src");
  return coreModule;
}

// ---------------------------------------------------------------- commands

// kivo run [file] [args...]
// Inside a project, arguments that are not a file go to the program:
//   kivo run add "Buy milk"   ->  runs the project entry with ["add", "Buy milk"]
async function cmdRun(args) {
  const core = loadCore();
  let entry;
  let programArgs;
  const first = args[0];
  const looksLikeFile = first !== undefined && first !== "--" && !first.startsWith("-") && (first.endsWith(".kivo") || fs.existsSync(first));
  if (looksLikeFile) {
    entry = resolveEntry(first);
    programArgs = args.slice(1);
  } else if (first === undefined || first === "--" || core.findProjectRoot(process.cwd())) {
    entry = resolveEntry(undefined);
    programArgs = first === "--" ? args.slice(1) : args;
  } else {
    entry = resolveEntry(first); // reports a helpful "cannot find" error
    programArgs = args.slice(1);
  }
  if (programArgs[0] === "--") programArgs = programArgs.slice(1);
  return core.runFile(entry, { args: programArgs, color: errColor });
}

function targetFiles(args) {
  const paths = args.filter((a) => !a.startsWith("--"));
  if (!paths.length) {
    const core = loadCore();
    const root = core.findProjectRoot(process.cwd()) || process.cwd();
    return kivoFiles(root);
  }
  const files = [];
  for (const p of paths) {
    const abs = path.resolve(p);
    if (!fs.existsSync(abs)) fail(`Cannot find "${p}".`);
    if (fs.statSync(abs).isDirectory()) files.push(...kivoFiles(abs));
    else files.push(abs);
  }
  return files;
}

async function cmdCheck(args) {
  const core = loadCore();
  const files = targetFiles(args);
  header();
  if (!files.length) {
    out(c.yellow("No .kivo files found."));
    return 0;
  }
  let errorCount = 0;
  let warningCount = 0;
  const reports = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const { diagnostics } = core.analyze(source, file);
    const errors = diagnostics.filter((d) => d.severity === "error");
    const warnings = diagnostics.filter((d) => d.severity !== "error");
    errorCount += errors.length;
    warningCount += warnings.length;
    if (errors.length) out(`${c.red("✗")} ${displayPath(file)} ${c.gray(`(${errors.length} ${errors.length === 1 ? "error" : "errors"})`)}`);
    else out(`${c.green("✓")} parsed ${displayPath(file)}`);
    for (const d of diagnostics) reports.push(formatDiagnostic(d, source, { color }));
  }
  if (reports.length) {
    out();
    out(reports.join("\n\n" + c.gray("─".repeat(40)) + "\n\n"));
    out();
  }
  if (errorCount) {
    out(c.red(`✗ ${errorCount} ${errorCount === 1 ? "error" : "errors"}`) + (warningCount ? c.yellow(`, ${warningCount} warnings`) : ""));
    return 1;
  }
  out(c.green("✓ no errors") + (warningCount ? c.yellow(` (${warningCount} warnings)`) : ""));
  return 0;
}

async function cmdFmt(args) {
  const { format, FormatterError } = require("../../formatter/src");
  const core = loadCore();
  const checkOnly = args.includes("--check");
  const stdin = args.includes("--stdin");
  if (stdin) {
    const source = fs.readFileSync(0, "utf8");
    try {
      process.stdout.write(format(source));
      return 0;
    } catch (e) {
      err(e.diagnostics ? core.formatError(e, { color: errColor }) : e.message);
      return 1;
    }
  }
  const files = targetFiles(args);
  let changed = 0;
  let failed = 0;
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    let formatted;
    try {
      formatted = format(source, { file });
    } catch (e) {
      failed++;
      if (e instanceof FormatterError) err(`${ce.red("✗")} ${displayPath(file)}: ${e.message}`);
      else if (e.diagnostics) err(e.diagnostics.map((d) => formatDiagnostic(d, source, { color: errColor })).join("\n\n"));
      else throw e;
      continue;
    }
    if (formatted !== source) {
      changed++;
      if (checkOnly) out(`${c.yellow("!")} ${displayPath(file)} is not formatted`);
      else {
        fs.writeFileSync(file, formatted);
        out(`${c.green("✓")} formatted ${displayPath(file)}`);
      }
    }
  }
  if (failed) return 1;
  if (!changed) {
    out(c.green(`✓ ${files.length === 1 ? displayPath(files[0]) + " is" : `all ${files.length} files are`} already formatted`));
    return 0;
  }
  if (checkOnly) {
    out(c.yellow(`${changed} ${changed === 1 ? "file needs" : "files need"} formatting. Run: kivo fmt`));
    return 1;
  }
  return 0;
}

async function cmdTest(args) {
  const core = loadCore();
  let files;
  const explicit = args.filter((a) => !a.startsWith("--"));
  if (explicit.length) {
    files = [];
    for (const p of explicit) {
      const abs = path.resolve(p);
      if (!fs.existsSync(abs)) fail(`Cannot find "${p}".`);
      if (fs.statSync(abs).isDirectory()) files.push(...kivoFiles(abs, { tests: true }));
      else files.push(abs);
    }
  }
  else {
    const root = core.findProjectRoot(process.cwd()) || process.cwd();
    files = kivoFiles(root, { tests: true });
  }
  header();
  if (!files.length) {
    out(c.yellow("No test files found.") + c.gray(" Test files end with .test.kivo"));
    return 0;
  }
  let passed = 0;
  let failedCount = 0;
  core.rt.quiet = true;
  for (const file of files) {
    out(c.bold(displayPath(file)));
    try {
      await core.loadFile(file);
    } catch (e) {
      err(core.formatError(e, { color: errColor }));
      failedCount++;
      continue;
    }
    const r = await core.testing.runAll(core.rt, { color });
    passed += r.passed;
    failedCount += r.failed;
    out();
  }
  const total = passed + failedCount;
  if (failedCount) {
    out(c.red(`✗ ${failedCount} failed`) + c.gray(`, ${passed} passed, ${total} total`));
    return 1;
  }
  out(c.green(`✓ ${passed} passed`) + c.gray(` (${total} total)`));
  return 0;
}

async function cmdDev(args) {
  const { spawn } = require("child_process");
  const entry = resolveEntry(args[0]);
  const core = loadCore();
  const root = core.findProjectRoot(path.dirname(entry)) || path.dirname(entry);
  header();
  let child = null;
  let restarting = false;
  const start = (reason) => {
    if (reason) out(c.cyan(`↻ ${reason}`));
    out(c.gray(`running ${displayPath(entry)}`));
    out();
    child = spawn(process.execPath, [path.join(__dirname, "..", "bin", "kivo.js"), "run", entry, ...args.slice(1)], { stdio: "inherit", env: { ...process.env, FORCE_COLOR: color ? "1" : "" } });
    child.on("exit", (code) => {
      if (!restarting) {
        out();
        out(c.gray(`${code === 0 ? "✓ finished" : "✗ exited with code " + code} — waiting for changes...`));
      }
    });
  };
  let timer = null;
  const changed = (file) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      restarting = true;
      const begin = () => {
        restarting = false;
        start(`${path.relative(root, file) || file} changed, restarting`);
      };
      if (child && child.exitCode === null) {
        child.once("exit", begin);
        child.kill();
      } else begin();
    }, 80);
  };
  try {
    fs.watch(root, { recursive: true }, (event, name) => {
      if (name && name.endsWith(".kivo")) changed(path.join(root, name));
    });
  } catch {
    // recursive watch unsupported: watch known files
    for (const f of kivoFiles(root)) fs.watch(f, () => changed(f));
  }
  start();
  return new Promise(() => {});
}

async function cmdBuild(args) {
  const { build } = require("./build");
  const outIndex = args.indexOf("-o");
  let output = null;
  if (outIndex >= 0) {
    output = args[outIndex + 1];
    args = args.filter((_, i) => i !== outIndex && i !== outIndex + 1);
  }
  const entry = resolveEntry(args[0]);
  header();
  const core = loadCore();
  try {
    const result = build(entry, { output });
    for (const m of result.modules) out(`${c.green("✓")} compiled ${displayPath(m)}`);
    out();
    out(`${c.green("✓")} built ${c.bold(displayPath(result.output))} ${c.gray(`(${(result.size / 1024).toFixed(1)} KB)`)}`);
    out(c.gray(`  run it with: node ${displayPath(result.output)}`));
    return 0;
  } catch (e) {
    if (e.diagnostics) {
      err(core.formatError(e, { color: errColor }));
      return 1;
    }
    throw e;
  }
}

async function cmdNew(args) {
  const name = args[0];
  if (!name) fail("Give the project a name.", "    kivo new my-app");
  if (!/^[A-Za-z0-9_-]+$/.test(name)) fail(`"${name}" is not a valid project name.`, "Use letters, digits, - and _.");
  const dir = path.resolve(name);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) fail(`The directory "${name}" already exists and is not empty.`);
  const files = {
    "kivo.toml": `[project]\nname = "${name}"\nversion = "0.1.0"\n\n[run]\nentry = "src/main.kivo"\n\n[dependencies]\n`,
    "src/main.kivo": `from "./greeting.kivo" import greet\n\nfunc main() {\n    print(greet("World"))\n}\n\nmain()\n`,
    "src/greeting.kivo": `export func greet(name: string) -> string {\n    return "Hello, {name}!"\n}\n`,
    "tests/greeting.test.kivo": `from testing import test, equal\nfrom "../src/greeting.kivo" import greet\n\ntest("greets by name", func() {\n    equal(greet("KIVO"), "Hello, KIVO!")\n})\n`,
    ".gitignore": "dist/\n",
    "README.md": `# ${name}\n\nA KIVO project.\n\n\`\`\`\nkivo run      # run src/main.kivo\nkivo dev      # run and restart on changes\nkivo test     # run tests\nkivo fmt      # format code\n\`\`\`\n`,
  };
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  fs.mkdirSync(path.join(dir, "packages"), { recursive: true });
  header();
  out(`${c.green("✓")} created ${c.bold(name)}/`);
  for (const rel of Object.keys(files)) out(c.gray(`  ${rel}`));
  out();
  out(`Next:\n\n    cd ${name}\n    kivo run`);
  return 0;
}

// ---------------------------------------------------------------- main

const COMMANDS = {
  run: cmdRun,
  dev: cmdDev,
  check: cmdCheck,
  fmt: cmdFmt,
  format: cmdFmt,
  test: cmdTest,
  build: cmdBuild,
  new: cmdNew,
};

async function main(argv) {
  try {
    const [cmd, ...rest] = argv;
    if (!cmd) {
      // inside a project: run it; otherwise show help
      const core = loadCore();
      if (core.findProjectRoot(process.cwd())) return await cmdRun([]);
      out(HELP);
      return 0;
    }
    if (cmd === "help" || cmd === "--help" || cmd === "-h") {
      out(HELP);
      return 0;
    }
    if (cmd === "version" || cmd === "--version" || cmd === "-v") {
      out(`KIVO ${VERSION}`);
      return 0;
    }
    if (COMMANDS[cmd]) return await COMMANDS[cmd](rest);
    if (cmd.endsWith(".kivo") || fs.existsSync(cmd)) return await cmdRun(argv);
    const { suggest } = require("../../diagnostics/src");
    const close = suggest(cmd, Object.keys(COMMANDS).concat(["help", "version"]));
    fail(`Unknown command "${cmd}".`, close ? `Did you mean "kivo ${close}"?` : "Run kivo help to see all commands.");
    return 1;
  } catch (e) {
    if (e instanceof CliError) {
      err(ce.red(ce.bold("KIVO Error")));
      err();
      err(ce.bold(e.message));
      if (e.hint) {
        err();
        err(e.hint);
      }
      return 1;
    }
    throw e;
  }
}

module.exports = { main };
