"use strict";

// Generates docs/stdlib.md from the signatures and docs in the runtime itself.
// Usage: node scripts/gen-stdlib-docs.js

const fs = require("fs");
const path = require("path");
const info = require("../packages/checker/src/builtin-info");

const lines = [];
// "|" inside a table cell must be escaped, even inside code spans
const cell = (text) => String(text).replace(/\|/g, "\\|");
lines.push("# Standard library reference");
lines.push("");
lines.push("> Generated from the runtime by `node scripts/gen-stdlib-docs.js` — do not edit by hand.");
lines.push("");
lines.push("## Built-in functions");
lines.push("");
lines.push("Available everywhere, no import needed.");
lines.push("");
lines.push("| Function | Description |");
lines.push("| --- | --- |");
for (const [, g] of Object.entries(info.globals)) lines.push(`| \`${cell(g.sig.replace(/^func /, ""))}\` | ${cell(g.doc)} |`);
lines.push("");

const methodSection = (title, table, intro) => {
  lines.push(`## ${title}`);
  lines.push("");
  if (intro) {
    lines.push(intro);
    lines.push("");
  }
  lines.push("| Member | Description |");
  lines.push("| --- | --- |");
  for (const [, m] of Object.entries(table)) lines.push(`| \`${cell(m.sig.replace(/^func /, ""))}\` | ${cell(m.doc)} |`);
  lines.push("");
};
methodSection("String methods", info.valueMethods.string, 'Called on any string: `"hello".upper()`.');
methodSection("Array methods", info.valueMethods.array, "Methods that return arrays (`map`, `filter`, `sort`, `reverse`, `slice`, ...) return new arrays and never change the original. `push`, `pop`, `shift`, `unshift`, `insert`, `remove`, `removeAt` and `clear` change the array in place.");
methodSection("Range methods", info.valueMethods.range, "Ranges are created with `start..end` (inclusive) or `start..<end` (exclusive).");
methodSection("Bytes methods", info.valueMethods.bytes);
methodSection("Error fields", info.valueMethods.error, "Available on the value bound by `catch error`.");

lines.push("## Modules");
lines.push("");
for (const name of Object.keys(info.modules)) lines.push(`- [\`${name}\`](#${name}) — ${info.modules[name].doc}`);
lines.push("");
for (const [name, mod] of Object.entries(info.modules)) {
  lines.push(`### ${name}`);
  lines.push("");
  lines.push(mod.doc);
  lines.push("");
  lines.push("```kivo");
  lines.push(`import ${name}`);
  lines.push("```");
  lines.push("");
  lines.push("| Member | Description |");
  lines.push("| --- | --- |");
  for (const [key, m] of Object.entries(mod.members)) {
    const sig = m.kind === "func" ? m.sig.replace(/^func /, "") : m.sig;
    lines.push(`| \`${cell(name + "." + (sig.startsWith(key) ? sig : key + ": " + sig))}\` | ${cell(m.doc || "")} |`);
  }
  lines.push("");
}

const out = path.join(__dirname, "..", "docs", "stdlib.md");
fs.writeFileSync(out, lines.join("\n") + "\n");
console.log(`wrote ${path.relative(process.cwd(), out)}`);
