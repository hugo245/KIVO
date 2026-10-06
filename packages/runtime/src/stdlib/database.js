"use strict";

const { native, defineModule } = require("../native");
const { KivoError, typeError } = require("../errors");
const { describeType, isPlainObject, isBytes, isPromise } = require("../values");

// SQLite through Node's built-in driver. Every value is passed as a bound
// parameter, and table/column names are validated, so the query builder
// cannot produce SQL injection.

let sqliteModule = null;
function loadSqlite() {
  if (sqliteModule) return sqliteModule;
  const original = process.emitWarning;
  process.emitWarning = function (warning, ...rest) {
    const text = typeof warning === "string" ? warning : warning && warning.message;
    if (text && /SQLite/i.test(text)) return;
    return original.call(process, warning, ...rest);
  };
  try {
    sqliteModule = require("node:sqlite");
  } catch {
    throw new KivoError("The database module needs Node.js 22.5 or newer (with built-in SQLite).", { kind: "DatabaseError" });
  } finally {
    process.emitWarning = original;
  }
  return sqliteModule;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const OPERATORS = new Set(["=", "==", "!=", "<>", "<", ">", "<=", ">=", "like", "not like", "in", "not in", "is", "is not"]);

function ident(name, what) {
  if (typeof name !== "string" || !IDENT.test(name)) {
    throw typeError(`Invalid ${what} name ${typeof name === "string" ? JSON.stringify(name) : describeType(name)}.`, "Names may contain letters, digits and _, and cannot start with a digit.");
  }
  return `"${name}"`;
}

function toSql(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number" || typeof v === "string") return v;
  if (isBytes(v)) return v;
  throw typeError(`Cannot store ${describeType(v)} in the database.`, isPlainObject(v) || Array.isArray(v) ? "Convert it to JSON text first: json.stringify(value)" : null);
}

function params(p) {
  if (p === undefined || p === null) return [];
  if (Array.isArray(p)) return p.map(toSql);
  if (isPlainObject(p)) {
    const out = {};
    for (const [k, v] of Object.entries(p)) out[k] = toSql(v);
    return [out];
  }
  throw typeError(`Query parameters must be an array or an object, but got ${describeType(p)}.`, '    db.query("SELECT * FROM users WHERE id = ?", [5])');
}

function sqlError(err, sql) {
  if (err instanceof KivoError) return err;
  const e = new KivoError(`Database error: ${err.message.replace(/^SQLITE_\w+: /, "")}`, { kind: "DatabaseError" });
  e.hint = sql ? `While running:\n\n    ${sql}` : null;
  return e;
}

function plainRow(row) {
  if (!row) return null;
  const out = {};
  for (const k of Object.keys(row)) out[k] = row[k];
  return out;
}

function openSqlite(rt, file) {
  if (typeof file !== "string") throw typeError(`database.sqlite() needs a file path (or ":memory:"), but got ${describeType(file)}.`);
  const { DatabaseSync } = loadSqlite();
  let db;
  try {
    db = new DatabaseSync(file);
  } catch (err) {
    throw sqlError(err);
  }

  const run = (sql, p) => {
    if (typeof sql !== "string") throw typeError("SQL must be a string.");
    try {
      const r = db.prepare(sql).run(...params(p));
      return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
    } catch (err) {
      throw sqlError(err, sql);
    }
  };
  const all = (sql, p) => {
    if (typeof sql !== "string") throw typeError("SQL must be a string.");
    try {
      return db.prepare(sql).all(...params(p)).map(plainRow);
    } catch (err) {
      throw sqlError(err, sql);
    }
  };
  const one = (sql, p) => {
    if (typeof sql !== "string") throw typeError("SQL must be a string.");
    try {
      return plainRow(db.prepare(sql).get(...params(p)));
    } catch (err) {
      throw sqlError(err, sql);
    }
  };

  function query(table, state) {
    const where = () => {
      if (!state.conditions.length) return { sql: "", values: [] };
      const parts = [];
      const values = [];
      for (const c of state.conditions) {
        if (c.op === "in" || c.op === "not in") {
          if (!Array.isArray(c.value)) throw typeError(`"${c.op}" needs an array of values.`);
          parts.push(`${ident(c.column, "column")} ${c.op.toUpperCase()} (${c.value.map(() => "?").join(", ") || "NULL"})`);
          values.push(...c.value.map(toSql));
        } else if (c.value === null && (c.op === "=" || c.op === "==" || c.op === "is")) {
          parts.push(`${ident(c.column, "column")} IS NULL`);
        } else if (c.value === null && (c.op === "!=" || c.op === "<>" || c.op === "is not")) {
          parts.push(`${ident(c.column, "column")} IS NOT NULL`);
        } else {
          parts.push(`${ident(c.column, "column")} ${c.op === "==" ? "=" : c.op.toUpperCase()} ?`);
          values.push(toSql(c.value));
        }
      }
      return { sql: " WHERE " + parts.join(" AND "), values };
    };
    const tail = () => {
      let s = "";
      if (state.order.length) s += " ORDER BY " + state.order.map((o) => `${ident(o.column, "column")} ${o.dir}`).join(", ");
      if (state.limit !== null) s += ` LIMIT ${state.limit}`;
      if (state.offset !== null) s += `${state.limit === null ? " LIMIT -1" : ""} OFFSET ${state.offset}`;
      return s;
    };
    const next = (patch) => query(table, { ...state, ...patch });
    const q = {
      where: native("where(column: string | object, op?: string, value?) -> Query", 'Adds a condition: .where("coins", ">", 100) or .where({ name: "Hugo" }).', (a, op, value) => {
        const conditions = state.conditions.slice();
        if (isPlainObject(a)) {
          for (const [k, v] of Object.entries(a)) conditions.push({ column: k, op: "=", value: v });
        } else {
          if (value === undefined) {
            value = op;
            op = "=";
          }
          if (typeof op !== "string" || !OPERATORS.has(op.toLowerCase())) throw typeError(`Unknown operator ${JSON.stringify(op)}.`, `Use one of: ${[...OPERATORS].join(", ")}`);
          ident(a, "column");
          conditions.push({ column: a, op: op.toLowerCase(), value });
        }
        return next({ conditions });
      }),
      orderBy: native("orderBy(column: string, direction?: string) -> Query", 'Sorts the results: .orderBy("coins", "desc").', (column, dir = "asc") => {
        ident(column, "column");
        const d = String(dir).toLowerCase();
        if (d !== "asc" && d !== "desc") throw typeError('orderBy() direction must be "asc" or "desc".');
        return next({ order: [...state.order, { column, dir: d.toUpperCase() }] });
      }),
      limit: native("limit(count: int) -> Query", "Returns at most count rows.", (n) => {
        if (!Number.isInteger(n) || n < 0) throw typeError("limit() needs a whole number of 0 or more.");
        return next({ limit: n });
      }),
      offset: native("offset(count: int) -> Query", "Skips the first count rows.", (n) => {
        if (!Number.isInteger(n) || n < 0) throw typeError("offset() needs a whole number of 0 or more.");
        return next({ offset: n });
      }),
      select: native("select(...columns: string) -> Query", "Only returns the given columns.", (...columns) => {
        columns.forEach((c) => ident(c, "column"));
        return next({ columns });
      }),
      get: native("get() -> [object]", "Runs the query and returns all matching rows.", () => {
        const w = where();
        const cols = state.columns.length ? state.columns.map((c) => ident(c, "column")).join(", ") : "*";
        return all(`SELECT ${cols} FROM ${ident(table, "table")}${w.sql}${tail()}`, w.values);
      }),
      first: native("first() -> object?", "The first matching row, or null.", () => {
        const w = where();
        const cols = state.columns.length ? state.columns.map((c) => ident(c, "column")).join(", ") : "*";
        let t = "";
        if (state.order.length) t += " ORDER BY " + state.order.map((o) => `${ident(o.column, "column")} ${o.dir}`).join(", ");
        return one(`SELECT ${cols} FROM ${ident(table, "table")}${w.sql}${t} LIMIT 1${state.offset !== null ? ` OFFSET ${state.offset}` : ""}`, w.values);
      }),
      count: native("count() -> int", "Number of matching rows.", () => {
        const w = where();
        return one(`SELECT COUNT(*) AS n FROM ${ident(table, "table")}${w.sql}`, w.values).n;
      }),
      update: native("update(values: object) -> int", "Updates the matching rows. Returns how many changed.", (values) => {
        if (!isPlainObject(values) || !Object.keys(values).length) throw typeError("update() needs an object with the new values.", '    db.table("users").where({ id: 5 }).update({ coins: 100 })');
        const w = where();
        const sets = Object.keys(values).map((k) => `${ident(k, "column")} = ?`);
        return run(`UPDATE ${ident(table, "table")} SET ${sets.join(", ")}${w.sql}`, [...Object.values(values).map(toSql), ...w.values]).changes;
      }),
      delete: native("delete() -> int", "Deletes the matching rows. Returns how many were deleted.", () => {
        const w = where();
        return run(`DELETE FROM ${ident(table, "table")}${w.sql}`, w.values).changes;
      }),
    };
    return q;
  }

  function tableApi(name) {
    ident(name, "table");
    const base = query(name, { conditions: [], order: [], limit: null, offset: null, columns: [] });
    return {
      ...base,
      name,
      all: native("all() -> [object]", "All rows in the table.", () => base.get()),
      find: native("find(where: object | int) -> object?", "The first row matching the conditions (or with the given id), or null.", (w) => (isPlainObject(w) ? base.where(w).first() : base.where("id", "=", w).first())),
      insert: native("insert(row: object) -> int", "Inserts a row. Returns its id.", (row) => {
        if (!isPlainObject(row) || !Object.keys(row).length) throw typeError("insert() needs an object.", '    db.table("users").insert({ name: "Hugo", coins: 500 })');
        const cols = Object.keys(row).map((k) => ident(k, "column"));
        return run(`INSERT INTO ${ident(name, "table")} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, Object.values(row).map(toSql)).lastId;
      }),
    };
  }

  return {
    query: native("query(sql: string, params?: array | object) -> [object]", 'Runs a SELECT and returns the rows. Use ? placeholders: db.query("SELECT * FROM users WHERE id = ?", [id])', all),
    get: native("get(sql: string, params?: array | object) -> object?", "Runs a query and returns the first row, or null.", one),
    run: native("run(sql: string, params?: array | object) -> object", "Runs INSERT/UPDATE/DELETE. Returns { changes, lastId }.", run),
    exec: native("exec(sql: string) -> void", "Runs one or more SQL statements without parameters (for creating tables).", (sql) => {
      if (typeof sql !== "string") throw typeError("exec() needs SQL as a string.");
      try {
        db.exec(sql);
      } catch (err) {
        throw sqlError(err, sql.trim().split("\n")[0]);
      }
    }),
    table: native("table(name: string) -> Table", "A query builder for one table.", tableApi),
    transaction: native("transaction(fn: func) -> any", "Runs fn inside a transaction. If fn throws, every change is rolled back.", (fn) => {
      rt.core.expectFunction(fn, "transaction()'s argument");
      db.exec("BEGIN");
      try {
        const r = rt.core.invoke(fn, [], undefined);
        if (isPromise(r)) throw typeError("transaction() functions cannot be async.");
        db.exec("COMMIT");
        return r;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    }),
    close: native("close() -> void", "Closes the database.", () => db.close()),
  };
}

module.exports = (rt) =>
  defineModule("database", "SQL databases with safe, parameterized queries. Currently: SQLite.", {
    sqlite: native("sqlite(path: string) -> Database", 'Opens (or creates) a SQLite database file. Use ":memory:" for a temporary in-memory database.', (file) => openSqlite(rt, file)),
  });
