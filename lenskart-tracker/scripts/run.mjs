// Daily pipeline (08:45 IST): refresh the warehouse, run data checks, compute every metric
// from SQL, merge owner updates from data/inbox, pick the top 3, write the email + issue, rebuild the app.
// Usage: node scripts/run.mjs [--trigger push|schedule|manual] [--as-of YYYY-MM-DD] [--no-generate] [--rollover]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generate } from "./generate.mjs";
import { openDb } from "./db.mjs";
import { FUNCTIONS, METRICS, CHECKS } from "./metrics.mjs";
import { buildDigest, normalizeStatus, renderEmail, renderMarkdown, statusFor, fmtValue } from "./lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const P = (...p) => path.join(ROOT, ...p);
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const trigger = arg("--trigger", "manual");
const istNow = new Date(Date.now() + 5.5 * 3600e3); // IST wall clock
const asOf = arg("--as-of", process.env.AS_OF || istNow.toISOString().slice(0, 10));
const CHECK_TIME = "08:45";
const DAY = 86400000;
const shift = (d, n) => new Date(new Date(d + "T00:00:00Z").getTime() + n * DAY).toISOString().slice(0, 10);

// 1. Refresh the warehouse. In production this is your nightly ETL; here it is the sample generator.
if (!args.includes("--no-generate")) console.log("Generated tables:", generate(asOf, CHECK_TIME));
const { db, tables } = openDb(P("data/db"));

// Run SQL with only the named parameters that the statement uses.
const q = (sql, params, all = false) => {
  const used = Object.fromEntries(Object.entries(params).filter(([k]) => sql.includes(":" + k)));
  const st = db.prepare(sql);
  return all ? st.all(used) : st.get(used);
};

// 2. Data checks.
const checks = CHECKS.map((c) => { const bad = Number(q(c.sql, { today: asOf, yesterday: shift(asOf, -1) }).bad); return { id: c.id, title: c.title, ok: bad === 0, bad }; });
checks.forEach((c) => console.log(`  ${c.ok ? "PASS" : "FAIL"} ${c.title}${c.ok ? "" : ` (${c.bad})`}`));

// 3. Metrics: current window vs previous window, plus a short daily series for sparklines.
const win = (m, end) => (m.window === "today" ? { start: end, end, check: CHECK_TIME } : { start: shift(end, -6), end, check: CHECK_TIME });
const curEnd = (m) => (m.window === "today" ? asOf : shift(asOf, -1));
const metricItems = METRICS.map((m) => {
  const end = curEnd(m);
  const value = Number(q(m.sql, win(m, end)).v);
  const prev = Number(q(m.sql, win(m, shift(end, -7))).v);
  const series = [];
  const points = m.window === "today" ? 8 : 14;
  for (let i = points - 1; i >= 0; i--) {
    const e = shift(end, -i);
    series.push({ date: e, v: Number(q(m.sql, win(m, e)).v) });
  }
  const detail = m.detail ? q(m.detail, win(m, end), true).map((r) => r.d) : [];
  const fmt = (v) => fmtValue(m, v);
  return {
    kind: "metric", id: m.id, fn: m.fn, title: m.title, owner: m.owner, impactTier: m.impactTier, dependsOn: m.dependsOn,
    better: m.better, window: m.window, value, prev, thr: { green: m.green, red: m.red }, fmt: { unit: m.unit, decimals: m.decimals, prefix: m.prefix, scale: m.scale, signed: m.signed }, display: fmt(value), prevDisplay: fmt(prev),
    status: statusFor(m, value), lastStatus: statusFor(m, prev),
    targetText: `${m.better === "higher" ? "≥" : "≤"} ${fmt(m.green)}`, redText: `${m.better === "higher" ? "<" : ">"} ${fmt(m.red)}`,
    detail, detailLabel: m.detailLabel, ask: m.ask && statusFor(m, value) !== "green" ? m.ask : undefined,
    series: series.map((s) => ({ ...s, display: fmt(s.v) })), sql: m.sql.replace(/\s+/g, " ").trim(), tables: m.tables,
    asOfLabel: m.window === "today" ? `today at ${CHECK_TIME}` : `7 days to ${shift(asOf, -1)}`,
  };
});

// 4. Milestone projects + owner updates from the inbox (any shape: array, {updates:[]}, loose field names).
const projFile = P("data/projects.json");
const proj = JSON.parse(fs.readFileSync(projFile, "utf8"));
const inboxDir = P("data/inbox");
fs.mkdirSync(path.join(inboxDir, "processed"), { recursive: true });
const changes = [];
for (const file of fs.readdirSync(inboxDir).filter((f) => f.endsWith(".json")).sort()) {
  const raw = JSON.parse(fs.readFileSync(path.join(inboxDir, file), "utf8"));
  const list = Array.isArray(raw) ? raw : raw.updates || raw.projects || [raw];
  for (const u of list) {
    const key = String(u.id || u.project || u.title || "").toLowerCase();
    const p = proj.projects.find((x) => x.id.toLowerCase() === key || x.title.toLowerCase() === key);
    if (!p) { console.warn(`  ! ${file}: no project matches "${key}"`); continue; }
    const before = { status: p.status, progress: p.progress, due: p.due, owner: p.owner };
    const st = normalizeStatus(u.status ?? u.rag ?? u.health);
    if (st) p.status = st;
    const prog = u.progress ?? u.pct ?? u["% done"] ?? u.percent;
    if (prog != null) p.progress = Math.max(0, Math.min(100, parseInt(prog, 10)));
    for (const k of ["owner", "due", "note", "ask", "win"]) if (u[k] != null) p[k] = u[k];
    if ("blocker" in u) { if (u.blocker) p.blocker = u.blocker; else delete p.blocker; }
    p.lastUpdate = u.date || asOf;
    changes.push({ id: p.id, title: p.title, file, before, after: { status: p.status, progress: p.progress, due: p.due, owner: p.owner } });
    console.log(`  inbox ${file}: ${p.id} ${before.status} → ${p.status}, ${before.progress}% → ${p.progress}%`);
  }
  fs.renameSync(path.join(inboxDir, file), path.join(inboxDir, "processed", `${asOf}-${file}`));
}
// Weekly rollover (Monday's run): this week's project statuses become "last week" for the next comparison.
if (args.includes("--rollover")) for (const p of proj.projects) p.lastStatus = p.status;
fs.writeFileSync(projFile, JSON.stringify(proj, null, 1) + "\n");
const projectItems = proj.projects.map((p) => ({ kind: "project", ...p }));

// 5. Store desk: what store ops needs to act on before opening.
const rows = (sql) => q(sql, { today: asOf, yesterday: shift(asOf, -1), check: CHECK_TIME }, true);
const att = rows(`SELECT COUNT(*) AS rostered, COUNT(a.staff_id) AS logged FROM roster r LEFT JOIN attendance a ON a.date = r.date AND a.staff_id = r.staff_id AND a.login_at <= :check WHERE r.date = :today`)[0];
const storeRows = rows(`SELECT s.store_id, s.name, s.city, s.country, s.daily_target_inr AS target,
    (SELECT COUNT(*) FROM roster r WHERE r.store_id = s.store_id AND r.date = :today) AS rostered,
    (SELECT COUNT(*) FROM attendance a WHERE a.store_id = s.store_id AND a.date = :today AND a.login_at <= :check) AS logged,
    (SELECT COUNT(*) FROM roster r JOIN staff p ON p.staff_id = r.staff_id AND p.role = 'optometrist' WHERE r.store_id = s.store_id AND r.date = :today) AS opto_rostered,
    (SELECT COUNT(*) FROM attendance a JOIN staff p ON p.staff_id = a.staff_id AND p.role = 'optometrist' WHERE a.store_id = s.store_id AND a.date = :today AND a.login_at <= :check) AS opto_logged,
    (SELECT revenue_inr FROM sales_daily d WHERE d.store_id = s.store_id AND d.date = :yesterday) AS rev_yday
  FROM stores s ORDER BY s.store_id`).map((r) => ({ ...r, pctTarget: Math.round((100 * r.rev_yday) / r.target) }));
const missingNames = (r) => rows(`SELECT p.name || ' (' || replace(p.role, '_', ' ') || ')' AS n FROM roster r JOIN staff p ON p.staff_id = r.staff_id
  LEFT JOIN attendance a ON a.date = r.date AND a.staff_id = r.staff_id AND a.login_at <= :check WHERE r.date = :today AND r.store_id = '${r.store_id}' AND a.staff_id IS NULL`).map((x) => x.n);
storeRows.forEach((r) => { r.missing = r.rostered - r.logged > 0 ? missingNames(r) : []; });
const storeDesk = {
  checkTime: CHECK_TIME, date: asOf, rostered: att.rostered, loggedIn: att.logged, stores: storeRows.length,
  noOptometrist: storeRows.filter((r) => r.opto_rostered > 0 && r.opto_logged === 0).map((r) => r.name),
  shortStaffed: storeRows.filter((r) => r.rostered - r.logged >= 2 && !(r.opto_rostered > 0 && r.opto_logged === 0)).map((r) => `${r.name} (${r.rostered - r.logged} missing)`),
  belowTarget: storeRows.filter((r) => r.pctTarget < 80).sort((a, b) => a.pctTarget - b.pctTarget).slice(0, 6).map((r) => `${r.name} ${r.pctTarget}%`),
};

// 6. Digest.
const dg = buildDigest(FUNCTIONS, [...metricItems, ...projectItems], asOf, { checks, storeDesk });
const repo = process.env.GITHUB_REPOSITORY;
const runUrl = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
const stamp = istNow.toISOString().slice(11, 16);
const why = { schedule: "the 08:45 IST schedule", push: "an owner update", workflow_dispatch: "a manual run", manual: "a local run" }[trigger] || trigger;
const meta = { generatedBy: `Sent automatically by GitHub Actions, triggered by ${why}, at ${stamp} IST on ${asOf}.`, appUrl: process.env.APP_URL || "", cc: process.env.DIGEST_CC || "" };

fs.mkdirSync(P("digest"), { recursive: true });
fs.writeFileSync(P("digest/latest-email.html"), renderEmail(dg, meta));
fs.writeFileSync(P("digest/latest.md"), renderMarkdown(dg, meta));
const subject = `Leadership brief ${asOf}: ${dg.counts.red} red · top 3: ${dg.top.map((p) => p.title).join(" / ")}`;
fs.writeFileSync(P("digest/subject.txt"), subject.length > 240 ? subject.slice(0, 237) + "…" : subject);

const runsFile = P("digest/runs.json");
const runs = fs.existsSync(runsFile) ? JSON.parse(fs.readFileSync(runsFile, "utf8")) : [];
runs.unshift({ at: new Date().toISOString(), asOf, trigger, runUrl, changes, top: dg.top.map((p) => p.id), counts: dg.counts, checksOk: dg.checksOk });
fs.writeFileSync(runsFile, JSON.stringify(runs.slice(0, 30), null, 1) + "\n");

// 7. Build the app: one self-contained HTML file with the digest and the shared logic inlined.
const lib = fs.readFileSync(P("scripts/lib.mjs"), "utf8").replace(/^export /gm, "");
const tpl = fs.readFileSync(P("app/template.html"), "utf8");
const payload = JSON.stringify({ functions: FUNCTIONS, items: [...metricItems, ...projectItems], asOf, checks, storeDesk, storeRows,
  tables, runs: runs.slice(0, 10), meta, emailHtml: renderEmail(dg, meta) }).replace(/</g, "\\u003c");
fs.writeFileSync(P("index.html"), tpl.replace("/*__LIB__*/", () => lib).replace("/*__DATA__*/null", () => payload));

console.log(`\n${subject}`);
dg.top.forEach((p, i) => console.log(`  ${i + 1}. [${p.status}] ${p.id} ${p.title} (score ${p.score})${p.linked.length ? " → also " + p.linked.join(", ") : ""}`));
console.log(`  counts ${JSON.stringify(dg.counts)} · checks ${checks.filter((c) => c.ok).length}/${checks.length} · inbox changes ${changes.length}`);
console.log(`  attendance ${att.logged}/${att.rostered} · no optometrist: ${storeDesk.noOptometrist.join(", ") || "none"}`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `checks_ok=${dg.checksOk}\nred=${dg.counts.red}\n`);
