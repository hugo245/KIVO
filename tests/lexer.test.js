"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { tokenize, TokenType: T } = require("../packages/lexer/src");

const types = (src) => tokenize(src).tokens.map((t) => t.type);

test("recognizes keywords, names and literals", () => {
  assert.deepEqual(types("let name = \"Hugo\""), [T.LET, T.IDENTIFIER, T.EQUAL, T.STRING, T.EOF]);
  assert.deepEqual(types("const pi = 3.14"), [T.CONST, T.IDENTIFIER, T.EQUAL, T.NUMBER, T.EOF]);
  assert.deepEqual(types("true false null"), [T.TRUE, T.FALSE, T.NULL, T.EOF]);
  const kw = "func if else for in while return import from export class async await try catch throw";
  assert.deepEqual(types(kw).slice(0, -1), [T.FUNC, T.IF, T.ELSE, T.FOR, T.IN, T.WHILE, T.RETURN, T.IMPORT, T.FROM, T.EXPORT, T.CLASS, T.ASYNC, T.AWAIT, T.TRY, T.CATCH, T.THROW]);
});

test("recognizes operators and punctuation", () => {
  assert.deepEqual(types("+ - * / == != > < >= <= ( ) { } [ ] , . : .. -> => ?. ??").slice(0, -1), [
    T.PLUS, T.MINUS, T.STAR, T.SLASH, T.EQUAL_EQUAL, T.NOT_EQUAL, T.GREATER_THAN, T.LESS_THAN, T.GREATER_EQUAL, T.LESS_EQUAL,
    T.LEFT_PAREN, T.RIGHT_PAREN, T.LEFT_BRACE, T.RIGHT_BRACE, T.LEFT_BRACKET, T.RIGHT_BRACKET, T.COMMA, T.DOT, T.COLON,
    T.RANGE, T.ARROW, T.FAT_ARROW, T.QUESTION_DOT, T.QUESTION_QUESTION,
  ]);
});

test("ranges are not confused with decimals", () => {
  const { tokens } = tokenize("1..3 1.5 0..<10");
  assert.deepEqual(tokens.map((t) => t.type).slice(0, -1), [T.NUMBER, T.RANGE, T.NUMBER, T.NUMBER, T.NUMBER, T.RANGE_EXCLUSIVE, T.NUMBER]);
  assert.equal(tokens[3].value, 1.5);
});

test("numbers support underscores, hex and binary", () => {
  const { tokens } = tokenize("1_000 0xff 0b101 2e3");
  assert.deepEqual(tokens.slice(0, 4).map((t) => t.value), [1000, 255, 5, 2000]);
});

test("strings carry interpolation parts with real tokens", () => {
  const { tokens } = tokenize('"Hello {user.name}!"');
  const parts = tokens[0].parts;
  assert.equal(parts.length, 3);
  assert.equal(parts[0].value, "Hello ");
  assert.deepEqual(parts[1].tokens.map((t) => t.type), [T.IDENTIFIER, T.DOT, T.IDENTIFIER]);
  assert.equal(parts[1].tokens[0].column, 9);
  assert.equal(parts[2].value, "!");
});

test("escapes and literal braces", () => {
  const { tokens } = tokenize('"a\\tb \\{x} \\u00e9"');
  assert.equal(tokens[0].value, "a\tb {x} é");
});

test("comments are collected, not tokenized", () => {
  const { tokens, comments } = tokenize("// one\nlet x = 1 /* two\nlines */\n");
  assert.deepEqual(tokens.map((t) => t.type), [T.LET, T.IDENTIFIER, T.EQUAL, T.NUMBER, T.NEWLINE, T.EOF]);
  assert.equal(comments.length, 2);
  assert.equal(comments[0].text, "// one");
});

test("newlines are ignored inside parentheses and brackets", () => {
  assert.deepEqual(types("f(1,\n2)\n[1,\n2]"), [T.IDENTIFIER, T.LEFT_PAREN, T.NUMBER, T.COMMA, T.NUMBER, T.RIGHT_PAREN, T.NEWLINE, T.LEFT_BRACKET, T.NUMBER, T.COMMA, T.NUMBER, T.RIGHT_BRACKET, T.EOF]);
});

test("tracks line and column", () => {
  const { tokens } = tokenize("let a = 1\n  let b = 2");
  const b = tokens.find((t) => t.value === "b");
  assert.equal(b.line, 2);
  assert.equal(b.column, 7);
});

test("foreign operators produce teaching errors", () => {
  for (const [src, text] of [["a && b", '"and"'], ["a || b", '"or"'], ["!a", '"not"'], ["a === b", '"=="'], ["x++", "+= 1"], ["let s = 'x'", "double quotes"]]) {
    assert.throws(() => tokenize(src), (err) => {
      const d = err.diagnostics[0];
      return (d.message + d.hint).includes(text);
    }, src);
  }
});

test("unclosed strings and brackets are reported with positions", () => {
  assert.throws(() => tokenize('let s = "abc'), (e) => e.diagnostics[0].message === "This string is never closed." && e.diagnostics[0].column === 9);
  assert.throws(() => tokenize("f(1, 2"), (e) => e.diagnostics[0].message.includes('"(" is never closed'));
  assert.throws(() => tokenize("f(1]"), (e) => e.diagnostics[0].message.includes('Expected ")"'));
});

test("tolerant mode collects errors and keeps going", () => {
  const { tokens, errors } = tokenize("if a && b {", null, { tolerant: true });
  assert.ok(tokens.some((t) => t.type === T.AND));
  assert.equal(errors.length, 2);
});
