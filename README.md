# AP Dupe Finder
Live page: https://aamirtechs.github.io/ap-dupe-finder/

Upload an AP ledger CSV and find the invoices you will otherwise pay twice, including near-duplicates with reformatted numbers like INV-1001 vs INV1001. It runs entirely in your browser, so the files and data you work with never leave your device.

## Features
- CSV column mapping for vendor, invoice number, date, amount and currency with auto-detection
- Exact-duplicate groups on normalised vendor, invoice, amount, date and currency
- Near-duplicate scoring: normalised invoice number, fuzzy vendor match, amount tolerance and date window
- Side-by-side suspect-pair view with the match reason for every pair
- Export suspects as a CSV for AP review, all processed locally

## How it works
Upload or paste an AP ledger CSV, confirm the column mapping and tolerances, then run the check. Exact and near-duplicate suspects are grouped and scored in the browser; no finance data is uploaded.

## Privacy
Runs 100% in your browser. Your files never leave this device, nothing is uploaded,
and there is no tracking.

## Development
Core logic lives in `src/logic.js` and is shared by the page and the tests.
Run the tests with `npm test`.

## License
MIT, Copyright 2026 Amir Hussain.
