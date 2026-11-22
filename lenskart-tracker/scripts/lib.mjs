// Shared logic: risk scoring, top-3 selection and digest rendering.
// Runs in Node (GitHub Actions) and is inlined into the browser app at build time,
// so it stays dependency-free and uses plain `export function` declarations.

export const RANK = { green: 0, amber: 1, red: 2 };
export const LABEL = { green: "Green", amber: "Amber", red: "Red" };
const DAY = 86400000;
const t = (s) => new Date(s + "T00:00:00Z").getTime();

// Turns whatever a function head typed into red / amber / green.
export function normalizeStatus(v) {
  const s = String(v || "").trim().toLowerCase();
  if (/^(r|red|🔴|at risk|off track|blocked|critical)$/.test(s)) return "red";
  if (/^(a|amber|yellow|y|blue|b|🟠|🟡|🔵|watch|some risk)$/.test(s)) return "amber";
  if (/^(g|green|🟢|on track|done|complete|ok)$/.test(s)) return "green";
  return null;
}

export function statusFor(m, v) {
  if (v == null || Number.isNaN(v)) return "amber";
  if (m.better === "higher") return v >= m.green ? "green" : v < m.red ? "red" : "amber";
  return v <= m.green ? "green" : v > m.red ? "red" : "amber";
}

export function fmtValue(m, v) {
  if (v == null || Number.isNaN(v)) return "no data";
  const x = v / (m.scale || 1);
  const n = Math.abs(x).toLocaleString("en-IN", { minimumFractionDigits: m.decimals, maximumFractionDigits: m.decimals });
  const sign = x < 0 ? "−" : m.signed && x > 0 ? "+" : "";
  const pre = m.prefix === true ? "₹" : m.prefix || "";
  return `${sign}${pre}${n}${m.unit || ""}`;
}
export const fmtDate = (s) => new Date(t(s)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

// Score one item. Higher = needs leadership attention sooner. Green scores 0.
export function assess(p, asOf) {
  const reasons = [];
  let score = { red: 50, amber: 20, green: 0 }[p.status] ?? 0;
  const worsened = RANK[p.status] > RANK[p.lastStatus];
  const improved = RANK[p.status] < RANK[p.lastStatus];
  if (worsened) { score += 25; reasons.push(`Went ${LABEL[p.lastStatus]} → ${LABEL[p.status]} since last week`); }
  let extra = {};
  if (p.kind === "metric") {
    reasons.unshift(`${p.display} against a target of ${p.targetText}`);
    if (p.prevDisplay) reasons.push(`was ${p.prevDisplay} ${p.window === "today" ? "same day last week" : "the week before"}`);
    const wrongWay = p.better === "higher" ? p.value < p.prev : p.value > p.prev;
    if (wrongWay && p.status !== "green") score += 6;
  } else {
    const slip = Math.round((t(p.due) - t(p.originalDue || p.due)) / DAY);
    if (slip > 0) { score += Math.min(20, Math.ceil(slip / 2)); reasons.push(`Deadline pushed back ${slip} days`); }
    const daysLeft = Math.round((t(p.due) - t(asOf)) / DAY);
    if (p.progress < 100) {
      if (daysLeft < 0) { score += 20; reasons.push(`Overdue by ${-daysLeft} days`); }
      else if (daysLeft <= 21 && p.progress < 75) { score += 12; reasons.push(`Due in ${daysLeft} days at ${p.progress}% done`); }
    }
    const stale = Math.round((t(asOf) - t(p.lastUpdate)) / DAY);
    if (stale > 7) { score += 10; reasons.push(`No update from the owner for ${stale} days`); }
    if (p.blocker) score += 10;
    extra = { slip, daysLeft, stale };
  }
  score += (p.impactTier || 1) * 8;
  if (p.status === "green") score = 0;
  return { ...p, ...extra, score, reasons, worsened, improved };
}

// Pick the n most urgent items. Anything caused by an item already on the list is folded
// under it, so leadership sees the root cause once with its knock-on effects.
export function pickTop(items, n = 3) {
  const ranked = items.filter((p) => p.status !== "green" || p.mismatch).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const top = [];
  for (const p of ranked) {
    if (top.length >= n) break;
    const parent = top.find((x) => x.id === p.dependsOn);
    if (parent) { parent.linked.push(p.id); continue; }
    const kids = top.filter((x) => x.dependsOn === p.id);
    const entry = { ...p, linked: kids.flatMap((k) => [k.id, ...k.linked]) };
    if (kids.length) { const at = top.indexOf(kids[0]); for (const k of kids) top.splice(top.indexOf(k), 1); top.splice(at, 0, entry); }
    else top.push(entry);
  }
  // Everything a listed root cause is causing travels with it, and is not repeated lower down.
  for (const x of top) x.linked = [...new Set([...x.linked, ...(x.causes || [])])];
  // Root causes rank at least as high as the worst thing they cause.
  for (const x of top) x.score = Math.max(x.score, ...x.linked.map((id) => items.find((i) => i.id === id)?.score || 0));
  return top.sort((a, b) => b.score - a.score);
}

export function isoWeek(asOf) {
  const d = new Date(t(asOf));
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - jan4) / DAY - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
}

// items: metrics (already valued) + projects. extras: { checks, storeDesk }
export function buildDigest(functions, rawItems, asOf, extras = {}) {
  const fnName = Object.fromEntries(functions.map((f) => [f.id, f.name]));
  const all = rawItems.map((p) => ({ ...assess(p, asOf), fnName: fnName[p.fn] }));
  for (const p of all) {
    // Blast radius: a root cause matters more for every problem it is causing.
    const kids = all.filter((k) => k.dependsOn === p.id && k.status !== "green");
    p.causes = kids.map((k) => k.id);
    if (kids.length && p.status !== "green") { p.score += 8 * kids.length; p.reasons.push(`Causing ${kids.length} other problem${kids.length > 1 ? "s" : ""} in the data`); }
    // Optimism check: the owner's status is better than what the data under it shows.
    const redKid = kids.find((k) => k.kind === "metric" && RANK[k.status] > RANK[p.status]);
    if (p.kind === "project" && redKid) {
      p.mismatch = `Owner reports ${LABEL[p.status]}, but ${redKid.title.toLowerCase()} is ${LABEL[redKid.status]} in the data (${redKid.display})`;
      p.reasons.unshift(p.mismatch);
      p.score = Math.max(p.score, 0) + 15 + (p.status === "green" ? 40 : 0);
    }
  }
  const top = pickTop(all, 3);
  const byScore = (a, b) => b.score - a.score;
  const byFn = functions.map((f) => {
    const ps = all.filter((p) => p.fn === f.id);
    const c = { red: 0, amber: 0, green: 0 };
    ps.forEach((p) => c[p.status]++);
    return { ...f, counts: c, total: ps.length, worsened: ps.filter((p) => p.worsened).length, improved: ps.filter((p) => p.improved).length,
      worst: c.red ? "red" : c.amber ? "amber" : "green" };
  });
  const counts = { red: 0, amber: 0, green: 0 };
  all.forEach((p) => counts[p.status]++);
  const checks = extras.checks || [];
  return {
    asOf, week: isoWeek(asOf), all, top, byFn, counts, checks, storeDesk: extras.storeDesk || null,
    checksOk: checks.every((c) => c.ok),
    reds: all.filter((p) => p.status === "red").sort(byScore),
    ambers: all.filter((p) => p.status === "amber").sort(byScore),
    wins: all.filter((p) => p.status === "green" && (p.win || p.improved)),
    worsened: all.filter((p) => p.worsened).sort(byScore),
    improved: all.filter((p) => p.improved),
  };
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const covered = (dg, p) => dg.top.some((x) => x.id === p.id || x.linked.includes(p.id));
const facts = (p) => p.kind === "metric"
  ? `${p.fnName} · Owner: ${p.owner} · ${p.display} (target ${p.targetText})`
  : `${p.fnName} · Owner: ${p.owner} · Due ${fmtDate(p.due)} · ${p.progress}% done`;

// Email-safe HTML: tables and inline styles only, readable in Gmail and Outlook.
export function renderEmail(dg, meta = {}) {
  const C = { red: "#C62828", amber: "#B26A00", green: "#2E7D32", ink: "#14213D", mute: "#5B6475", line: "#E3E7EE", tint: "#F5F7FA" };
  const F = "font-family:Arial,Helvetica,sans-serif;";
  const dot = (s) => `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${C[s]};margin-right:6px;vertical-align:baseline"></span>`;
  const row = (p) => `<tr><td style="padding:10px 0;border-top:1px solid ${C.line}">
      <div style="${F}font-size:15px;font-weight:bold;line-height:1.35;color:${C.ink}">${dot(p.status)}${esc(p.title)}</div>
      <div style="${F}font-size:13px;line-height:1.5;color:${C.mute};margin-top:2px">${esc(facts(p))}</div>
      ${p.worsened ? `<div style="${F}font-size:13px;line-height:1.5;color:${C[p.status]};margin-top:2px">Was ${LABEL[p.lastStatus]} last week</div>` : ""}
      ${p.blocker ? `<div style="${F}font-size:13px;line-height:1.5;color:${C.ink};margin-top:2px">Blocker: ${esc(p.blocker)}</div>` : ""}
      ${p.note ? `<div style="${F}font-size:13px;line-height:1.5;color:${C.mute};margin-top:2px">${esc(p.note)}</div>` : ""}
    </td></tr>`;
  const head = (title, color, sub) => `<tr><td style="padding:26px 0 6px">
      <div style="${F}font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${color}">${title}</div>
      <div style="${F}font-size:13px;line-height:1.5;color:${C.mute};margin-top:4px">${sub}</div></td></tr>`;
  const topRows = dg.top.map((p, i) => `<tr><td style="padding:14px 16px;border-left:4px solid ${C[p.status]};background:${C.tint}">
      <div style="${F}font-size:12px;font-weight:bold;color:${C.mute}">${i + 1} · ${esc(p.fnName).toUpperCase()}</div>
      <div style="${F}font-size:17px;font-weight:bold;line-height:1.35;color:${C.ink};margin-top:6px">${esc(p.title)}</div>
      <div style="${F}font-size:13px;line-height:1.5;color:${C.mute};margin-top:2px">${dot(p.status)}${LABEL[p.status]}${p.worsened ? ` (was ${LABEL[p.lastStatus]})` : ""} · Owner: <b style="color:${C.ink}">${esc(p.owner)}</b>${p.kind === "project" ? ` · Due ${fmtDate(p.due)}` : ""}</div>
      <div style="${F}font-size:13px;line-height:1.5;color:${C.ink};margin-top:6px">${p.reasons.map(esc).join(" · ")}</div>
      ${p.blocker ? `<div style="${F}font-size:13px;line-height:1.5;color:${C.ink};margin-top:4px">Blocker: ${esc(p.blocker)}</div>` : ""}
      ${p.detail?.length ? `<div style="${F}font-size:13px;line-height:1.5;color:${C.ink};margin-top:4px">${esc(p.detailLabel || "Detail")}: ${p.detail.map(esc).join(", ")}</div>` : ""}
      ${p.linked.length ? `<div style="${F}font-size:13px;line-height:1.5;color:${C.mute};margin-top:4px">Also causing: ${p.linked.map((id) => { const x = dg.all.find((a) => a.id === id); return esc(x ? `${x.title} (${x.display || LABEL[x.status]})` : id); }).join("; ")}</div>` : ""}
      ${p.ask ? `<div style="${F}font-size:14px;font-weight:bold;line-height:1.5;color:${C.ink};margin-top:8px">Decision needed: ${esc(p.ask)}</div>` : ""}
    </td></tr><tr><td style="height:10px;line-height:10px">&nbsp;</td></tr>`).join("");
  const sd = dg.storeDesk;
  const storeBlock = sd ? head("Stores this morning", C.ink, `Attendance at ${esc(sd.checkTime)} today: ${sd.loggedIn} of ${sd.rostered} rostered staff logged in across ${sd.stores} stores.`) +
    (sd.noOptometrist.length ? `<tr><td style="${F}font-size:13px;line-height:1.6;color:${C.ink};padding:4px 0">${dot("red")}<b>No optometrist yet, so no eye tests:</b> ${sd.noOptometrist.map(esc).join(", ")}</td></tr>` : "") +
    (sd.shortStaffed.length ? `<tr><td style="${F}font-size:13px;line-height:1.6;color:${C.ink};padding:4px 0">${dot("amber")}<b>Two or more staff not logged in:</b> ${sd.shortStaffed.map(esc).join(", ")}</td></tr>` : "") +
    (sd.belowTarget.length ? `<tr><td style="${F}font-size:13px;line-height:1.6;color:${C.ink};padding:4px 0">${dot("amber")}<b>Under 80% of target yesterday:</b> ${sd.belowTarget.map(esc).join(", ")}</td></tr>` : "") : "";
  const reds = dg.reds.filter((p) => !covered(dg, p)), ambers = dg.ambers.filter((p) => !covered(dg, p));
  const fnRows = dg.byFn.map((f) => `<tr>
      <td style="${F}font-size:13px;color:${C.ink};padding:6px 0;border-top:1px solid ${C.line}">${dot(f.worst)}${esc(f.name)}</td>
      <td style="${F}font-size:13px;color:${C.red};padding:6px 0;border-top:1px solid ${C.line};text-align:right">${f.counts.red}</td>
      <td style="${F}font-size:13px;color:${C.amber};padding:6px 0;border-top:1px solid ${C.line};text-align:right">${f.counts.amber}</td>
      <td style="${F}font-size:13px;color:${C.green};padding:6px 0;border-top:1px solid ${C.line};text-align:right">${f.counts.green}</td></tr>`).join("");
  const checksLine = dg.checks.length ? (dg.checksOk
    ? `Data checks: all ${dg.checks.length} passed (freshness, links between tables, duplicates, finance reconciliation).`
    : `<b style="color:${C.red}">Data checks failed: ${dg.checks.filter((c) => !c.ok).map((c) => esc(c.title)).join("; ")}. Treat the numbers below with care.</b>`) : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="margin:0;padding:0;background:#EEF1F5">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF1F5"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#FFFFFF;border-radius:8px"><tr><td style="padding:28px 28px 32px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td>
  <div style="${F}font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${C.mute}">Lenskart leadership brief · ${fmtDate(dg.asOf)} · Week ${dg.week}</div>
  <div style="${F}font-size:24px;font-weight:bold;line-height:1.25;color:${C.ink};margin-top:10px">${dg.top.length} things need your attention this week</div>
  <div style="${F}font-size:14px;line-height:1.5;color:${C.mute};margin-top:8px">${dg.all.length} tracked items across ${dg.byFn.length} functions:
    <b style="color:${C.red}">${dg.counts.red} red</b>, <b style="color:${C.amber}">${dg.counts.amber} amber</b>, <b style="color:${C.green}">${dg.counts.green} green</b>.
    ${dg.worsened.length} got worse since last week, ${dg.improved.length} got better.</div>
  ${!dg.checksOk && dg.checks.length ? `<div style="${F}font-size:13px;line-height:1.5;margin-top:10px">${checksLine}</div>` : ""}
</td></tr>
<tr><td style="height:18px;line-height:18px">&nbsp;</td></tr>
${topRows}
${storeBlock}
${reds.length ? head("Red · fix now", C.red, "Off track. The owner needs a decision or resources this week.") + reds.map(row).join("") : ""}
${ambers.length ? head("Amber · watch", C.amber, "Some risk. Look again next week.") + ambers.map(row).join("") : ""}
${dg.wins.length ? head("Green · wins", C.green, "Good news worth knowing.") + dg.wins.map((p) => row({ ...p, worsened: false, blocker: "", note: p.win || "Back to green this week" })).join("") : ""}
<tr><td style="padding-top:26px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr><td style="${F}font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${C.mute};padding-bottom:6px">By function</td>
  <td style="${F}font-size:12px;color:${C.red};text-align:right">Red</td><td style="${F}font-size:12px;color:${C.amber};text-align:right">Amber</td><td style="${F}font-size:12px;color:${C.green};text-align:right">Green</td></tr>
  ${fnRows}</table></td></tr>
<tr><td style="padding-top:26px;${F}font-size:12px;line-height:1.6;color:${C.mute}">
  ${dg.checksOk ? checksLine + "<br>" : ""}${meta.generatedBy ? esc(meta.generatedBy) + "<br>" : ""}${meta.appUrl ? `Full tracker: <a href="${esc(meta.appUrl)}" style="color:${C.ink}">${esc(meta.appUrl)}</a><br>` : ""}Sample data generated with AI for a prototype. Names and figures are illustrative.
</td></tr>
</table></td></tr></table></td></tr></table></body></html>`;
}

// GitHub-flavoured markdown for the issue that GitHub emails to repository watchers.
export function renderMarkdown(dg, meta = {}) {
  const E = { red: "🔴", amber: "🟠", green: "🟢" };
  const line = (p) => `- ${E[p.status]} **${p.title}** · ${facts(p)}${p.worsened ? ` · was ${LABEL[p.lastStatus]}` : ""}` +
    (p.blocker ? `\n  Blocker: ${p.blocker}` : "") + (p.note ? `\n  ${p.note}` : "");
  let md = `## ${dg.top.length} things need attention this week\n\n` +
    `${dg.all.length} tracked items across ${dg.byFn.length} functions: ${E.red} ${dg.counts.red} red · ${E.amber} ${dg.counts.amber} amber · ${E.green} ${dg.counts.green} green. ` +
    `${dg.worsened.length} got worse since last week, ${dg.improved.length} got better.\n\n`;
  if (dg.checks.length && !dg.checksOk) md += `> [!WARNING]\n> Data checks failed: ${dg.checks.filter((c) => !c.ok).map((c) => c.title).join("; ")}\n\n`;
  dg.top.forEach((p, i) => {
    md += `### ${i + 1}. ${E[p.status]} ${p.title}\n**${p.fnName}** · Owner: **${p.owner}** · ${LABEL[p.status]}${p.worsened ? ` (was ${LABEL[p.lastStatus]})` : ""}${p.kind === "project" ? ` · Due ${fmtDate(p.due)} · ${p.progress}% done` : ""}\n\n` +
      `- ${p.reasons.join(" · ")}\n` + (p.blocker ? `- Blocker: ${p.blocker}\n` : "") +
      (p.detail?.length ? `- ${p.detailLabel || "Detail"}: ${p.detail.join(", ")}\n` : "") +
      (p.linked.length ? `- Also causing: ${p.linked.map((id) => { const x = dg.all.find((a) => a.id === id); return x ? `${x.title} (${x.display || LABEL[x.status]})` : id; }).join("; ")}\n` : "") +
      (p.ask ? `- **Decision needed:** ${p.ask}\n` : "") + "\n";
  });
  const sd = dg.storeDesk;
  if (sd) {
    md += `### 🏬 Stores this morning\nAttendance at ${sd.checkTime}: **${sd.loggedIn} of ${sd.rostered}** rostered staff logged in across ${sd.stores} stores.\n`;
    if (sd.noOptometrist.length) md += `- ${E.red} No optometrist yet, so no eye tests: ${sd.noOptometrist.join(", ")}\n`;
    if (sd.shortStaffed.length) md += `- ${E.amber} Two or more staff not logged in: ${sd.shortStaffed.join(", ")}\n`;
    if (sd.belowTarget.length) md += `- ${E.amber} Under 80% of target yesterday: ${sd.belowTarget.join(", ")}\n`;
    md += "\n";
  }
  const reds = dg.reds.filter((p) => !covered(dg, p)), ambers = dg.ambers.filter((p) => !covered(dg, p));
  if (reds.length) md += `### ${E.red} Red · fix now\n${reds.map(line).join("\n")}\n\n`;
  if (ambers.length) md += `<details><summary>${E.amber} Amber · watch (${ambers.length})</summary>\n\n${ambers.map(line).join("\n")}\n\n</details>\n\n`;
  if (dg.wins.length) md += `### ${E.green} Green · wins\n${dg.wins.map((p) => `- ${E.green} **${p.title}** · ${p.owner}: ${p.win || "back to green this week"}`).join("\n")}\n\n`;
  md += `| Function | 🔴 | 🟠 | 🟢 | Worse |\n|---|---:|---:|---:|---:|\n` +
    dg.byFn.map((f) => `| ${f.name} | ${f.counts.red} | ${f.counts.amber} | ${f.counts.green} | ${f.worsened} |`).join("\n") + "\n\n";
  if (dg.checks.length) md += `<details><summary>Data checks: ${dg.checks.filter((c) => c.ok).length}/${dg.checks.length} passed</summary>\n\n${dg.checks.map((c) => `- ${c.ok ? "✅" : "❌"} ${c.title}${c.ok ? "" : ` (${c.bad} bad rows)`}`).join("\n")}\n\n</details>\n\n`;
  md += `---\n${meta.generatedBy || ""}${meta.appUrl ? ` · [Open the tracker](${meta.appUrl})` : ""}${meta.cc ? `\n\ncc ${meta.cc}` : ""}\n\n_Sample data generated with AI for a prototype. Names and figures are illustrative._\n`;
  return md;
}
