"use strict";

const { performance } = require("perf_hooks");
const { native, defineModule } = require("../native");
const { typeError } = require("../errors");
const { describeType } = require("../values");

function ms(v, what) {
  if (typeof v !== "number" || !Number.isFinite(v)) throw typeError(`${what} must be a number of milliseconds, but got ${describeType(v)}.`);
  return v;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

module.exports = () =>
  defineModule("time", "Dates, times and waiting.", {
    now: native("now() -> number", "Current time in milliseconds since 1 January 1970 (UTC).", () => Date.now()),
    clock: native("clock() -> number", "High-precision milliseconds, for measuring how long something takes.", () => performance.now()),
    since: native("since(start: number) -> number", "Milliseconds elapsed since a value returned by time.clock().", (start) => performance.now() - ms(start, "start")),
    sleep: native("sleep(ms: number) -> async void", "Waits for the given number of milliseconds. Use with await.", (t) => new Promise((resolve) => setTimeout(() => resolve(null), Math.max(0, ms(t, "The time"))))),
    iso: native("iso(time?: number) -> string", 'The time as an ISO 8601 string, like "2026-01-31T12:00:00.000Z".', (t) => new Date(t === undefined ? Date.now() : ms(t, "The time")).toISOString()),
    date: native("date(time?: number) -> object", "The local date and time as an object: { year, month, day, hour, minute, second, weekday }.", (t) => {
      const d = new Date(t === undefined ? Date.now() : ms(t, "The time"));
      return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds(), weekday: WEEKDAYS[d.getDay()] };
    }),
    parse: native("parse(text: string) -> number", "Parses a date string (like an ISO date) into milliseconds since 1970.", (text) => {
      if (typeof text !== "string") throw typeError(`time.parse() needs a string, but got ${describeType(text)}.`);
      const v = Date.parse(text);
      if (Number.isNaN(v)) throw typeError(`Cannot understand the date ${JSON.stringify(text)}.`, 'Use an ISO date like "2026-01-31" or "2026-01-31T12:00:00Z".');
      return v;
    }),
  });
