# Release checklist

Status on 2026-11-26 for version 1.0.0. Items are checked only when a command in this session showed that behavior. The 2026-11-06 notes below stay as history.

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

## 1.0.0 store candidate

- [x] `npm test`: 42 passed, 0 failed, 1 skipped. The skip is `test/live-ai.test.mjs` when the shell has no provider credentials.
- [x] With the already running local proxy, `node --test test/live-ai.test.mjs` passed. That call checks a schema-valid live plan. The full Demo Bank login through the controller was not repeated in this release run.
- [x] Chrome 158.0.8127.38: recorder start/stop, acceptance (16), persistence, mock AI login, Playwright export, runtime secrets, shop locators, and screenshot messaging passed.
- [x] Results download an HTML report and a sanitized JSON report. Failure screenshots stay out of the file unless included.
- [x] `npm run package` wrote `dist/browser-test-recorder-1.0.0.zip`. Chrome loaded that package. The controller says Live AI is not included.
- [ ] Failure screenshots from an automated run. Chrome still refuses `captureVisibleTab` without `<all_urls>` or a fresh toolbar click. The product stores "Screenshot unavailable" and Chrome's reason. Do not tell users a screenshot exists unless a JPEG was stored.
- [ ] Reload from the `chrome://extensions` card inside an automated debug session. A full Chrome restart still reads the saved test. Persistence records the in-session reload as a harness limitation.
- [ ] Chrome Web Store submission. Developer registration payment is pending. Do not submit.
- [ ] Privacy policy URL confirmed in a signed-out browser. The draft is `docs/PRIVACY.md`.

## Not done on 2026-11-06

- [ ] Failure screenshots from an automated run. Chrome 156 still refuses `captureVisibleTab` without `<all_urls>` or a fresh toolbar click. The product stores "Screenshot unavailable" and Chrome's reason. A toolbar click on the same page can grant capture; navigation clears it. Do not tell users a screenshot exists unless a JPEG was stored.
- [x] Playwright runner execution of the exported login spec. The success case passes against the demo with `TEST_PASSWORD`. A deliberately wrong URL assertion fails.
- [ ] Live AI against a provider. The local proxy enforces auth, a rate limit, and schema validation, and it stays on `127.0.0.1`. `node --test test/live-ai.test.mjs` is UNVERIFIED unless `PROXY_AUTH_TOKEN` and `AI_API_KEY` are set. Setup is in `docs/AI_POLICY.md`. Do not ship `AI_API_KEY` in the extension, and do not deploy the proxy.
- [ ] Chrome Web Store submission. The package does not eval remote code, and that still needs a store review.
- [ ] Reload from the `chrome://extensions` card. In the automated session that navigation started returning `ERR_BLOCKED_BY_CLIENT`.

## Before sharing a build

1. Run `npm test` and `node test/acceptance.mjs`.
2. Load the directory in a normal Chrome profile with Developer mode and record the demo by hand once. The acceptance run used headless Chrome and the DevTools load command, not the Load unpacked button.
3. Confirm Settings has no proxy URL and no token you do not mean to keep in the browser profile.
4. Do not commit `.env`, `node_modules/`, or `test-results/`.
