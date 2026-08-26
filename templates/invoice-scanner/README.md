# Invoice Duplicate Detector

Build a Kujo CLI that reads `fixtures/invoices.csv` and writes `report.json`.
Duplicate invoice rows should be reported, while blank invoice IDs must be
ignored. The starter has an intentional blank-ID bug for the repair demo.

```bash
kujo run main.kujo -- fixtures/invoices.csv report.json
```
