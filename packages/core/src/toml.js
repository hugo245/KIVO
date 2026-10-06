"use strict";

// A small TOML subset parser for kivo.toml: [sections], key = "string" | number | bool | [array], # comments.
function parseToml(text, file = "kivo.toml") {
  const root = {};
  let section = root;
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = stripComment(raw).trim();
    if (!line) return;
    const header = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line);
    if (header) {
      section = root;
      for (const part of header[1].split(".")) {
        if (!section[part] || typeof section[part] !== "object") section[part] = {};
        section = section[part];
      }
      return;
    }
    const kv = /^([A-Za-z0-9_-]+|"[^"]+")\s*=\s*(.+)$/.exec(line);
    if (!kv) throw new Error(`${file}:${i + 1}: cannot understand "${raw.trim()}"`);
    const key = kv[1].replace(/^"|"$/g, "");
    section[key] = parseValue(kv[2].trim(), file, i + 1);
  });
  return root;
}

function stripComment(line) {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && line[i - 1] !== "\\") inString = !inString;
    if (c === "#" && !inString) return line.slice(0, i);
  }
  return line;
}

function parseValue(v, file, line) {
  if (v.startsWith('"')) {
    try {
      return JSON.parse(v);
    } catch {
      throw new Error(`${file}:${line}: invalid string ${v}`);
    }
  }
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^[+-]?\d[\d_]*(\.\d+)?$/.test(v)) return Number(v.replace(/_/g, ""));
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return splitTop(inner).map((x) => parseValue(x.trim(), file, line));
  }
  if (v.startsWith("{") && v.endsWith("}")) {
    const out = {};
    const inner = v.slice(1, -1).trim();
    if (!inner) return out;
    for (const pair of splitTop(inner)) {
      const m = /^\s*([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(pair);
      if (!m) throw new Error(`${file}:${line}: invalid inline table`);
      out[m[1]] = parseValue(m[2].trim(), file, line);
    }
    return out;
  }
  throw new Error(`${file}:${line}: invalid value ${v}`);
}

function splitTop(s) {
  const out = [];
  let depth = 0;
  let inString = false;
  let cur = "";
  for (const c of s) {
    if (c === '"') inString = !inString;
    if (!inString && (c === "[" || c === "{")) depth++;
    if (!inString && (c === "]" || c === "}")) depth--;
    if (c === "," && depth === 0 && !inString) {
      if (cur.trim()) out.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

module.exports = { parseToml };
