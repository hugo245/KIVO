"use strict";

const fs = require("fs");
const nodePath = require("path");
const { native, defineModule } = require("../native");
const { KivoError, typeError } = require("../errors");
const { describeType, isBytes } = require("../values");

function p(v, what = "The path") {
  if (typeof v !== "string") throw typeError(`${what} must be a string, but got ${describeType(v)}.`);
  if (v.includes("\0")) throw typeError(`${what} contains a null character.`);
  return v;
}

function ioError(action, path, err) {
  const shown = JSON.stringify(path);
  switch (err && err.code) {
    case "ENOENT":
      return new KivoError(`Cannot ${action} ${shown}: it does not exist.`, {
        kind: "IOError",
        hint: `Check the path. Relative paths start from the current directory:\n\n    ${process.cwd()}\n\nTo check first:\n\n    if fs.exists(${shown}) { ... }`,
      });
    case "EACCES":
    case "EPERM":
      return new KivoError(`Cannot ${action} ${shown}: permission denied.`, { kind: "IOError" });
    case "EISDIR":
      return new KivoError(`Cannot ${action} ${shown}: it is a directory, not a file.`, { kind: "IOError", hint: "To see what is inside a directory use fs.list(path)." });
    case "ENOTDIR":
      return new KivoError(`Cannot ${action} ${shown}: part of the path is not a directory.`, { kind: "IOError" });
    case "EEXIST":
      return new KivoError(`Cannot ${action} ${shown}: it already exists.`, { kind: "IOError" });
    case "ENOTEMPTY":
      return new KivoError(`Cannot ${action} ${shown}: the directory is not empty.`, { kind: "IOError", hint: "To delete a directory and everything in it use fs.removeAll(path)." });
    default:
      return new KivoError(`Cannot ${action} ${shown}: ${err && err.message}`, { kind: "IOError" });
  }
}

function attempt(action, path, fn) {
  try {
    const r = fn();
    return r === undefined ? null : r;
  } catch (err) {
    if (err instanceof KivoError) throw err;
    if (err && err.code === "ENOENT" && action.startsWith("write")) {
      const e = ioError(action, path, err);
      e.hint = `The directory ${JSON.stringify(nodePath.dirname(path))} does not exist. Create it first:\n\n    fs.mkdir(${JSON.stringify(nodePath.dirname(path))})`;
      throw e;
    }
    throw ioError(action, path, err);
  }
}

function text(v, what) {
  if (typeof v === "string") return v;
  if (isBytes(v)) return v;
  throw typeError(`${what} must be a string or bytes, but got ${describeType(v)}.`, v !== null && typeof v === "object" ? "To save structured data, convert it to JSON first:\n\n    fs.write(path, json.stringify(data))" : `Convert it first: string(value)`);
}

module.exports = () =>
  defineModule("fs", "Read and write files and directories.", {
    read: native("read(path: string) -> string", "Reads a whole text file (UTF-8).", (path) => attempt("read", p(path), () => fs.readFileSync(path, "utf8"))),
    readBytes: native("readBytes(path: string) -> bytes", "Reads a whole file as bytes.", (path) => attempt("read", p(path), () => fs.readFileSync(path))),
    readLines: native("readLines(path: string) -> [string]", "Reads a text file and splits it into lines.", (path) =>
      attempt("read", p(path), () => {
        const t = fs.readFileSync(path, "utf8");
        return t === "" ? [] : t.replace(/\r?\n$/, "").split(/\r?\n/);
      })
    ),
    write: native("write(path: string, content: string | bytes) -> void", "Writes a file, replacing it if it exists.", (path, content) => attempt("write", p(path), () => fs.writeFileSync(path, text(content, "The content")))),
    append: native("append(path: string, content: string | bytes) -> void", "Adds content to the end of a file (creating it if needed).", (path, content) => attempt("write to", p(path), () => fs.appendFileSync(path, text(content, "The content")))),
    exists: native("exists(path: string) -> bool", "Returns true if a file or directory exists at path.", (path) => fs.existsSync(p(path))),
    isFile: native("isFile(path: string) -> bool", "Returns true if path is a file.", (path) => {
      try {
        return fs.statSync(p(path)).isFile();
      } catch {
        return false;
      }
    }),
    isDir: native("isDir(path: string) -> bool", "Returns true if path is a directory.", (path) => {
      try {
        return fs.statSync(p(path)).isDirectory();
      } catch {
        return false;
      }
    }),
    list: native("list(path?: string) -> [string]", "Names of the files and directories inside a directory.", (path = ".") => attempt("list", p(path), () => fs.readdirSync(path).sort())),
    mkdir: native("mkdir(path: string) -> void", "Creates a directory (and any missing parent directories).", (path) => attempt("create directory", p(path), () => fs.mkdirSync(path, { recursive: true }))),
    remove: native("remove(path: string) -> void", "Deletes a file or an empty directory.", (path) =>
      attempt("remove", p(path), () => {
        const st = fs.statSync(path);
        if (st.isDirectory()) fs.rmdirSync(path);
        else fs.unlinkSync(path);
      })
    ),
    removeAll: native("removeAll(path: string) -> void", "Deletes a directory and everything inside it. Be careful.", (path) =>
      attempt("remove", p(path), () => {
        const resolved = nodePath.resolve(path);
        if (resolved === nodePath.parse(resolved).root || resolved === nodePath.resolve(require("os").homedir())) {
          throw new KivoError(`Refusing to remove ${JSON.stringify(resolved)}.`, { kind: "IOError", hint: "fs.removeAll() will not delete a filesystem root or your home directory." });
        }
        fs.rmSync(path, { recursive: true });
      })
    ),
    copy: native("copy(from: string, to: string) -> void", "Copies a file.", (a, b) => attempt("copy", p(a), () => fs.copyFileSync(a, p(b)))),
    move: native("move(from: string, to: string) -> void", "Moves or renames a file or directory.", (a, b) => attempt("move", p(a), () => fs.renameSync(a, p(b)))),
    size: native("size(path: string) -> int", "Size of a file in bytes.", (path) => attempt("read", p(path), () => fs.statSync(path).size)),
    modified: native("modified(path: string) -> number", "Time the file was last modified (milliseconds since 1970).", (path) => attempt("read", p(path), () => fs.statSync(path).mtimeMs)),
  });
