# Private beta checklist

Status on 2026-11-06. Items are checked only when the command in `docs/TEST_RESULTS.md` showed that behavior.

## Ready for a private unpack

- [x] Load unpacked from this directory. No build step.
- [x] Recording stays off until Start, and only the chosen tab is recorded.
- [x] Pause, resume, and stop exist.
- [x] Password values and token-like API fields are not written to extension storage.
- [x] Network capture is opt-in and limited to the recording origin.
- [x] Replay runs the step list in order and reports a real failure for a wrong text assertion.
- [x] A login workflow recorded on the demo was replayed in Chrome and the page showed "Welcome, Demo".
- [x] Saved tests are still readable after the service worker is terminated.
- [x] Selenium, Playwright, Cypress, and REST Assured still generate from the step list, with secrets as parameters.
- [x] Mock AI returns an editable proposed plan and does not run it.
- [x] `chrome://` pages are rejected with an explicit message.
- [x] `npm test` passes (13 tests). `node test/acceptance.mjs` passes (16 scenarios) on Chrome 156.0.8078.80.

## Not done

- [ ] Failure screenshots. Chrome 156 refuses `captureVisibleTab` without `<all_urls>` or a fresh `activeTab` invocation. The error is stored. Do not tell users a screenshot exists.
- [ ] Playwright runner execution of the exported spec. The file is generated and checked as text.
- [ ] Live AI. Leave Settings on Mock unless a proxy with its own auth, rate limit, and server-side key is deployed. Do not ship `AI_API_KEY` in the extension.
- [ ] Chrome Web Store submission. The package does not eval remote code, and that still needs a store review.
- [ ] Reload from the `chrome://extensions` card. In the automated session that navigation started returning `ERR_BLOCKED_BY_CLIENT`.

## Before sharing a build

1. Run `npm test` and `node test/acceptance.mjs`.
2. Load the directory in a normal Chrome profile with Developer mode and record the demo by hand once. The acceptance run used headless Chrome and the DevTools load command, not the Load unpacked button.
3. Confirm Settings has no proxy URL and no token you do not mean to keep in the browser profile.
4. Do not commit `.env`, `node_modules/`, or `test-results/`.
