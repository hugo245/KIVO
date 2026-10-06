"use strict";

const crypto = require("crypto");
const { native, defineModule } = require("../native");
const { typeError } = require("../errors");
const { describeType, isBytes } = require("../values");

// Thin, safe wrappers around Node's audited crypto implementation.
// KIVO never implements cryptographic algorithms itself.

const HASHES = ["sha256", "sha384", "sha512", "sha1", "md5"];

function data(v, what = "The data") {
  if (typeof v === "string" || isBytes(v)) return v;
  throw typeError(`${what} must be a string or bytes, but got ${describeType(v)}.`);
}

function algorithm(a) {
  if (typeof a !== "string" || !HASHES.includes(a)) throw typeError(`Unknown hash algorithm ${JSON.stringify(a)}.`, `Use one of: ${HASHES.join(", ")}. For passwords use crypto.hashPassword().`);
  return a;
}

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

function hashPassword(password) {
  if (typeof password !== "string") throw typeError(`crypto.hashPassword() needs a string, but got ${describeType(password)}.`);
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

function verifyPassword(password, stored) {
  if (typeof password !== "string" || typeof stored !== "string") throw typeError("crypto.verifyPassword() needs two strings: the password and the stored hash.");
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, "base64");
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

module.exports = () =>
  defineModule("crypto", "Hashing, password storage and secure random values.", {
    hash: native("hash(algorithm: string, data: string | bytes) -> string", 'Hex digest of data. Algorithms: "sha256", "sha384", "sha512", "sha1", "md5".', (a, d) => crypto.createHash(algorithm(a)).update(data(d)).digest("hex")),
    sha256: native("sha256(data: string | bytes) -> string", "SHA-256 hex digest.", (d) => crypto.createHash("sha256").update(data(d)).digest("hex")),
    sha512: native("sha512(data: string | bytes) -> string", "SHA-512 hex digest.", (d) => crypto.createHash("sha512").update(data(d)).digest("hex")),
    hmac: native("hmac(algorithm: string, key: string | bytes, data: string | bytes) -> string", "HMAC hex digest, for signing messages.", (a, k, d) => crypto.createHmac(algorithm(a), data(k, "The key")).update(data(d)).digest("hex")),
    hashPassword: native("hashPassword(password: string) -> string", "Hashes a password for storage (scrypt with a random salt).", hashPassword),
    verifyPassword: native("verifyPassword(password: string, hash: string) -> bool", "Checks a password against a hash from crypto.hashPassword().", verifyPassword),
    randomBytes: native("randomBytes(count: int) -> bytes", "Secure random bytes.", (n) => {
      if (!Number.isInteger(n) || n < 0 || n > 65536) throw typeError("crypto.randomBytes() needs a whole number from 0 to 65536.");
      return crypto.randomBytes(n);
    }),
    token: native("token(bytes?: int) -> string", "A secure random hex token (default 32 bytes), for session ids and API keys.", (n = 32) => {
      if (!Number.isInteger(n) || n < 1 || n > 1024) throw typeError("crypto.token() needs a whole number from 1 to 1024.");
      return crypto.randomBytes(n).toString("hex");
    }),
    uuid: native("uuid() -> string", "A random UUID (version 4).", () => crypto.randomUUID()),
    equal: native("equal(a: string, b: string) -> bool", "Compares two secrets in constant time (prevents timing attacks).", (a, b) => {
      const x = Buffer.from(data(a));
      const y = Buffer.from(data(b));
      return x.length === y.length && crypto.timingSafeEqual(x, y);
    }),
    base64: native("base64(data: string | bytes) -> string", "Encodes data as base64.", (d) => Buffer.from(data(d)).toString("base64")),
    fromBase64: native("fromBase64(text: string) -> bytes", "Decodes base64 text into bytes.", (t) => {
      if (typeof t !== "string") throw typeError("crypto.fromBase64() needs a string.");
      return Buffer.from(t, "base64");
    }),
  });
