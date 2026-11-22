// Generates a plausible sample warehouse (CSV tables) for the 28 days up to --as-of.
// Every row is seeded by its own date and keys, so history stays stable when it is
// regenerated on a later day; only the new day is added. The patterns are written to
// tell connected stories across tables (a hub backlog drives late deliveries, which
// drive "where is my order" tickets, which slow WhatsApp reply times).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data/db");
const DAYS = 28;
const DAY = 86400000;

export function generate(asOf, checkTime = "08:45") {
  const T = (s) => new Date(s + "T00:00:00Z").getTime();
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const todayMs = T(asOf);
  const dates = Array.from({ length: DAYS }, (_, i) => iso(todayMs - (DAYS - i) * DAY)); // up to yesterday
  const ago = (d) => Math.round((todayMs - T(d)) / DAY); // 1 = yesterday

  // Deterministic randomness keyed by strings.
  const hash = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
  const rnd = (...k) => { let a = hash(k.join("|")); a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const between = (lo, hi, ...k) => lo + (hi - lo) * rnd(...k);
  const ramp = (d, startAgo, from, to) => { const a = ago(d); return a >= startAgo ? from : from + (to - from) * ((startAgo - a) / (startAgo - 1)); };
  const dowF = (d) => [1.3, 0.85, 0.88, 0.92, 0.95, 1.05, 1.35][new Date(T(d)).getUTCDay()]; // Sun..Sat

  // ---------- stores ----------
  const cities = [
    ["Delhi", "Delhi", 1, 5], ["Mumbai", "Maharashtra", 1, 5], ["Bengaluru", "Karnataka", 1, 5], ["Hyderabad", "Telangana", 1, 4],
    ["Chennai", "Tamil Nadu", 1, 4], ["Kolkata", "West Bengal", 1, 3], ["Pune", "Maharashtra", 1, 3], ["Ahmedabad", "Gujarat", 1, 3],
    ["Jaipur", "Rajasthan", 2, 3], ["Lucknow", "Uttar Pradesh", 2, 3], ["Indore", "Madhya Pradesh", 2, 2], ["Chandigarh", "Punjab", 2, 2],
    ["Kochi", "Kerala", 2, 2], ["Coimbatore", "Tamil Nadu", 2, 2], ["Nagpur", "Maharashtra", 2, 2], ["Surat", "Gujarat", 2, 2],
    ["Patna", "Bihar", 3, 2], ["Ranchi", "Jharkhand", 3, 1], ["Dehradun", "Uttarakhand", 3, 1], ["Mysuru", "Karnataka", 3, 1],
    ["Udaipur", "Rajasthan", 3, 1], ["Varanasi", "Uttar Pradesh", 3, 2], ["Guwahati", "Assam", 3, 2], ["Raipur", "Chhattisgarh", 3, 2],
  ];
  const intl = [["Dubai", "UAE", 4, 160000], ["Abu Dhabi", "UAE", 2, 150000], ["Riyadh", "Saudi Arabia", 4, 150000], ["Jeddah", "Saudi Arabia", 2, 140000], ["Singapore", "Singapore", 4, 180000]];
  const areas = ["Central", "Mall Road", "Station Road", "High Street", "North", "South", "East", "West"];
  const target = { 1: 140000, 2: 100000, 3: 75000 };
  const stores = [];
  for (const [city, state, tier, n] of cities)
    for (let i = 0; i < n; i++)
      stores.push({ store_id: `IN-${city.slice(0, 3).toUpperCase()}-${String(i + 1).padStart(2, "0")}`, name: `${city} ${areas[i]}`, city, state, country: "India", tier, daily_target_inr: target[tier] });
  for (const [city, country, n, tgt] of intl)
    for (let i = 0; i < n; i++)
      stores.push({ store_id: `${country === "UAE" ? "AE" : country === "Singapore" ? "SG" : "SA"}-${city.slice(0, 3).toUpperCase()}-${String(i + 1).padStart(2, "0")}`, name: `${city} ${areas[i]}`, city, state: city, country, tier: 1, daily_target_inr: tgt });

  // ---------- staff, roster, attendance ----------
  const first = ["Aarav", "Diya", "Kabir", "Isha", "Vivaan", "Ananya", "Reyansh", "Saanvi", "Arjun", "Myra", "Ayaan", "Kiara", "Rohan", "Meera", "Dev", "Sara", "Nikhil", "Pooja", "Imran", "Fatima", "Karthik", "Lakshmi", "Harpreet", "Joseph"];
  const last = ["Sharma", "Iyer", "Khan", "Reddy", "Das", "Patel", "Singh", "Nair", "Gupta", "Menon", "Joshi", "Bose", "Kulkarni", "Fernandes", "Ali", "Rao"];
  const staff = [];
  for (const s of stores) {
    const roles = ["store_manager", "optometrist", ...(s.tier === 1 && s.country === "India" ? ["optometrist"] : []), "sales_associate", "sales_associate", ...(s.country === "India" ? ["sales_associate"] : [])];
    roles.forEach((role, i) => staff.push({ staff_id: `${s.store_id}-${String(i + 1).padStart(2, "0")}`, store_id: s.store_id, role,
      name: `${first[hash(s.store_id + i + "f") % first.length]} ${last[hash(s.store_id + i + "l") % last.length]}`, weekly_off: hash(s.store_id + i) % 7 }));
  }
  // Each day 1-4 stores lose their optometrist for the morning (sick, stuck in traffic, on leave without cover).
  const optoGap = (d) => new Set([...stores].sort((a, b) => rnd(d, "gap", a.store_id) - rnd(d, "gap", b.store_id)).slice(0, 1 + Math.floor(rnd(d, "gapn") * 4)).map((s) => s.store_id));
  const roster = [], attendance = [];
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
  const [ch, cm] = checkTime.split(":").map(Number);
  for (const d of [...dates.slice(-14), asOf]) {
    const dow = new Date(T(d)).getUTCDay();
    const gaps = optoGap(d);
    for (const p of staff) {
      if (p.weekly_off === dow) continue;
      roster.push({ date: d, staff_id: p.staff_id, store_id: p.store_id, shift_start: "08:30" });
      const opto = p.role === "optometrist";
      const absent = rnd(d, p.staff_id, "att") < (opto ? 0.01 : 0.02) || (opto && gaps.has(p.store_id));
      if (absent) continue;
      const late = rnd(d, p.staff_id, "late") < (opto ? 0.02 : 0.04);
      const mins = late ? 8 * 60 + 40 + between(0, 45, d, p.staff_id, "lm") : 8 * 60 + 5 + between(0, 32, d, p.staff_id, "m");
      if (d === asOf && mins > ch * 60 + cm) continue; // not in yet at check time
      attendance.push({ date: d, staff_id: p.staff_id, store_id: p.store_id, login_at: hhmm(mins) });
    }
  }

  // ---------- store sales ----------
  const sales = [];
  for (const d of dates) for (const s of stores) {
    const quality = between(0.9, 1.08, s.store_id, "q");
    const ksa = s.country === "Saudi Arabia" ? ramp(d, 21, 0.95, 0.7) : 1; // licence delays cut trading hours
    const season = s.country === "India" ? 1.07 : 1;
    const rev = Math.round(s.daily_target_inr * dowF(d) * quality * ksa * season * between(0.86, 1.12, d, s.store_id));
    const aov = s.country === "India" ? 2600 : 4200;
    const orders = Math.max(1, Math.round(rev / aov * between(0.9, 1.1, d, s.store_id, "o")));
    const eye = Math.round(orders * between(1.2, 1.5, d, s.store_id, "e"));
    sales.push({ date: d, store_id: s.store_id, revenue_inr: rev, orders, eye_tests: eye, footfall: Math.round(eye * between(2, 2.6, d, s.store_id, "f")) });
  }

  // ---------- online ----------
  const online = [];
  for (const d of dates) for (const [ch2, share] of [["app", 0.8], ["web", 0.2]]) {
    const sessions = Math.round(150000 * share * dowF(d) * between(0.93, 1.07, d, ch2, "s"));
    const conv = ch2 === "app" ? ramp(d, 10, 3.15, 2.85) : 2.2; // dip after the 3 Nov checkout release
    const orders = Math.round(sessions * conv / 100 * between(0.97, 1.03, d, ch2, "c"));
    online.push({ date: d, channel: ch2, sessions, tryon_sessions: Math.round(sessions * between(0.28, 0.34, d, ch2, "t")), orders,
      revenue_inr: Math.round(orders * between(2100, 2350, d, ch2, "r")),
      crash_free_pct: ch2 === "app" ? +(ago(d) <= 6 ? between(98.9, 99.3, d, "cr") : between(99.5, 99.8, d, "cr")).toFixed(2) : 100 });
  }

  // ---------- fulfilment (hub backlog drives late deliveries) ----------
  const hubs = [["Gurugram", 0.4], ["Mumbai", 0.25], ["Bengaluru", 0.25], ["Kolkata", 0.1]];
  const fulfil = [], lateByDay = {};
  for (const [hub, share] of hubs) {
    let backlog = Math.round(300 * share * 4);
    for (const d of dates) {
      const onl = online.filter((o) => o.date === d).reduce((a, o) => a + o.orders, 0);
      const received = Math.round(onl * share);
      const cutover = hub === "Gurugram" && ago(d) <= 21;
      const capacity = Math.round(received * (cutover ? between(0.84, 0.96, d, hub) : between(1.0, 1.08, d, hub)));
      const shipped = Math.min(received + backlog, capacity);
      backlog = received + backlog - shipped;
      const delivery = +(2.3 + (backlog / Math.max(received, 1)) * 0.25 + between(-0.1, 0.1, d, hub, "dd")).toFixed(2);
      const late = Math.round(shipped * Math.min(0.6, Math.max(0.03, (delivery - 2.3) * 0.18 + 0.04)));
      lateByDay[d] = (lateByDay[d] || 0) + late;
      fulfil.push({ date: d, hub, orders_received: received, orders_shipped: shipped, backlog_eod: backlog,
        pick_rate_per_hr: Math.round((cutover ? 68 : 100) * between(0.95, 1.05, d, hub, "p")), avg_delivery_days: delivery, late_deliveries: late });
    }
  }

  // ---------- lens lab ----------
  const lab = [];
  for (const d of dates) {
    const jobs = sales.filter((s) => s.date === d).reduce((a, s) => a + s.orders, 0) + online.filter((o) => o.date === d).reduce((a, o) => a + o.orders, 0);
    for (const [name, share, rate] of [["Bhiwadi", 0.7, ramp(d, 14, 0.023, 0.037)], ["Bengaluru", 0.3, 0.019]]) {
      const j = Math.round(jobs * share);
      lab.push({ date: d, lab: name, jobs: j, remakes: Math.round(j * rate * between(0.9, 1.1, d, name)) });
    }
  }

  // ---------- customer support ----------
  const support = [];
  for (const d of dates) {
    const wismoTotal = Math.round(380 + (lateByDay[d] || 0) * 0.55);
    for (const [chn, share] of [["whatsapp", 0.6], ["phone", 0.25], ["email", 0.15]]) {
      const wismo = Math.round(wismoTotal * share);
      const created = Math.round(2400 * share * between(0.92, 1.08, d, chn)) + wismo;
      support.push({ date: d, channel: chn, tickets_created: created, tickets_resolved: Math.round(created * between(0.9, 0.98, d, chn, "r")), wismo_tickets: wismo,
        median_first_reply_min: Math.round((chn === "whatsapp" ? 60 : chn === "phone" ? 4 : 240) * (1 + wismoTotal / 1400) * between(0.92, 1.08, d, chn, "m")) });
    }
  }

  // ---------- Gold membership ----------
  const gold = [];
  let active = 2104000;
  for (const d of dates) {
    const due = Math.round(2400 * between(0.9, 1.1, d, "due"));
    const done = Math.round(due * ramp(d, 28, 0.62, 0.53) * between(0.97, 1.03, d, "done"));
    const signups = Math.round(1800 * dowF(d) * between(0.9, 1.1, d, "sign"));
    active += signups + done - due;
    gold.push({ date: d, active_members: active, renewals_due: due, renewals_done: done, new_signups: signups });
  }

  // ---------- marketing ----------
  const mktg = [];
  for (const d of dates) for (const [chn, spend, cac] of [["meta", 1800000, ago(d) <= 7 ? 940 : 790], ["google", 1400000, 820], ["tv", 2500000, 1450], ["influencer", 400000, 520]]) {
    const sp = Math.round(spend * between(0.85, 1.15, d, chn));
    mktg.push({ date: d, channel: chn, spend_inr: sp, new_customers: Math.round(sp / (cac * between(0.93, 1.07, d, chn, "c"))) });
  }

  // ---------- finance ledger (must reconcile to stores + online) ----------
  const finance = [];
  for (const d of dates) {
    const gross = sales.filter((s) => s.date === d).reduce((a, s) => a + s.revenue_inr, 0) + online.filter((o) => o.date === d).reduce((a, o) => a + o.revenue_inr, 0);
    const cogs = Math.round(gross * 0.38);
    finance.push({ date: d, gross_revenue_inr: gross, cogs_inr: cogs, cash_collected_inr: Math.round(gross * between(0.95, 0.99, d, "cash")),
      inventory_value_inr: Math.round(cogs * ramp(d, 28, 106, 115) * between(0.99, 1.01, d, "inv")) });
  }

  const tables = { stores, staff, roster, attendance, sales_daily: sales, online_daily: online, fulfilment_daily: fulfil, lab_daily: lab, support_daily: support, gold_daily: gold, marketing_daily: mktg, finance_daily: finance };
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, rows] of Object.entries(tables)) {
    const cols = Object.keys(rows[0]);
    const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => { const v = r[c] ?? ""; return /[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v; }).join(","))].join("\n");
    fs.writeFileSync(path.join(OUT, `${name}.csv`), csv + "\n");
  }
  return Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--as-of");
  console.log(generate(i > 0 ? process.argv[i + 1] : new Date().toISOString().slice(0, 10)));
}
