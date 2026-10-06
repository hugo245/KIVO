"use strict";

// Registry of standard library modules. Modules are created lazily on first import.
const factories = {
  math: () => require("./math"),
  fs: () => require("./fs"),
  path: () => require("./path"),
  json: () => require("./json"),
  time: () => require("./time"),
  process: () => require("./process"),
  env: () => require("./env"),
  random: () => require("./random"),
  crypto: () => require("./crypto"),
  http: () => require("./http"),
  web: () => require("./web"),
  testing: () => require("./testing"),
  database: () => require("./database"),
};

const cache = new Map();

function has(name) {
  return Object.prototype.hasOwnProperty.call(factories, name);
}

function load(name, rt) {
  if (!cache.has(name)) cache.set(name, factories[name]()(rt));
  return cache.get(name);
}

const names = Object.keys(factories);

module.exports = { has, load, names };
