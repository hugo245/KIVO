"use strict";

const crypto = require("crypto");
const { native, defineModule } = require("../native");
const { typeError } = require("../errors");
const { describeType } = require("../values");

// Uses the operating system's secure random generator everywhere, so it is
// safe to use random values for tokens and ids.
function float() {
  return crypto.randomInt(0, 2 ** 48 - 1) / (2 ** 48 - 1);
}

function int(v, what) {
  if (!Number.isInteger(v)) throw typeError(`${what} must be a whole number, but got ${describeType(v)}.`);
  return v;
}

module.exports = () =>
  defineModule("random", "Random numbers and choices (cryptographically secure).", {
    int: native("int(min: int, max: int) -> int", "A random whole number from min to max (both included).", (a, b) => {
      int(a, "min");
      int(b, "max");
      if (b < a) throw typeError(`random.int() max (${b}) must not be smaller than min (${a}).`);
      return crypto.randomInt(a, b + 1);
    }),
    float: native("float(min?: number, max?: number) -> float", "A random number from min (default 0) up to max (default 1).", (a = 0, b = 1) => {
      if (typeof a !== "number" || typeof b !== "number") throw typeError("random.float() needs numbers.");
      return a + float() * (b - a);
    }),
    bool: native("bool() -> bool", "Randomly true or false.", () => crypto.randomInt(0, 2) === 1),
    choice: native("choice(items: array) -> any", "A random item from the array.", (items) => {
      if (!Array.isArray(items)) throw typeError(`random.choice() needs an array, but got ${describeType(items)}.`);
      if (!items.length) throw typeError("random.choice() needs a non-empty array.");
      return items[crypto.randomInt(0, items.length)];
    }),
    shuffle: native("shuffle(items: array) -> array", "A shuffled copy of the array.", (items) => {
      if (!Array.isArray(items)) throw typeError(`random.shuffle() needs an array, but got ${describeType(items)}.`);
      const a = items.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = crypto.randomInt(0, i + 1);
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }),
    uuid: native("uuid() -> string", "A random UUID (version 4).", () => crypto.randomUUID()),
  });
