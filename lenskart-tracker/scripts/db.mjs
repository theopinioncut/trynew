// Loads data/db/*.csv into an in-memory SQLite database (Node's built-in node:sqlite).
// To point this at a real warehouse, replace openDb() with a connection that exposes the
// same table names; metrics.mjs and checks.mjs only speak SQL.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

function parseCsv(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (c !== "\r") cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

export function openDb(dir) {
  const db = new DatabaseSync(":memory:");
  const tables = {};
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".csv"))) {
    const name = f.replace(/\.csv$/, "");
    const [cols, ...rows] = parseCsv(fs.readFileSync(path.join(dir, f), "utf8"));
    const numeric = cols.map((_, j) => rows.every((r) => r[j] === "" || /^-?\d+(\.\d+)?$/.test(r[j])));
    db.exec(`CREATE TABLE ${name} (${cols.map((c, j) => `${c} ${numeric[j] ? "REAL" : "TEXT"}`).join(", ")})`);
    const ins = db.prepare(`INSERT INTO ${name} VALUES (${cols.map(() => "?").join(",")})`);
    db.exec("BEGIN");
    for (const r of rows) ins.run(...r.map((v, j) => (v === "" ? null : numeric[j] ? Number(v) : v)));
    db.exec("COMMIT");
    tables[name] = { columns: cols, rows: rows.length };
  }
  return { db, tables };
}
