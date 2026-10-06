"use strict";

// Output goes through here so tests and embedders can capture it.
const io = {
  write(text) {
    try {
      process.stdout.write(text);
    } catch (err) {
      // the reader of a pipe went away (`kivo run app.kivo | head`): stop quietly
      if (err && err.code === "EPIPE") process.exit(0);
      throw err;
    }
  },
  writeError(text) {
    process.stderr.write(text);
  },
};

module.exports = io;
