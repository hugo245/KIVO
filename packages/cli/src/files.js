"use strict";

const fs = require("fs");
const path = require("path");

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", ".kivo"]);

// Recursively lists .kivo files under dir.
function kivoFiles(dir, { tests = null } = {}) {
  const out = [];
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") && e.name !== ".") continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!IGNORED_DIRS.has(e.name)) walk(full);
      } else if (e.isFile() && e.name.endsWith(".kivo")) {
        const isTest = e.name.endsWith(".test.kivo");
        if (tests === null || tests === isTest) out.push(full);
      }
    }
  };
  walk(dir);
  return out.sort();
}

module.exports = { kivoFiles };
