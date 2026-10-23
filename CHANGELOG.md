# Changelog

## 1.0.0 - 2026-10-23

- Initial release.
- CSV column mapping for vendor, invoice number, date, amount and currency with auto-detection
- Exact-duplicate groups on normalised vendor, invoice, amount, date and currency
- Near-duplicate scoring: normalised invoice number, fuzzy vendor match, amount tolerance and date window
- Side-by-side suspect-pair view with the match reason for every pair
- Export suspects as a CSV for AP review, all processed locally
