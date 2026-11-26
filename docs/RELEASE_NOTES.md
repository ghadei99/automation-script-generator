# Release notes

## 1.0.0 — 26 November 2026

First public-release candidate. Not submitted to the Chrome Web Store.

- Results show the test name, date, duration, passed, failed, and skipped counts, and the run status.
- Download HTML Report writes a single file with its styles included. It opens locally and does not load a script or stylesheet from the network.
- Export result JSON writes a versioned report. Runtime passwords, tokens, request bodies, and failure screenshots are left out unless the user includes available screenshots.
- The store package disables Live AI and says so in the controller. The development tree still has Live AI.
- Icons at 16, 32, 48, and 128 pixels are included. `npm run package` builds `dist/browser-test-recorder-1.0.0.zip`.

A failed step is still a failed step. The report does not change that.
