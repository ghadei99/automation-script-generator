# Test results

Date: 2026-11-06  
Chrome used for the extension run: Chrome/156.0.8078.80  
Extension id in that session: `nicdpehkdfphgdnmbhmmfkoiaeicmcia`

## Unit tests

Command:

```bash
npm test
```

Result: 13 passed, 0 failed.

The file is `test/core.test.mjs` plus `test/demo.test.mjs`. Covered behavior:

- The old unlocked storage pattern kept 1 of 4 events. The mutex kept 4 of 4.
- No steps are recorded when there is no session or the session is paused.
- Inputs coalesce, other tabs are ignored, and a different origin becomes a warning.
- A password value and a JWT in an API body are removed before the session is stored.
- Username is not treated as a secret. A password field is.
- `chrome://` and the Chrome Web Store are rejected. `about:blank` is ignored rather than recorded.
- `data-testid` wins when it is unique. Two identical buttons fall back to a unique CSS path and a warning.
- A failed step stays failed, later steps are skipped, and the adapter is not called again.
- Stopping a run does not mark it passed.
- The mock login prompt returns two proposed cases and no password value. `script` and `eval` are rejected.
- Selenium, Playwright, Cypress, and REST Assured still emit page objects or request blocks, escape quotes and newlines, parameterize secrets, and skip an unsupported HTTP method.
- The demo login route returns 401 for a wrong password and 200 for `demo` / `demo123`.

## Extension acceptance

Command:

```bash
node test/acceptance.mjs
```

Result: 16 passed, 0 failed. Chrome was launched headless with `enableExtensions: true`, then `browser.installExtension()` loaded this directory. The demo server picked port `60513` for that run.

| Scenario | Result | Evidence |
|---|---|---|
| Extension window opens | Pass | Controller text included "IDLE" and "Recorder" |
| No recording before Start | Pass | Storage had no session after typing `should-not-record` into the password field |
| Start on the selected tab | Pass | Session origin was `http://127.0.0.1:60513` |
| Recording stays on that tab | Pass | A second tab's click left the step count at 8 |
| Passwords are not persisted | Pass | Steps were `navigate, click, input:demo, click, input:{{password}}, checkbox, click, navigate`. The string `demo123` was absent |
| Network capture is redacted | Pass | Stored login body was `{"username":"demo","password":"REDACTED"}` |
| Incorrect assertion fails | Pass | Status `failed`. Message "Text did not match". Expected `Welcome, Admin`. Actual `Welcome, Demo` |
| Failure evidence | Pass, with a screenshot gap | No image was stored. `screenshotError` was `Either the '<all_urls>' or 'activeTab' permission is required.` Expected and actual were stored. Later steps were not converted to passes |
| Navigation during replay | Pass | The failing run executed `navigate:passed` before `assertText:failed` |
| Successful replay | Pass | Without the trailing recorded navigation, replay was `navigate, click, input, click, input, checkbox, click, assertText`, all passed. The page text was `Welcome, Demo` |
| Generators | Pass | Playwright, Selenium, and Cypress output contained `RecordedPage` and `TEST_PASSWORD`, and did not contain `demo123` |
| Mock AI | Pass | Two cases, `source: mock`, `proposed: true`. An edited plan was saved as `source: ai` and had no run record |
| Unsupported page | Pass | Start on `chrome://version` returned "This page cannot be scripted (chrome:// pages are blocked). Open an http or https page." |
| Extension errors | Pass | No page errors or service-worker console errors were collected before the restart step |
| Saved test after service-worker restart | Pass | "Login demo" still had 8 steps after the service worker target was closed and a new extension page called `app:get` |

A successful replay is the run above. It was executed in Chrome. The generator check did not execute Playwright itself.

## Screenshot blocker

On this Chrome build, `chrome.tabs.captureVisibleTab` fails even when `chrome.permissions.getAll()` reports `http://127.0.0.1/*`, `http://localhost/*`, and `activeTab`. The call was made after focusing the demo tab. The extension records that error and does not substitute an image. Adding `<all_urls>` would likely satisfy Chrome and was not done, because that permission is broader than the recorder needs for everything else.

## What was not run

- The Playwright, Selenium, Cypress, and REST Assured files were not executed in those runners. Unit tests and the in-Chrome replay cover the step list those files are generated from.
- `server/ai-proxy.mjs` was not started. No provider key is configured.
- A click on Reload inside `chrome://extensions` was tried separately. After that click, opening the extension page returned `net::ERR_BLOCKED_BY_CLIENT`. The acceptance run therefore proves service-worker restart, not that button.
