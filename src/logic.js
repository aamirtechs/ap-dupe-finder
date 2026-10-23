"use strict";
// AP Dupe Finder core logic: pure functions, no DOM, no fetch.

function normalizeInvoiceNumber(value) {
  if (value == null) return "";
  return String(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function invoiceNumberCore(value) {
  const norm = normalizeInvoiceNumber(value);
  // Strip leading zeros from trailing numeric run, e.g. INV001001 -> INV1001, 000123 -> 123
  const m = norm.match(/^([A-Z]*)0*(\d+)$/);
  if (m) return m[1] + m[2];
  return norm.replace(/^0+/, "") || norm;
}

function normalizeVendor(value) {
  if (value == null) return "";
  let s = String(value).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const suffixes = ["inc", "llc", "ltd", "limited", "corp", "corporation", "co", "company", "plc", "gmbh", "pty"];
  const words = s.split(" ").filter(Boolean);
  while (words.length > 1 && suffixes.indexOf(words[words.length - 1]) !== -1) words.pop();
  return words.join(" ");
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i].concat(Array(n).fill(0)));
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return dp[m][n];
}

function vendorSimilarity(a, b) {
  const na = normalizeVendor(a), nb = normalizeVendor(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const dist = levenshtein(na, nb);
  const levScore = 1 - dist / Math.max(na.length, nb.length);
  const ta = new Set(na.split(" ")), tb = new Set(nb.split(" "));
  let inter = 0; ta.forEach((t) => { if (tb.has(t)) inter++; });
  const tokenScore = inter / Math.max(ta.size, tb.size);
  return Math.round(Math.max(levScore, tokenScore) * 1000) / 1000;
}

function parseAmount(value) {
  if (typeof value === "number") return value;
  if (value == null) return NaN;
  const s = String(value).replace(/[^0-9.\-]/g, "");
  if (!s || s === "-" || s === ".") return NaN;
  return parseFloat(s);
}

function parseDateToDay(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Math.floor(value);
  const s = String(value).trim();
  // ISO yyyy-mm-dd
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
  // dd/mm/yyyy or mm/dd/yyyy heuristic: if first >12 it must be day
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    let a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000;
    let day, month;
    if (a > 12) { day = a; month = b; } else if (b > 12) { month = a; day = b; } else { month = a; day = b; }
    return Math.floor(Date.UTC(y, month - 1, day) / 86400000);
  }
  const t = Date.parse(s);
  return isNaN(t) ? null : Math.floor(t / 86400000);
}

function dateDiffDays(a, b) {
  const da = parseDateToDay(a), db = parseDateToDay(b);
  if (da == null || db == null) return null;
  return Math.abs(da - db);
}

function parseCSV(text) {
  const rows = []; let row = [], field = "", inQ = false;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); field = ""; rows.push(row); row = []; }
    else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const filtered = rows.filter((r) => r.some((c) => String(c).trim() !== ""));
  if (!filtered.length) return [];
  const headers = filtered[0].map((h) => String(h).trim());
  return filtered.slice(1).map((r, idx) => {
    const obj = { _row: idx + 2 };
    headers.forEach((h, i) => { obj[h] = r[i] != null ? String(r[i]).trim() : ""; });
    return obj;
  });
}

function detectColumns(headers) {
  const lower = (headers || []).map((h) => String(h).toLowerCase());
  function find(list) { for (const term of list) { const i = lower.findIndex((h) => h.includes(term)); if (i !== -1) return headers[i]; } return null; }
  return {
    vendor: find(["vendor", "supplier", "payee", "company"]),
    invoice: find(["invoice", "inv no", "inv_no", "bill no", "reference"]),
    date: find(["date"]),
    amount: find(["amount", "total", "value"]),
    currency: find(["currency", "ccy"])
  };
}

function canonicalRow(row, mapping) {
  return {
    vendor: row[mapping.vendor] || "",
    invoice: row[mapping.invoice] || "",
    date: row[mapping.date] || "",
    amount: parseAmount(row[mapping.amount]),
    amountRaw: row[mapping.amount] || "",
    currency: mapping.currency ? (row[mapping.currency] || "") : "",
    _row: row._row
  };
}

function exactKey(r) {
  return [normalizeVendor(r.vendor), invoiceNumberCore(r.invoice), String(r.amount), String(parseDateToDay(r.date)), String(r.currency || "").toUpperCase()].join("|");
}

function findExactDuplicates(rows) {
  const map = new Map();
  (rows || []).forEach((r) => { const k = exactKey(r); if (!map.has(k)) map.set(k, []); map.get(k).push(r); });
  const groups = [];
  map.forEach((members, key) => { if (members.length > 1) groups.push({ key: key, members: members, reason: "Exact match on vendor, invoice number, amount, date and currency" }); });
  return groups;
}

function scorePair(a, b, options) {
  const opts = Object.assign({ amountTolerancePct: 0, amountToleranceAbs: 0.01, dateWindowDays: 7 }, options || {});
  const reasons = [];
  let score = 0;
  const invA = invoiceNumberCore(a.invoice), invB = invoiceNumberCore(b.invoice);
  if (invA && invA === invB) { score += 45; reasons.push("Invoice numbers match after normalisation (" + a.invoice + " vs " + b.invoice + ")"); }
  else if (invA && invB && levenshtein(invA, invB) === 1) { score += 25; reasons.push("Invoice numbers differ by one character after normalisation"); }
  const vs = vendorSimilarity(a.vendor, b.vendor);
  if (vs >= 0.9) { score += 25; reasons.push("Vendor names match closely (" + Math.round(vs * 100) + "%)"); }
  else if (vs >= 0.75) { score += 15; reasons.push("Vendor names are similar (" + Math.round(vs * 100) + "%)"); }
  if (!isNaN(a.amount) && !isNaN(b.amount)) {
    const diff = Math.abs(a.amount - b.amount);
    const tol = Math.max(opts.amountToleranceAbs, Math.abs(a.amount) * (opts.amountTolerancePct / 100));
    if (diff <= tol) { score += 20; reasons.push("Amounts match within tolerance"); }
    else if (diff <= tol * 5) { score += 5; reasons.push("Amounts are close"); }
  }
  const dd = dateDiffDays(a.date, b.date);
  if (dd !== null) {
    if (dd === 0) { score += 10; reasons.push("Same invoice date"); }
    else if (dd <= opts.dateWindowDays) { score += 7; reasons.push("Dates are " + dd + " day(s) apart, inside the window"); }
  }
  if (a.currency && b.currency && String(a.currency).toUpperCase() !== String(b.currency).toUpperCase()) { score -= 20; reasons.push("Currencies differ"); }
  return { score: Math.max(0, Math.min(100, score)), reasons: reasons, vendorSimilarity: vs, dateDiffDays: dd };
}

function findNearDuplicates(rows, options) {
  const opts = Object.assign({ threshold: 60 }, options || {});
  const pairs = [];
  const exactKeys = new Set();
  findExactDuplicates(rows).forEach((g) => { for (let i = 0; i < g.members.length; i++) for (let j = i + 1; j < g.members.length; j++) exactKeys.add(g.members[i]._row + ":" + g.members[j]._row); });
  for (let i = 0; i < (rows || []).length; i++) for (let j = i + 1; j < rows.length; j++) {
    if (exactKeys.has(rows[i]._row + ":" + rows[j]._row)) continue;
    const s = scorePair(rows[i], rows[j], opts);
    if (s.score >= opts.threshold) pairs.push({ a: rows[i], b: rows[j], score: s.score, reasons: s.reasons });
  }
  return pairs.sort((x, y) => y.score - x.score);
}

function suspectsToCSV(exactGroups, nearPairs) {
  function esc(v) { const s = String(v == null ? "" : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  const lines = ["type,score,row_a,row_b,vendor_a,invoice_a,date_a,amount_a,vendor_b,invoice_b,date_b,amount_b,reason"];
  (exactGroups || []).forEach((g) => { for (let i = 1; i < g.members.length; i++) { const a = g.members[0], b = g.members[i]; lines.push(["exact", 100, a._row, b._row, esc(a.vendor), esc(a.invoice), esc(a.date), a.amount, esc(b.vendor), esc(b.invoice), esc(b.date), b.amount, esc(g.reason)].join(",")); } });
  (nearPairs || []).forEach((p) => { lines.push(["near", p.score, p.a._row, p.b._row, esc(p.a.vendor), esc(p.a.invoice), esc(p.a.date), p.a.amount, esc(p.b.vendor), esc(p.b.invoice), esc(p.b.date), p.b.amount, esc(p.reasons.join("; "))].join(",")); });
  return lines.join("\n");
}

const api = { normalizeInvoiceNumber, invoiceNumberCore, normalizeVendor, levenshtein, vendorSimilarity, parseAmount, parseDateToDay, dateDiffDays, parseCSV, detectColumns, canonicalRow, findExactDuplicates, scorePair, findNearDuplicates, suspectsToCSV };
if (typeof module !== "undefined" && module.exports) { module.exports = api; }
if (typeof window !== "undefined") { window.ApDupeFinder = api; }
