// Every tracked metric is a SQL query over the warehouse plus a target.
// Status is decided by thresholds, never typed in by hand:
//   better "higher": value >= green → Green, value < red → Red, otherwise Amber
//   better "lower":  value <= green → Green, value > red → Red, otherwise Amber
// window "7d": :start..:end is the last 7 days to yesterday, compared with the 7 days before.
// window "today": :start = :end = today (morning snapshot), compared with the same day last week.
//
// Owners are fictional sample names.

export const FUNCTIONS = [
  { id: "stores", name: "Stores & Eye Care", head: "Ritika Malhotra" },
  { id: "supply", name: "Supply Chain & Manufacturing", head: "Arjun Menon" },
  { id: "mktg", name: "Marketing & Brand", head: "Neha Kapoor" },
  { id: "tech", name: "App & Product", head: "Vikram Rao" },
  { id: "cs", name: "Customer Service", head: "Shreya Bose" },
  { id: "retention", name: "Retention & Gold", head: "Sahil Arora" },
  { id: "finance", name: "Finance", head: "Karan Shah" },
  { id: "intl", name: "International", head: "Meera Iyer" },
];

const rosterAt = `FROM roster r LEFT JOIN attendance a ON a.date = r.date AND a.staff_id = r.staff_id AND a.login_at <= :check
  WHERE r.date BETWEEN :start AND :end`;

export const METRICS = [
  // ---- Stores & Eye Care
  { id: "ST-ATT", fn: "stores", owner: "Ritika Malhotra", title: "Opening-shift attendance at 08:45", unit: "%", decimals: 1,
    better: "higher", green: 96, red: 90, window: "today", impactTier: 2, tables: ["roster", "attendance"],
    sql: `SELECT 100.0 * COUNT(a.staff_id) / COUNT(*) AS v ${rosterAt}`,
    detail: `SELECT s.name || ' (' || (COUNT(*) - COUNT(a.staff_id)) || ' of ' || COUNT(*) || ' missing)' AS d
      FROM roster r JOIN stores s ON s.store_id = r.store_id LEFT JOIN attendance a ON a.date = r.date AND a.staff_id = r.staff_id AND a.login_at <= :check
      WHERE r.date = :end GROUP BY r.store_id HAVING COUNT(*) - COUNT(a.staff_id) >= 2 ORDER BY COUNT(*) - COUNT(a.staff_id) DESC LIMIT 4`,
    detailLabel: "Most staff missing" },
  { id: "ST-OPT", fn: "stores", owner: "Dr. Priya Nair", title: "Stores with no optometrist logged in", unit: " stores", decimals: 0,
    better: "lower", green: 0, red: 2, window: "today", impactTier: 3, tables: ["roster", "attendance", "staff", "stores"],
    sql: `SELECT COUNT(*) AS v FROM (SELECT r.store_id FROM roster r JOIN staff p ON p.staff_id = r.staff_id AND p.role = 'optometrist'
      LEFT JOIN attendance a ON a.date = r.date AND a.staff_id = r.staff_id AND a.login_at <= :check WHERE r.date BETWEEN :start AND :end
      GROUP BY r.date, r.store_id HAVING COUNT(a.staff_id) = 0)`,
    detail: `SELECT s.name AS d FROM roster r JOIN staff p ON p.staff_id = r.staff_id AND p.role = 'optometrist' JOIN stores s ON s.store_id = r.store_id
      LEFT JOIN attendance a ON a.date = r.date AND a.staff_id = r.staff_id AND a.login_at <= :check WHERE r.date = :end GROUP BY r.store_id HAVING COUNT(a.staff_id) = 0`,
    detailLabel: "No eye tests possible until cover arrives", ask: "Send a cover optometrist from the nearest store before 10:00" },
  { id: "ST-REV", fn: "stores", owner: "Aditya Joshi", title: "India store revenue vs target (7 days)", unit: "%", decimals: 1,
    better: "higher", green: 100, red: 92, window: "7d", impactTier: 3, tables: ["sales_daily", "stores"],
    sql: `SELECT 100.0 * SUM(d.revenue_inr) / SUM(s.daily_target_inr) AS v FROM sales_daily d JOIN stores s USING (store_id)
      WHERE s.country = 'India' AND d.date BETWEEN :start AND :end`,
    detail: `SELECT s.name || ' ' || CAST(ROUND(100.0 * SUM(d.revenue_inr) / SUM(s.daily_target_inr)) AS INT) || '%' AS d FROM sales_daily d JOIN stores s USING (store_id)
      WHERE s.country = 'India' AND d.date BETWEEN :start AND :end GROUP BY s.store_id ORDER BY SUM(d.revenue_inr) * 1.0 / SUM(s.daily_target_inr) LIMIT 3`,
    detailLabel: "Weakest stores" },
  { id: "ST-EYE", fn: "stores", owner: "Dr. Priya Nair", title: "Eye test to purchase conversion", unit: "%", decimals: 1,
    better: "higher", green: 72, red: 65, window: "7d", impactTier: 2, tables: ["sales_daily"],
    sql: `SELECT 100.0 * SUM(orders) / SUM(eye_tests) AS v FROM sales_daily d JOIN stores s USING (store_id) WHERE s.country = 'India' AND date BETWEEN :start AND :end` },

  // ---- Supply Chain & Manufacturing
  { id: "SC-BKL", fn: "supply", owner: "Arjun Menon", title: "Orders waiting to ship (all hubs)", unit: " orders", decimals: 0,
    better: "lower", green: 1500, red: 3500, window: "7d", impactTier: 3, tables: ["fulfilment_daily"],
    sql: `SELECT SUM(backlog_eod) AS v FROM fulfilment_daily WHERE date = :end`,
    detail: `SELECT hub || ': ' || CAST(backlog_eod AS INT) || ' orders, pick rate ' || CAST(pick_rate_per_hr AS INT) || '/hr' AS d FROM fulfilment_daily WHERE date = :end ORDER BY backlog_eod DESC LIMIT 2`,
    detailLabel: "Worst hubs", dependsOn: "P-SC1" },
  { id: "SC-DLV", fn: "supply", owner: "Divya Pillai", title: "Average delivery time", unit: " days", decimals: 2,
    better: "lower", green: 2.4, red: 2.6, window: "7d", impactTier: 2, tables: ["fulfilment_daily"],
    dependsOn: "P-SC1",
    sql: `SELECT SUM(avg_delivery_days * orders_shipped) / SUM(orders_shipped) AS v FROM fulfilment_daily WHERE date BETWEEN :start AND :end` },
  { id: "MF-RMK", fn: "supply", owner: "Pooja Sharma", title: "Lens remake rate", unit: "%", decimals: 2,
    better: "lower", green: 2, red: 2.75, window: "7d", impactTier: 2, tables: ["lab_daily"],
    sql: `SELECT 100.0 * SUM(remakes) / SUM(jobs) AS v FROM lab_daily WHERE date BETWEEN :start AND :end`,
    detail: `SELECT lab || ' ' || printf('%.1f', 100.0 * SUM(remakes) / SUM(jobs)) || '%' AS d FROM lab_daily WHERE date BETWEEN :start AND :end GROUP BY lab ORDER BY 1.0 * SUM(remakes) / SUM(jobs) DESC`,
    detailLabel: "By lab", ask: "Approve switching Bhiwadi back to the previous progressive-lens blank supplier" },

  // ---- Marketing
  { id: "MK-CAC", fn: "mktg", owner: "Neha Kapoor", title: "Blended cost per new customer", unit: "", prefix: true, decimals: 0,
    better: "lower", green: 950, red: 1050, window: "7d", impactTier: 2, tables: ["marketing_daily"],
    sql: `SELECT SUM(spend_inr) / SUM(new_customers) AS v FROM marketing_daily WHERE date BETWEEN :start AND :end`,
    detail: `SELECT channel || ' ₹' || CAST(SUM(spend_inr) / SUM(new_customers) AS INT) AS d FROM marketing_daily WHERE date BETWEEN :start AND :end GROUP BY channel ORDER BY SUM(spend_inr) / SUM(new_customers) DESC`,
    detailLabel: "By channel" },
  { id: "MK-NEW", fn: "mktg", owner: "Ananya Desai", title: "New customers (7 days)", unit: "", decimals: 0,
    better: "higher", green: 45000, red: 41000, window: "7d", impactTier: 1, tables: ["marketing_daily"],
    sql: `SELECT SUM(new_customers) AS v FROM marketing_daily WHERE date BETWEEN :start AND :end` },

  // ---- App & Product
  { id: "TE-CNV", fn: "tech", owner: "Kavya Reddy", title: "App checkout conversion", unit: "%", decimals: 2,
    better: "higher", green: 3.1, red: 2.9, window: "7d", impactTier: 3, tables: ["online_daily"],
    sql: `SELECT 100.0 * SUM(orders) / SUM(sessions) AS v FROM online_daily WHERE channel = 'app' AND date BETWEEN :start AND :end` },
  { id: "TE-CRS", fn: "tech", owner: "Nikhil Jain", title: "App crash-free sessions", unit: "%", decimals: 2,
    better: "higher", green: 99.5, red: 99.0, window: "7d", impactTier: 2, tables: ["online_daily"],
    sql: `SELECT SUM(crash_free_pct * sessions) / SUM(sessions) AS v FROM online_daily WHERE channel = 'app' AND date BETWEEN :start AND :end`,
    ask: "Roll back the latest app release or ship the hotfix today" },
  { id: "TE-TRY", fn: "tech", owner: "Vikram Rao", title: "Sessions using 3D try-on", unit: "%", decimals: 1,
    better: "higher", green: 30, red: 26, window: "7d", impactTier: 1, tables: ["online_daily"],
    sql: `SELECT 100.0 * SUM(tryon_sessions) / SUM(sessions) AS v FROM online_daily WHERE date BETWEEN :start AND :end` },

  // ---- Customer Service
  { id: "CS-FRT", fn: "cs", owner: "Shreya Bose", title: "WhatsApp median first reply", unit: " min", decimals: 0,
    better: "lower", green: 75, red: 95, window: "7d", impactTier: 2, tables: ["support_daily"],
    sql: `SELECT AVG(median_first_reply_min) AS v FROM support_daily WHERE channel = 'whatsapp' AND date BETWEEN :start AND :end` },
  { id: "CS-WSM", fn: "cs", owner: "Imran Qureshi", title: "Share of tickets asking \"where is my order\"", unit: "%", decimals: 1,
    better: "lower", green: 15, red: 20, window: "7d", impactTier: 2, tables: ["support_daily"], dependsOn: "P-SC1",
    sql: `SELECT 100.0 * SUM(wismo_tickets) / SUM(tickets_created) AS v FROM support_daily WHERE date BETWEEN :start AND :end` },
  { id: "CS-RES", fn: "cs", owner: "Lakshmi Iyer", title: "Tickets resolved same day", unit: "%", decimals: 1,
    better: "higher", green: 95, red: 90, window: "7d", impactTier: 1, tables: ["support_daily"],
    sql: `SELECT 100.0 * SUM(tickets_resolved) / SUM(tickets_created) AS v FROM support_daily WHERE date BETWEEN :start AND :end` },

  // ---- Retention & Gold
  { id: "RE-RNW", fn: "retention", owner: "Sahil Arora", title: "Gold membership renewal rate", unit: "%", decimals: 1,
    better: "higher", green: 60, red: 56, window: "7d", impactTier: 3, tables: ["gold_daily"],
    sql: `SELECT 100.0 * SUM(renewals_done) / SUM(renewals_due) AS v FROM gold_daily WHERE date BETWEEN :start AND :end`,
    ask: "Pick a Gold 2.0 benefit by Friday: free lens upgrade, or a second free home eye test" },
  { id: "RE-ACT", fn: "retention", owner: "Tara Menon", title: "Net change in active Gold members (7 days)", unit: "", decimals: 0, signed: true,
    better: "higher", green: 0, red: -2000, window: "7d", impactTier: 2, tables: ["gold_daily"],
    sql: `SELECT SUM(new_signups + renewals_done - renewals_due) AS v FROM gold_daily WHERE date BETWEEN :start AND :end` },

  // ---- Finance
  { id: "FI-REV", fn: "finance", owner: "Karan Shah", title: "Gross revenue (7 days)", unit: " Cr", prefix: "₹", decimals: 2, scale: 1e7,
    better: "higher", green: 14e7, red: 13e7, window: "7d", impactTier: 3, tables: ["finance_daily"],
    sql: `SELECT SUM(gross_revenue_inr) AS v FROM finance_daily WHERE date BETWEEN :start AND :end` },
  { id: "FI-INV", fn: "finance", owner: "Sneha Agarwal", title: "Inventory days", unit: " days", decimals: 0,
    better: "lower", green: 108, red: 116, window: "7d", impactTier: 2, tables: ["finance_daily"],
    sql: `SELECT inventory_value_inr / cogs_inr AS v FROM finance_daily WHERE date = :end` },
  { id: "FI-CSH", fn: "finance", owner: "Amit Saxena", title: "Cash collected vs revenue", unit: "%", decimals: 1,
    better: "higher", green: 96, red: 94, window: "7d", impactTier: 1, tables: ["finance_daily"],
    sql: `SELECT 100.0 * SUM(cash_collected_inr) / SUM(gross_revenue_inr) AS v FROM finance_daily WHERE date BETWEEN :start AND :end` },

  // ---- International
  { id: "IN-GCC", fn: "intl", owner: "Meera Iyer", title: "UAE and Saudi store revenue vs target", unit: "%", decimals: 1,
    better: "higher", green: 95, red: 85, window: "7d", impactTier: 2, tables: ["sales_daily", "stores"],
    sql: `SELECT 100.0 * SUM(d.revenue_inr) / SUM(s.daily_target_inr) AS v FROM sales_daily d JOIN stores s USING (store_id)
      WHERE s.country IN ('UAE', 'Saudi Arabia') AND d.date BETWEEN :start AND :end`,
    detail: `SELECT s.country || ' ' || CAST(ROUND(100.0 * SUM(d.revenue_inr) / SUM(s.daily_target_inr)) AS INT) || '%' AS d FROM sales_daily d JOIN stores s USING (store_id)
      WHERE s.country IN ('UAE', 'Saudi Arabia') AND d.date BETWEEN :start AND :end GROUP BY s.country ORDER BY 1`,
    detailLabel: "By country", dependsOn: "P-IN1" },
  { id: "IN-SGP", fn: "intl", owner: "Zoya Khan", title: "Singapore store revenue vs target", unit: "%", decimals: 1,
    better: "higher", green: 95, red: 85, window: "7d", impactTier: 1, tables: ["sales_daily", "stores"],
    sql: `SELECT 100.0 * SUM(d.revenue_inr) / SUM(s.daily_target_inr) AS v FROM sales_daily d JOIN stores s USING (store_id)
      WHERE s.country = 'Singapore' AND d.date BETWEEN :start AND :end` },
];

// Checks that must pass before anyone trusts the numbers.
export const CHECKS = [
  { id: "fresh", title: "Yesterday's sales landed for every store",
    sql: `SELECT COUNT(*) AS bad FROM stores s WHERE NOT EXISTS (SELECT 1 FROM sales_daily d WHERE d.store_id = s.store_id AND d.date = :yesterday)` },
  { id: "today-roster", title: "Today's roster and logins have arrived",
    sql: `SELECT CASE WHEN (SELECT COUNT(*) FROM roster WHERE date = :today) > 0 AND (SELECT COUNT(*) FROM attendance WHERE date = :today) > 0 THEN 0 ELSE 1 END AS bad` },
  { id: "fk-sales", title: "Every sales row points to a known store",
    sql: `SELECT COUNT(*) AS bad FROM sales_daily d LEFT JOIN stores s USING (store_id) WHERE s.store_id IS NULL` },
  { id: "fk-att", title: "Every login matches a rostered staff member at the same store",
    sql: `SELECT COUNT(*) AS bad FROM attendance a LEFT JOIN roster r ON r.date = a.date AND r.staff_id = a.staff_id AND r.store_id = a.store_id WHERE r.staff_id IS NULL` },
  { id: "dupes", title: "No duplicate store-day rows",
    sql: `SELECT COUNT(*) AS bad FROM (SELECT 1 FROM sales_daily GROUP BY date, store_id HAVING COUNT(*) > 1)` },
  { id: "recon", title: "Finance ledger equals store + online sales, every day (within 0.5%)",
    sql: `SELECT COUNT(*) AS bad FROM finance_daily f WHERE ABS(f.gross_revenue_inr -
      (SELECT SUM(revenue_inr) FROM sales_daily d WHERE d.date = f.date) - (SELECT SUM(revenue_inr) FROM online_daily o WHERE o.date = f.date)) > 0.005 * f.gross_revenue_inr` },
  { id: "sane", title: "No negative values; remakes ≤ jobs; renewals ≤ due",
    sql: `SELECT (SELECT COUNT(*) FROM sales_daily WHERE revenue_inr < 0 OR orders < 0) + (SELECT COUNT(*) FROM lab_daily WHERE remakes > jobs)
      + (SELECT COUNT(*) FROM gold_daily WHERE renewals_done > renewals_due) + (SELECT COUNT(*) FROM fulfilment_daily WHERE backlog_eod < 0) AS bad` },
];
