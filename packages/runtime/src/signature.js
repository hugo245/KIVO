"use strict";

// Parses "name(a: string, b?: int, ...rest) -> type" into arity information.
function parseSignature(sig) {
  const open = sig.indexOf("(");
  const close = sig.lastIndexOf(")");
  const inner = open >= 0 && close > open ? sig.slice(open + 1, close).trim() : "";
  let min = 0;
  let max = 0;
  const params = [];
  if (inner) {
    let depth = 0;
    let cur = "";
    const parts = [];
    for (const ch of inner) {
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      if (ch === ")" || ch === "]" || ch === "}") depth--;
      if (ch === "," && depth === 0) {
        parts.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    if (cur.trim()) parts.push(cur.trim());
    for (const p of parts) {
      const name = p.split(":")[0].trim();
      params.push(name.replace(/[?]$/, ""));
      if (name.startsWith("...")) {
        max = Infinity;
      } else if (name.endsWith("?") || p.includes("=")) {
        max++;
      } else {
        min++;
        max++;
      }
    }
  }
  return { min, max, params };
}

module.exports = { parseSignature };
