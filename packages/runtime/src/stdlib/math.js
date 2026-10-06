"use strict";

const { native, defineModule, constant } = require("../native");
const { typeError } = require("../errors");
const { describeType } = require("../values");

function num(v, what) {
  if (typeof v !== "number") throw typeError(`${what} must be a number, but got ${describeType(v)}.`, typeof v === "string" ? `Convert it first: number(${JSON.stringify(v)})` : null);
  return v;
}

const f1 = (name, doc, fn) => native(`${name}(x: number) -> number`, doc, (x) => fn(num(x, `math.${name}()'s argument`)));

module.exports = () =>
  defineModule("math", "Mathematical functions and constants.", {
    pi: constant(Math.PI, "float", "The ratio of a circle's circumference to its diameter (3.14159...)."),
    e: constant(Math.E, "float", "Euler's number (2.71828...)."),
    inf: constant(Infinity, "float", "Positive infinity."),
    floor: f1("floor", "Rounds down to a whole number.", Math.floor),
    ceil: f1("ceil", "Rounds up to a whole number.", Math.ceil),
    round: native("round(x: number, digits?: int) -> number", "Rounds to the nearest whole number, or to the given number of decimal digits.", (x, digits) => {
      num(x, "math.round()'s argument");
      if (digits === undefined) return Math.round(x);
      if (!Number.isInteger(digits)) throw typeError("math.round() digits must be a whole number.");
      const f = 10 ** digits;
      return Math.round((x + Number.EPSILON) * f) / f;
    }),
    trunc: f1("trunc", "Drops the fractional part.", Math.trunc),
    abs: f1("abs", "Absolute value.", Math.abs),
    sign: f1("sign", "-1, 0 or 1 depending on the sign of x.", Math.sign),
    sqrt: native("sqrt(x: number) -> number", "Square root.", (x) => {
      num(x, "math.sqrt()'s argument");
      if (x < 0) throw typeError(`math.sqrt() needs a number of 0 or more, but got ${x}.`);
      return Math.sqrt(x);
    }),
    pow: native("pow(base: number, exponent: number) -> number", "base raised to the power exponent.", (a, b) => num(a, "base") ** num(b, "exponent")),
    exp: f1("exp", "e raised to the power x.", Math.exp),
    log: native("log(x: number, base?: number) -> number", "Natural logarithm, or logarithm with the given base.", (x, base) => {
      num(x, "math.log()'s argument");
      return base === undefined ? Math.log(x) : Math.log(x) / Math.log(num(base, "base"));
    }),
    log10: f1("log10", "Base-10 logarithm.", Math.log10),
    sin: f1("sin", "Sine (radians).", Math.sin),
    cos: f1("cos", "Cosine (radians).", Math.cos),
    tan: f1("tan", "Tangent (radians).", Math.tan),
    asin: f1("asin", "Arc sine.", Math.asin),
    acos: f1("acos", "Arc cosine.", Math.acos),
    atan: f1("atan", "Arc tangent.", Math.atan),
    atan2: native("atan2(y: number, x: number) -> number", "Angle of the point (x, y) in radians.", (y, x) => Math.atan2(num(y, "y"), num(x, "x"))),
    min: native("min(...values: number) -> number", "The smallest of the given numbers.", (...xs) => {
      if (xs.length === 1 && Array.isArray(xs[0])) xs = xs[0];
      if (!xs.length) throw typeError("math.min() needs at least one number.");
      xs.forEach((x) => num(x, "Every argument of math.min()"));
      return Math.min(...xs);
    }),
    max: native("max(...values: number) -> number", "The largest of the given numbers.", (...xs) => {
      if (xs.length === 1 && Array.isArray(xs[0])) xs = xs[0];
      if (!xs.length) throw typeError("math.max() needs at least one number.");
      xs.forEach((x) => num(x, "Every argument of math.max()"));
      return Math.max(...xs);
    }),
    clamp: native("clamp(x: number, low: number, high: number) -> number", "Limits x to the range low..high.", (x, lo, hi) => Math.min(Math.max(num(x, "x"), num(lo, "low")), num(hi, "high"))),
    isNaN: native("isNaN(x: number) -> bool", "Returns true if x is not a number (nan).", (x) => Number.isNaN(x)),
    isInteger: native("isInteger(x) -> bool", "Returns true if x is a whole number.", (x) => Number.isInteger(x)),
  });
