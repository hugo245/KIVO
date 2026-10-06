#!/usr/bin/env node
"use strict";

require("../src/index.js")
  .main(process.argv.slice(2))
  .then((code) => {
    if (typeof code === "number") process.exitCode = code;
  });
