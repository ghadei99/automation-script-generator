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
- [x] `npm test` passes (18 passed, 1 skipped). `node test/acceptance.mjs` passes (16 scenarios) on Chrome 156.0.8078.80.

## Not done

- [ ] Failure screenshots from an automated run. Chrome 156 still refuses `captureVisibleTab` without `<all_urls>` or a fresh toolbar click. The product stores "Screenshot unavailable" and Chrome's reason. A toolbar click on the same page can grant capture; navigation clears it. Do not tell users a screenshot exists unless a JPEG was stored.
- [x] Playwright runner execution of the exported login spec. The success case passes against the demo with `TEST_PASSWORD`. A deliberately wrong URL assertion fails.
- [ ] Live AI against a provider. The local proxy enforces auth, a rate limit, and schema validation, and it stays on `127.0.0.1`. The opt-in smoke test skips unless `PROXY_AUTH_TOKEN` and `AI_API_KEY` are set. Do not ship `AI_API_KEY` in the extension, and do not deploy the proxy.
- [ ] Chrome Web Store submission. The package does not eval remote code, and that still needs a store review.
- [ ] Reload from the `chrome://extensions` card. In the automated session that navigation started returning `ERR_BLOCKED_BY_CLIENT`.

## Before sharing a build

1. Run `npm test` and `node test/acceptance.mjs`.
2. Load the directory in a normal Chrome profile with Developer mode and record the demo by hand once. The acceptance run used headless Chrome and the DevTools load command, not the Load unpacked button.
3. Confirm Settings has no proxy URL and no token you do not mean to keep in the browser profile.
4. Do not commit `.env`, `node_modules/`, or `test-results/`.
