"use strict";

// AST node kinds. Every node has `type` and `loc`:
//   loc = { start, end, line, column, endLine, endColumn }
// Lines and columns are 1-based; start/end are source offsets.

const NodeType = Object.freeze({
  Program: "Program",
  Block: "Block",

  // statements
  VariableDeclaration: "VariableDeclaration", // kind, target, typeAnnotation, value, exported
  FunctionDeclaration: "FunctionDeclaration", // name, params, returnType, body, async, exported
  ClassDeclaration: "ClassDeclaration", // name, superClass, fields, methods, exported
  FieldDeclaration: "FieldDeclaration", // name, typeAnnotation, value, constant
  TypeDeclaration: "TypeDeclaration", // name, fields, exported
  TypeField: "TypeField", // name, typeAnnotation, optional
  ReturnStatement: "ReturnStatement",
  IfStatement: "IfStatement",
  ForStatement: "ForStatement", // key, value, iterable, body
  WhileStatement: "WhileStatement",
  BreakStatement: "BreakStatement",
  ContinueStatement: "ContinueStatement",
  TryStatement: "TryStatement", // block, param, handler, finalizer
  ThrowStatement: "ThrowStatement",
  ImportDeclaration: "ImportDeclaration", // source, isPath, alias, specifiers
  ImportSpecifier: "ImportSpecifier", // imported, local
  ExpressionStatement: "ExpressionStatement",
  AssignmentStatement: "AssignmentStatement", // operator, target, value

  // patterns
  ObjectPattern: "ObjectPattern", // properties: [{ key, value: Identifier }]
  ArrayPattern: "ArrayPattern", // elements, rest

  // expressions
  Identifier: "Identifier",
  NumberLiteral: "NumberLiteral",
  StringLiteral: "StringLiteral",
  TemplateString: "TemplateString", // parts: (string | Expression)[]
  BooleanLiteral: "BooleanLiteral",
  NullLiteral: "NullLiteral",
  SelfExpression: "SelfExpression",
  SuperMemberExpression: "SuperMemberExpression", // property
  ArrayExpression: "ArrayExpression",
  ObjectExpression: "ObjectExpression", // properties: Property | SpreadElement
  Property: "Property", // key, value, shorthand
  SpreadElement: "SpreadElement",
  BinaryExpression: "BinaryExpression",
  LogicalExpression: "LogicalExpression", // and, or, ??
  UnaryExpression: "UnaryExpression", // -, not
  RangeExpression: "RangeExpression", // start, end, inclusive
  CallExpression: "CallExpression", // callee, args, optional
  MemberExpression: "MemberExpression", // object, property, optional
  IndexExpression: "IndexExpression", // object, index, optional
  FunctionExpression: "FunctionExpression", // params, returnType, body, async, arrow, expression
  AwaitExpression: "AwaitExpression",
  Parameter: "Parameter", // name, typeAnnotation, defaultValue, rest

  // types
  TypeName: "TypeName",
  NullableType: "NullableType",
  ArrayType: "ArrayType",
  UnionType: "UnionType",
});

// Walks every child node. Used by the checker, formatter and language service.
function forEachChild(node, fn) {
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "type" || key === "comments") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) if (item && typeof item === "object" && typeof item.type === "string") fn(item, key);
      else if (item && typeof item === "object" && item.value && typeof item.value.type === "string") fn(item.value, key);
    } else if (value && typeof value === "object" && typeof value.type === "string") {
      fn(value, key);
    }
  }
}

function walk(node, visit, parent = null) {
  if (visit(node, parent) === false) return;
  forEachChild(node, (child) => walk(child, visit, node));
}

module.exports = { NodeType, forEachChild, walk };
