"use strict";

const nodePath = require("path");
const { native, defineModule, constant } = require("../native");
const { typeError } = require("../errors");
const { describeType } = require("../values");

function s(v, what = "The path") {
  if (typeof v !== "string") throw typeError(`${what} must be a string, but got ${describeType(v)}.`);
  return v;
}

module.exports = () =>
  defineModule("path", "Work with file paths.", {
    join: native("join(...parts: string) -> string", "Joins path segments with the right separator.", (...parts) => nodePath.join(...parts.map((x) => s(x, "Every part")))),
    resolve: native("resolve(...parts: string) -> string", "Turns a path into an absolute path.", (...parts) => nodePath.resolve(...parts.map((x) => s(x, "Every part")))),
    dirname: native("dirname(path: string) -> string", "The directory part of a path.", (x) => nodePath.dirname(s(x))),
    basename: native("basename(path: string, ext?: string) -> string", "The last part of a path (optionally without the extension).", (x, ext) => nodePath.basename(s(x), ext === undefined ? undefined : s(ext, "ext"))),
    extname: native("extname(path: string) -> string", 'The extension of a path, like ".kivo".', (x) => nodePath.extname(s(x))),
    normalize: native("normalize(path: string) -> string", "Cleans up .. and . segments.", (x) => nodePath.normalize(s(x))),
    relative: native("relative(from: string, to: string) -> string", "The relative path from one path to another.", (a, b) => nodePath.relative(s(a), s(b))),
    isAbsolute: native("isAbsolute(path: string) -> bool", "Returns true if the path is absolute.", (x) => nodePath.isAbsolute(s(x))),
    separator: constant(nodePath.sep, "string", 'The path separator of this system ("/" or "\\").'),
  });
