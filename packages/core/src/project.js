"use strict";

const fs = require("fs");
const path = require("path");
const { parseToml } = require("./toml");

// Finds the nearest directory containing kivo.toml, starting from `dir`.
function findProjectRoot(dir) {
  let cur = path.resolve(dir);
  while (true) {
    if (fs.existsSync(path.join(cur, "kivo.toml"))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

function readManifest(root) {
  const file = path.join(root, "kivo.toml");
  const config = parseToml(fs.readFileSync(file, "utf8"), file);
  return {
    root,
    file,
    name: (config.project && config.project.name) || path.basename(root),
    version: (config.project && config.project.version) || "0.0.0",
    entry: path.resolve(root, (config.run && config.run.entry) || "src/main.kivo"),
    dependencies: config.dependencies || {},
    raw: config,
  };
}

// Local packages live in <project>/packages/<name>/ (vendored or installed).
function findPackage(name, fromFile) {
  const root = findProjectRoot(path.dirname(fromFile));
  const bases = [];
  if (root) bases.push(path.join(root, "packages"));
  bases.push(path.join(path.dirname(fromFile), "packages"));
  for (const base of bases) {
    const dir = path.join(base, ...name.split("."));
    const candidates = [];
    if (fs.existsSync(path.join(dir, "kivo.toml"))) {
      try {
        const m = readManifest(dir);
        candidates.push(m.entry);
      } catch {
        /* ignore broken manifests here; reported when loaded */
      }
    }
    candidates.push(path.join(dir, "src", "main.kivo"), path.join(dir, "main.kivo"), path.join(dir, "src", "lib.kivo"), dir + ".kivo");
    for (const c of candidates) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

function resolveImport(spec, fromFile) {
  let target = path.resolve(path.dirname(fromFile), spec);
  if (!path.extname(target)) target += ".kivo";
  return target;
}

module.exports = { findProjectRoot, readManifest, findPackage, resolveImport };
