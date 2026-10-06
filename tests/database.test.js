"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { run } = require("./helpers");

test("database: sqlite with a safe query builder", async () => {
  const src = `
import database

let db = database.sqlite(":memory:")
db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, coins INTEGER)")
let users = db.table("users")
users.insert({ name: "Hugo", coins: 250 })
users.insert({ name: "Alex", coins: 100 })
users.insert({ name: "Sam", coins: 500 })

print(users.find({ id: 1 }).name)
print(users.where("coins", ">", 100).orderBy("coins", "desc").limit(20).get().map(u => u.name))
print(users.count(), users.where({ name: "Alex" }).first().coins)
print(users.where("name", "=", "Robert'); DROP TABLE users; --").get())
print(db.query("SELECT name FROM users WHERE coins >= ?", [250]).map(r => r.name))
print(users.where({ name: "Sam" }).update({ coins: 1 }), users.find({ name: "Sam" }).coins)
print(users.where("coins", "<", 200).delete(), users.count())
try {
    db.transaction(func() {
        users.insert({ name: "Temp", coins: 0 })
        throw "rollback"
    })
} catch e {
    print("rolled back:", users.count())
}
try {
    users.where("name; DROP", "=", 1).get()
} catch e {
    print(e.message)
}
`;
  const r = await run(src);
  assert.equal(r.error, null, r.error);
  assert.equal(
    r.output,
    [
      "Hugo",
      '["Sam", "Hugo"]',
      "3 100",
      "[]",
      '["Hugo", "Sam"]',
      "1 1",
      "2 1",
      "rolled back: 1",
      'Invalid column name "name; DROP".',
      "",
    ].join("\n")
  );
});
