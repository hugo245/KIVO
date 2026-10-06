"use strict";

const { META, MODULE } = require("./values");
const { parseSignature } = require("./signature");

// Defines a function implemented in JavaScript but callable from KIVO.
// `sig` documents it and determines its arity: "read(path: string) -> string"
function native(sig, doc, impl) {
  const { min, max, params } = parseSignature(sig);
  const name = sig.slice(0, sig.indexOf("(")).trim();
  impl[META] = { name, native: true, min, max, params, sig: `func ${sig}`, doc };
  return impl;
}

// Builds a module object: `import math` gives you this.
function defineModule(name, doc, members) {
  const mod = {};
  const docs = {};
  for (const [key, member] of Object.entries(members)) {
    if (member && member.__constant) {
      mod[key] = member.value;
      docs[key] = { kind: "value", sig: `${key}: ${member.type}`, doc: member.doc };
    } else {
      mod[key] = member;
      const meta = typeof member === "function" ? member[META] : null;
      docs[key] = meta ? { kind: "func", sig: meta.sig, doc: meta.doc } : { kind: "value", sig: key, doc: "" };
    }
  }
  Object.defineProperty(mod, MODULE, { value: name });
  Object.defineProperty(mod, "__docs", { value: { name, doc, members: docs } });
  return Object.freeze(mod);
}

function constant(value, type, doc) {
  return { __constant: true, value, type, doc };
}

module.exports = { native, defineModule, constant };
