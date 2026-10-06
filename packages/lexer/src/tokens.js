"use strict";

// Every token KIVO knows about. New syntax is added by extending these tables;
// the lexer itself is table driven for keywords and punctuation.

const TokenType = Object.freeze({
  // literals & names
  IDENTIFIER: "IDENTIFIER",
  NUMBER: "NUMBER",
  STRING: "STRING",
  TRUE: "TRUE",
  FALSE: "FALSE",
  NULL: "NULL",

  // keywords
  LET: "LET",
  CONST: "CONST",
  FUNC: "FUNC",
  RETURN: "RETURN",
  IF: "IF",
  ELSE: "ELSE",
  FOR: "FOR",
  IN: "IN",
  WHILE: "WHILE",
  BREAK: "BREAK",
  CONTINUE: "CONTINUE",
  IMPORT: "IMPORT",
  FROM: "FROM",
  EXPORT: "EXPORT",
  AS: "AS",
  CLASS: "CLASS",
  EXTENDS: "EXTENDS",
  SELF: "SELF",
  SUPER: "SUPER",
  ASYNC: "ASYNC",
  AWAIT: "AWAIT",
  TRY: "TRY",
  CATCH: "CATCH",
  FINALLY: "FINALLY",
  THROW: "THROW",
  AND: "AND",
  OR: "OR",
  NOT: "NOT",

  // operators
  PLUS: "PLUS",
  MINUS: "MINUS",
  STAR: "STAR",
  SLASH: "SLASH",
  PERCENT: "PERCENT",
  PLUS_EQUAL: "PLUS_EQUAL",
  MINUS_EQUAL: "MINUS_EQUAL",
  STAR_EQUAL: "STAR_EQUAL",
  SLASH_EQUAL: "SLASH_EQUAL",
  PERCENT_EQUAL: "PERCENT_EQUAL",
  EQUAL: "EQUAL",
  EQUAL_EQUAL: "EQUAL_EQUAL",
  NOT_EQUAL: "NOT_EQUAL",
  GREATER_THAN: "GREATER_THAN",
  LESS_THAN: "LESS_THAN",
  GREATER_EQUAL: "GREATER_EQUAL",
  LESS_EQUAL: "LESS_EQUAL",
  RANGE: "RANGE", // ..
  RANGE_EXCLUSIVE: "RANGE_EXCLUSIVE", // ..<
  SPREAD: "SPREAD", // ...
  ARROW: "ARROW", // ->
  FAT_ARROW: "FAT_ARROW", // =>
  QUESTION: "QUESTION", // ?
  QUESTION_DOT: "QUESTION_DOT", // ?.
  QUESTION_QUESTION: "QUESTION_QUESTION", // ??
  PIPE: "PIPE", // |  (union types)

  // punctuation
  LEFT_PAREN: "LEFT_PAREN",
  RIGHT_PAREN: "RIGHT_PAREN",
  LEFT_BRACE: "LEFT_BRACE",
  RIGHT_BRACE: "RIGHT_BRACE",
  LEFT_BRACKET: "LEFT_BRACKET",
  RIGHT_BRACKET: "RIGHT_BRACKET",
  COMMA: "COMMA",
  DOT: "DOT",
  COLON: "COLON",
  SEMICOLON: "SEMICOLON",

  // structure
  NEWLINE: "NEWLINE",
  EOF: "EOF",
});

const KEYWORDS = Object.freeze({
  let: TokenType.LET,
  const: TokenType.CONST,
  func: TokenType.FUNC,
  return: TokenType.RETURN,
  if: TokenType.IF,
  else: TokenType.ELSE,
  for: TokenType.FOR,
  in: TokenType.IN,
  while: TokenType.WHILE,
  break: TokenType.BREAK,
  continue: TokenType.CONTINUE,
  import: TokenType.IMPORT,
  from: TokenType.FROM,
  export: TokenType.EXPORT,
  as: TokenType.AS,
  class: TokenType.CLASS,
  extends: TokenType.EXTENDS,
  self: TokenType.SELF,
  super: TokenType.SUPER,
  async: TokenType.ASYNC,
  await: TokenType.AWAIT,
  try: TokenType.TRY,
  catch: TokenType.CATCH,
  finally: TokenType.FINALLY,
  throw: TokenType.THROW,
  and: TokenType.AND,
  or: TokenType.OR,
  not: TokenType.NOT,
  true: TokenType.TRUE,
  false: TokenType.FALSE,
  null: TokenType.NULL,
});

// Punctuation, longest first so the lexer can do greedy matching.
const PUNCTUATION = [
  ["...", TokenType.SPREAD],
  ["..<", TokenType.RANGE_EXCLUSIVE],
  ["..", TokenType.RANGE],
  ["==", TokenType.EQUAL_EQUAL],
  ["!=", TokenType.NOT_EQUAL],
  [">=", TokenType.GREATER_EQUAL],
  ["<=", TokenType.LESS_EQUAL],
  ["+=", TokenType.PLUS_EQUAL],
  ["-=", TokenType.MINUS_EQUAL],
  ["*=", TokenType.STAR_EQUAL],
  ["/=", TokenType.SLASH_EQUAL],
  ["%=", TokenType.PERCENT_EQUAL],
  ["->", TokenType.ARROW],
  ["=>", TokenType.FAT_ARROW],
  ["?.", TokenType.QUESTION_DOT],
  ["??", TokenType.QUESTION_QUESTION],
  ["+", TokenType.PLUS],
  ["-", TokenType.MINUS],
  ["*", TokenType.STAR],
  ["/", TokenType.SLASH],
  ["%", TokenType.PERCENT],
  ["=", TokenType.EQUAL],
  [">", TokenType.GREATER_THAN],
  ["<", TokenType.LESS_THAN],
  ["?", TokenType.QUESTION],
  ["|", TokenType.PIPE],
  ["(", TokenType.LEFT_PAREN],
  [")", TokenType.RIGHT_PAREN],
  ["{", TokenType.LEFT_BRACE],
  ["}", TokenType.RIGHT_BRACE],
  ["[", TokenType.LEFT_BRACKET],
  ["]", TokenType.RIGHT_BRACKET],
  [",", TokenType.COMMA],
  [".", TokenType.DOT],
  [":", TokenType.COLON],
  [";", TokenType.SEMICOLON],
];

// Common habits from other languages that KIVO spells differently.
// The lexer turns these into teaching errors instead of cryptic ones.
const FOREIGN_OPERATORS = [
  ["===", "KIVO has no \"===\". Use \"==\" — it never converts types, so it is always strict."],
  ["!==", "KIVO has no \"!==\". Use \"!=\" — it never converts types, so it is always strict."],
  ["&&", "KIVO uses \"and\" instead of \"&&\".\n\n    if loggedIn and isAdmin { ... }"],
  ["||", "KIVO uses \"or\" instead of \"||\".\n\n    if isAdmin or isOwner { ... }\n\nFor default values use \"??\":\n\n    let name = input ?? \"Unknown\""],
  ["++", "KIVO has no \"++\" operator. Use \"+= 1\":\n\n    count += 1"],
  ["--", "KIVO has no \"--\" operator. Use \"-= 1\":\n\n    count -= 1"],
  ["!", "KIVO uses \"not\" instead of \"!\".\n\n    if not done { ... }"],
  ["&", "Bitwise operators are not part of KIVO syntax. Did you mean \"and\"?"],
];

function isKeywordType(type) {
  return Object.values(KEYWORDS).includes(type);
}

module.exports = { TokenType, KEYWORDS, PUNCTUATION, FOREIGN_OPERATORS, isKeywordType };
