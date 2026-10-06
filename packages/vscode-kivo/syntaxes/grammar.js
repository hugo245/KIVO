"use strict";

// Source of truth for syntaxes/kivo.tmLanguage.json.
// Regenerate with:  node packages/vscode-kivo/syntaxes/grammar.js

const IDENT = "[A-Za-z_][A-Za-z0-9_]*";
const TYPE = "(?:\\[\\s*)*[A-Za-z_][A-Za-z0-9_]*(?:\\s*\\])*\\??(?:\\s*\\|\\s*(?:\\[\\s*)*[A-Za-z_][A-Za-z0-9_]*(?:\\s*\\])*\\??)*";
const BUILTIN_TYPES = "any|string|int|float|number|bool|array|object|bytes|func|range|error|null|void";
const BUILTIN_FUNCTIONS = "print|len|type|string|number|int|keys|values|has|remove|range|assert|input|isinstance";
const MODULES = "math|fs|path|json|time|process|env|random|crypto|http|web|testing|database";

const typeCapture = { patterns: [{ include: "#type-names" }] };

const grammar = {
  $schema: "https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json",
  name: "KIVO",
  scopeName: "source.kivo",
  fileTypes: ["kivo"],
  patterns: [{ include: "#statements" }],
  repository: {
    statements: {
      patterns: [
        { include: "#comments" },
        { include: "#import" },
        { include: "#type-declaration" },
        { include: "#class-declaration" },
        { include: "#function-declaration" },
        { include: "#variable-declaration" },
        { include: "#for-loop" },
        { include: "#catch-clause" },
        { include: "#expression" },
      ],
    },

    expression: {
      patterns: [
        { include: "#comments" },
        { include: "#strings" },
        { include: "#numbers" },
        { include: "#function-expression" },
        { include: "#arrow-parameters" },
        { include: "#keywords" },
        { include: "#constants" },
        { include: "#return-type" },
        { include: "#object-key" },
        { include: "#function-call" },
        { include: "#member" },
        { include: "#operators" },
        { include: "#punctuation" },
        { include: "#identifiers" },
      ],
    },

    comments: {
      patterns: [
        {
          name: "comment.block.kivo",
          begin: "/\\*",
          end: "\\*/",
          beginCaptures: { 0: { name: "punctuation.definition.comment.begin.kivo" } },
          endCaptures: { 0: { name: "punctuation.definition.comment.end.kivo" } },
        },
        {
          name: "comment.line.double-slash.kivo",
          begin: "//",
          end: "$",
          beginCaptures: { 0: { name: "punctuation.definition.comment.kivo" } },
        },
      ],
    },

    strings: {
      patterns: [
        {
          name: "string.quoted.triple.kivo",
          begin: '"""',
          end: '"""',
          beginCaptures: { 0: { name: "punctuation.definition.string.begin.kivo" } },
          endCaptures: { 0: { name: "punctuation.definition.string.end.kivo" } },
          patterns: [{ include: "#string-escape" }, { include: "#interpolation" }],
        },
        {
          name: "string.quoted.double.kivo",
          begin: '"',
          end: '"|$',
          beginCaptures: { 0: { name: "punctuation.definition.string.begin.kivo" } },
          endCaptures: { 0: { name: "punctuation.definition.string.end.kivo" } },
          patterns: [{ include: "#string-escape" }, { include: "#interpolation" }],
        },
      ],
    },

    "string-escape": {
      patterns: [
        { name: "constant.character.escape.kivo", match: '\\\\(?:[ntr0\\\\"{}]|u\\{[0-9a-fA-F]{1,6}\\}|u[0-9a-fA-F]{4})' },
        { name: "invalid.illegal.escape.kivo", match: "\\\\." },
      ],
    },

    interpolation: {
      name: "meta.interpolation.kivo",
      begin: "\\{",
      end: "\\}",
      beginCaptures: { 0: { name: "punctuation.section.interpolation.begin.kivo" } },
      endCaptures: { 0: { name: "punctuation.section.interpolation.end.kivo" } },
      contentName: "meta.embedded.line.kivo source.kivo",
      patterns: [{ include: "#interpolation-braces" }, { include: "#expression" }],
    },

    "interpolation-braces": {
      begin: "\\{",
      end: "\\}",
      beginCaptures: { 0: { name: "punctuation.definition.block.kivo" } },
      endCaptures: { 0: { name: "punctuation.definition.block.kivo" } },
      patterns: [{ include: "#interpolation-braces" }, { include: "#expression" }],
    },

    numbers: {
      patterns: [
        { name: "constant.numeric.hex.kivo", match: "\\b0[xX][0-9a-fA-F_]+\\b" },
        { name: "constant.numeric.binary.kivo", match: "\\b0[bB][01_]+\\b" },
        { name: "constant.numeric.octal.kivo", match: "\\b0[oO][0-7_]+\\b" },
        { name: "constant.numeric.decimal.kivo", match: "\\b\\d[\\d_]*(?:\\.\\d[\\d_]*)?(?:[eE][+-]?\\d+)?\\b" },
      ],
    },

    import: {
      patterns: [
        {
          name: "meta.import.kivo",
          match: `^\\s*(import)\\s+(${IDENT}(?:\\.${IDENT})*)(?:\\s+(as)\\s+(${IDENT}))?`,
          captures: {
            1: { name: "keyword.control.import.kivo" },
            2: { name: "entity.name.namespace.kivo" },
            3: { name: "keyword.control.as.kivo" },
            4: { name: "entity.name.namespace.kivo" },
          },
        },
        {
          name: "meta.import.kivo",
          begin: `^\\s*(import)\\s+(?=")`,
          end: "$",
          beginCaptures: { 1: { name: "keyword.control.import.kivo" } },
          patterns: [
            { include: "#strings" },
            { match: `\\b(as)\\s+(${IDENT})`, captures: { 1: { name: "keyword.control.as.kivo" }, 2: { name: "entity.name.namespace.kivo" } } },
            { include: "#comments" },
          ],
        },
        {
          name: "meta.import.kivo",
          begin: "^\\s*(from)\\b",
          end: "$",
          beginCaptures: { 1: { name: "keyword.control.import.kivo" } },
          patterns: [
            { include: "#comments" },
            { include: "#strings" },
            { match: "\\b(import|as)\\b", name: "keyword.control.import.kivo" },
            { match: `(?<=from\\s)\\s*(${IDENT}(?:\\.${IDENT})*)`, captures: { 1: { name: "entity.name.namespace.kivo" } } },
            { match: `\\b${IDENT}\\b`, name: "variable.other.readwrite.alias.kivo" },
            { match: ",", name: "punctuation.separator.comma.kivo" },
          ],
        },
      ],
    },

    "type-declaration": {
      name: "meta.type.declaration.kivo",
      begin: `^\\s*(?:(export)\\s+)?(type)\\s+(${IDENT})\\s*(\\{)`,
      end: "\\}",
      beginCaptures: {
        1: { name: "storage.modifier.export.kivo" },
        2: { name: "storage.type.type.kivo" },
        3: { name: "entity.name.type.kivo" },
        4: { name: "punctuation.definition.block.kivo" },
      },
      endCaptures: { 0: { name: "punctuation.definition.block.kivo" } },
      patterns: [
        { include: "#comments" },
        {
          match: `\\b(${IDENT})(\\?)?\\s*(:)\\s*(${TYPE})`,
          captures: {
            1: { name: "variable.other.property.kivo" },
            2: { name: "keyword.operator.optional.kivo" },
            3: { name: "punctuation.separator.type.kivo" },
            4: typeCapture,
          },
        },
        { match: ",", name: "punctuation.separator.comma.kivo" },
      ],
    },

    "class-declaration": {
      match: `\\b(?:(export)\\s+)?(class)\\s+(${IDENT})(?:\\s+(extends)\\s+(${IDENT}))?`,
      captures: {
        1: { name: "storage.modifier.export.kivo" },
        2: { name: "storage.type.class.kivo" },
        3: { name: "entity.name.type.class.kivo" },
        4: { name: "storage.modifier.extends.kivo" },
        5: { name: "entity.other.inherited-class.kivo" },
      },
    },

    "function-declaration": {
      name: "meta.function.kivo",
      begin: `\\b(?:(export)\\s+)?(?:(async)\\s+)?(func)\\s+(${IDENT})\\s*(\\()`,
      end: "\\)",
      beginCaptures: {
        1: { name: "storage.modifier.export.kivo" },
        2: { name: "storage.modifier.async.kivo" },
        3: { name: "storage.type.function.kivo" },
        4: { name: "entity.name.function.kivo" },
        5: { name: "punctuation.definition.parameters.begin.kivo" },
      },
      endCaptures: { 0: { name: "punctuation.definition.parameters.end.kivo" } },
      patterns: [{ include: "#parameters" }],
    },

    "function-expression": {
      name: "meta.function.expression.kivo",
      begin: `\\b(?:(async)\\s+)?(func)\\s*(${IDENT})?\\s*(\\()`,
      end: "\\)",
      beginCaptures: {
        1: { name: "storage.modifier.async.kivo" },
        2: { name: "storage.type.function.kivo" },
        3: { name: "entity.name.function.kivo" },
        4: { name: "punctuation.definition.parameters.begin.kivo" },
      },
      endCaptures: { 0: { name: "punctuation.definition.parameters.end.kivo" } },
      patterns: [{ include: "#parameters" }],
    },

    parameters: {
      patterns: [
        { include: "#comments" },
        {
          match: `(\\.\\.\\.)?\\b(${IDENT})\\b(?:\\s*(:)\\s*(${TYPE}))?`,
          captures: {
            1: { name: "keyword.operator.spread.kivo" },
            2: { name: "variable.parameter.kivo" },
            3: { name: "punctuation.separator.type.kivo" },
            4: typeCapture,
          },
        },
        {
          begin: "=",
          end: "(?=[,)])",
          beginCaptures: { 0: { name: "keyword.operator.assignment.kivo" } },
          patterns: [{ include: "#expression" }],
        },
        { match: ",", name: "punctuation.separator.parameter.kivo" },
      ],
    },

    "arrow-parameters": {
      patterns: [
        {
          match: `(?:\\b(async)\\s+)?\\b(${IDENT})\\s*(=>)`,
          captures: {
            1: { name: "storage.modifier.async.kivo" },
            2: { name: "variable.parameter.kivo" },
            3: { name: "storage.type.function.arrow.kivo" },
          },
        },
        {
          // (a, b) => ...
          begin: `(\\()(?=[^()]*\\)\\s*=>)`,
          end: "(\\))\\s*(=>)",
          beginCaptures: { 1: { name: "punctuation.definition.parameters.begin.kivo" } },
          endCaptures: { 1: { name: "punctuation.definition.parameters.end.kivo" }, 2: { name: "storage.type.function.arrow.kivo" } },
          patterns: [{ include: "#parameters" }],
        },
      ],
    },

    "return-type": {
      match: `(->)\\s*(${TYPE})`,
      captures: {
        1: { name: "keyword.operator.arrow.return-type.kivo" },
        2: typeCapture,
      },
    },

    "variable-declaration": {
      patterns: [
        {
          match: `\\b(?:(export)\\s+)?(const)\\s+(${IDENT})(?:\\s*(:)\\s*(${TYPE}))?`,
          captures: {
            1: { name: "storage.modifier.export.kivo" },
            2: { name: "storage.type.const.kivo" },
            3: { name: "variable.other.constant.kivo" },
            4: { name: "punctuation.separator.type.kivo" },
            5: typeCapture,
          },
        },
        {
          match: `\\b(?:(export)\\s+)?(let)\\s+(${IDENT})(?:\\s*(:)\\s*(${TYPE}))?`,
          captures: {
            1: { name: "storage.modifier.export.kivo" },
            2: { name: "storage.type.let.kivo" },
            3: { name: "variable.other.readwrite.kivo" },
            4: { name: "punctuation.separator.type.kivo" },
            5: typeCapture,
          },
        },
        {
          match: "\\b(?:(export)\\s+)?(let|const)\\b",
          captures: { 1: { name: "storage.modifier.export.kivo" }, 2: { name: "storage.type.kivo" } },
        },
      ],
    },

    "for-loop": {
      match: `\\b(for)\\s+(${IDENT})(?:\\s*(,)\\s*(${IDENT}))?\\s+(in)\\b`,
      captures: {
        1: { name: "keyword.control.loop.kivo" },
        2: { name: "variable.other.readwrite.kivo" },
        3: { name: "punctuation.separator.comma.kivo" },
        4: { name: "variable.other.readwrite.kivo" },
        5: { name: "keyword.control.loop.kivo" },
      },
    },

    "catch-clause": {
      match: `\\b(catch)\\s+(${IDENT})\\b`,
      captures: {
        1: { name: "keyword.control.trycatch.kivo" },
        2: { name: "variable.parameter.kivo" },
      },
    },

    keywords: {
      patterns: [
        { name: "keyword.control.conditional.kivo", match: "\\b(if|else)\\b" },
        { name: "keyword.control.loop.kivo", match: "\\b(for|in|while|break|continue)\\b" },
        { name: "keyword.control.flow.kivo", match: "\\b(return|await)\\b" },
        { name: "keyword.control.trycatch.kivo", match: "\\b(try|catch|finally|throw)\\b" },
        { name: "keyword.control.import.kivo", match: "\\b(import|from|as)\\b" },
        { name: "storage.modifier.kivo", match: "\\b(export|async|extends)\\b" },
        { name: "storage.type.kivo", match: "\\b(let|const|func|class)\\b" },
        { name: "keyword.operator.logical.kivo", match: "\\b(and|or|not)\\b" },
        { name: "variable.language.self.kivo", match: "\\bself\\b" },
        { name: "variable.language.super.kivo", match: "\\bsuper\\b" },
      ],
    },

    constants: {
      patterns: [
        { name: "constant.language.boolean.kivo", match: "\\b(true|false)\\b" },
        { name: "constant.language.null.kivo", match: "\\bnull\\b" },
      ],
    },

    "object-key": {
      patterns: [
        {
          // { name: value } — an identifier followed by a single colon
          match: `(?<=[{,]|^)\\s*(${IDENT})\\s*(:)(?!:)`,
          captures: {
            1: { name: "meta.object-literal.key.kivo variable.other.property.kivo" },
            2: { name: "punctuation.separator.key-value.kivo" },
          },
        },
      ],
    },

    "function-call": {
      patterns: [
        {
          match: `\\b(${BUILTIN_FUNCTIONS})\\b(?=\\s*\\()`,
          name: "support.function.builtin.kivo",
        },
        {
          match: `(\\??\\.)\\s*(${IDENT})(?=\\s*\\()`,
          captures: {
            1: { name: "punctuation.accessor.kivo" },
            2: { name: "entity.name.function.member.kivo" },
          },
        },
        {
          match: "\\b([A-Z][A-Za-z0-9_]*)(?=\\s*\\()",
          name: "entity.name.type.class.kivo",
        },
        {
          match: `\\b(${IDENT})(?=\\s*\\()`,
          name: "entity.name.function.call.kivo",
        },
      ],
    },

    member: {
      patterns: [
        {
          match: `(\\??\\.)\\s*(${IDENT})`,
          captures: {
            1: { name: "punctuation.accessor.kivo" },
            2: { name: "variable.other.property.kivo" },
          },
        },
      ],
    },

    operators: {
      patterns: [
        { name: "keyword.operator.spread.kivo", match: "\\.\\.\\." },
        { name: "keyword.operator.range.kivo", match: "\\.\\.<?" },
        { name: "storage.type.function.arrow.kivo", match: "=>" },
        { name: "keyword.operator.arrow.kivo", match: "->" },
        { name: "keyword.operator.nullish.kivo", match: "\\?\\?" },
        { name: "punctuation.accessor.optional.kivo", match: "\\?\\." },
        { name: "keyword.operator.comparison.kivo", match: "==|!=|<=|>=|<|>" },
        { name: "keyword.operator.assignment.compound.kivo", match: "\\+=|-=|\\*=|/=|%=" },
        { name: "keyword.operator.assignment.kivo", match: "=" },
        { name: "keyword.operator.arithmetic.kivo", match: "[+\\-*/%]" },
        { name: "keyword.operator.optional.kivo", match: "\\?" },
        { name: "invalid.illegal.operator.kivo", match: "&&|\\|\\||!(?!=)" },
      ],
    },

    punctuation: {
      patterns: [
        { name: "punctuation.separator.comma.kivo", match: "," },
        { name: "punctuation.terminator.statement.kivo", match: ";" },
        { name: "punctuation.separator.colon.kivo", match: ":" },
        { name: "punctuation.definition.block.kivo", match: "[{}]" },
        { name: "meta.brace.round.kivo", match: "[()]" },
        { name: "meta.brace.square.kivo", match: "[\\[\\]]" },
      ],
    },

    identifiers: {
      patterns: [
        { name: "entity.name.namespace.kivo", match: `\\b(${MODULES})\\b(?=\\s*\\.)` },
        { name: "variable.other.constant.kivo", match: "\\b[A-Z][A-Z0-9_]+\\b" },
        { name: "entity.name.type.kivo", match: "\\b[A-Z][A-Za-z0-9_]*\\b" },
        { name: "variable.other.readwrite.kivo", match: `\\b${IDENT}\\b` },
      ],
    },

    "type-names": {
      patterns: [
        { name: "support.type.primitive.kivo", match: `\\b(${BUILTIN_TYPES})\\b` },
        { name: "entity.name.type.kivo", match: `\\b${IDENT}\\b` },
        { name: "keyword.operator.type.kivo", match: "[?|]" },
        { name: "meta.brace.square.kivo", match: "[\\[\\]]" },
      ],
    },
  },
};

if (require.main === module) {
  const fs = require("fs");
  const path = require("path");
  fs.writeFileSync(path.join(__dirname, "kivo.tmLanguage.json"), JSON.stringify(grammar, null, 2) + "\n");
  console.log("wrote syntaxes/kivo.tmLanguage.json");
}

module.exports = grammar;
