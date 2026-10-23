const { test } = require("node:test");
const assert = require("node:assert/strict");
const L = require("../src/logic.js");

test("normalizeInvoiceNumber strips separators and case", () => {
  assert.equal(L.normalizeInvoiceNumber("INV-1001"), "INV1001");
  assert.equal(L.normalizeInvoiceNumber("inv 1001"), "INV1001");
  assert.equal(L.normalizeInvoiceNumber("INV_1001"), "INV1001");
  assert.equal(L.invoiceNumberCore("INV-001001"), "INV1001");
  assert.equal(L.invoiceNumberCore("000123"), "123");
});

test("normalizeVendor removes suffixes and punctuation", () => {
  assert.equal(L.normalizeVendor("Acme Supplies, Inc."), "acme supplies");
  assert.equal(L.normalizeVendor("Acme Supplies LLC"), "acme supplies");
  assert.equal(L.vendorSimilarity("Acme Supplies Inc", "Acme Supplies"), 1);
  assert.ok(L.vendorSimilarity("Acme Supplies", "Acme Supply") >= 0.75);
  assert.ok(L.vendorSimilarity("Acme Supplies", "Other Vendor") < 0.5);
});

test("parseAmount and parseDate handle common formats", () => {
  assert.equal(L.parseAmount("$1,250.50"), 1250.5);
  assert.equal(L.parseAmount("250"), 250);
  assert.equal(L.dateDiffDays("2026-01-01", "2026-01-08"), 7);
  assert.equal(L.dateDiffDays("2026-01-01", "2026-01-01"), 0);
});

test("parseCSV handles quoted commas and detectColumns finds mapping", () => {
  const rows = L.parseCSV('vendor,invoice,date,amount\n"Acme, Inc",INV-1,2026-01-01,100\nBeta LLC,INV-2,2026-01-02,200');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].vendor, "Acme, Inc");
  const map = L.detectColumns(["vendor", "invoice", "date", "amount"]);
  assert.equal(map.vendor, "vendor");
  assert.equal(map.invoice, "invoice");
});

test("findExactDuplicates groups identical rows only", () => {
  const rows = [
    { vendor: "Acme Inc", invoice: "INV-1001", date: "2026-01-01", amount: 500, currency: "USD", _row: 2 },
    { vendor: "Acme Inc", invoice: "INV1001", date: "2026-01-01", amount: 500, currency: "USD", _row: 3 },
    { vendor: "Beta LLC", invoice: "INV-2000", date: "2026-01-02", amount: 300, currency: "USD", _row: 4 }
  ];
  const groups = L.findExactDuplicates(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].members.length, 2);
});

test("scorePair scores reformatted near-duplicate highly with reasons", () => {
  const a = { vendor: "Acme Supplies Inc", invoice: "INV-1001", date: "2026-01-01", amount: 500, currency: "USD", _row: 2 };
  const b = { vendor: "Acme Supplies", invoice: "INV1001", date: "2026-01-03", amount: 500, currency: "USD", _row: 5 };
  const s = L.scorePair(a, b, { dateWindowDays: 7, amountTolerancePct: 0 });
  assert.ok(s.score >= 90, "score was " + s.score);
  assert.ok(s.reasons.length >= 3);
  const low = L.scorePair(a, { vendor: "Other Co", invoice: "ZZ-999", date: "2026-06-01", amount: 9, currency: "EUR", _row: 9 });
  assert.ok(low.score < 30);
});

test("findNearDuplicates returns suspect pairs above threshold and suspects CSV has header", () => {
  const rows = [
    { vendor: "Acme Supplies Inc", invoice: "INV-1001", date: "2026-01-01", amount: 500, currency: "USD", _row: 2 },
    { vendor: "Acme Supplies", invoice: "INV1001", date: "2026-01-03", amount: 500, currency: "USD", _row: 5 },
    { vendor: "Other Co", invoice: "ZZ-999", date: "2026-06-01", amount: 9, currency: "USD", _row: 9 }
  ];
  const pairs = L.findNearDuplicates(rows, { threshold: 60, dateWindowDays: 7 });
  assert.equal(pairs.length, 1);
  const csv = L.suspectsToCSV([], pairs);
  assert.match(csv, /^type,score/);
  assert.match(csv, /near/);
});
