"use strict";

// Output goes through here so tests and embedders can capture it.
const io = {
  write(text) {
    process.stdout.write(text);
  },
  writeError(text) {
    process.stderr.write(text);
  },
};

module.exports = io;
