# Test results

Date: 2026-11-06  
Chrome used for the extension run: Chrome/156.0.8078.80  
Extension id in that session: `nicdpehkdfphgdnmbhmmfkoiaeicmcia`

## Unit tests

Command:

```bash
npm test
```

Result on the later run below: 14 passed, 0 failed. The first recorded run was 13 passed.

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

## Persistence, 2026-11-06

Command:

```bash
node test/persistence.mjs
```

Chrome/156.0.8078.80. Extension id `nicdpehkdfphgdnmbhmmfkoiaeicmcia` before and after the restart.

| Check | Result | Evidence |
|---|---|---|
| Save through the extension UI | Pass | Start, Stop, name "Persist suite", Save test. Stored step `navigate:http://127.0.0.1:63796/` |
| Chrome process restart | Pass | Same extension id. 1 step restored. Load into draft showed the saved URL |
| Reload button inside this debug session | Harness limitation | Reopened page was `chrome-error://chromewebdata/` for `chrome-extension://nicdpehkdfphgdnmbhmmfkoiaeicmcia/popup.html`. No `chrome.storage` API. The same profile had already restored the test after a full process restart, so this is the debug loader blocking the page, not a missing write |

The Start button had been disabled on every permitted page because an empty block reason was stored as the disabled attribute. That is fixed. The persistence run used the enabled button.

Screenshots from that run: `test-results/persistence-saved.png` and `test-results/persistence-restarted.png`.

## AI proposal executed in Chrome

Commands:

```bash
npm test
node test/ai-flow.mjs
node test/acceptance.mjs
```

`npm test`: 14 passed, 0 failed.

`node test/ai-flow.mjs`: 4 passed, 0 failed. Prompt: "Test the login page with invalid credentials, verify the error message, and check navigation."

The mock plan was labeled proposed. Its selectors were `data-testid=username`, `data-testid=password`, `data-testid=submit`, and `data-testid=error` from the open demo page. It did not contain `data-testid=welcome` or `/app`. The password step was `{{wrongPassword}}` with no password value. After editing the expected error text to `Wrong message` and choosing Approve and save, the run failed. The page showed expected `Wrong message` and actual `Invalid credentials`. Playwright, Selenium, Cypress, and REST Assured were generated from those saved steps. The Playwright output contained `getByTestId("error")` and `TEST_WRONGPASSWORD`, and did not contain the typed password.

`node test/acceptance.mjs` after these changes: 16 passed, 0 failed. The earlier baseline was not replaced by a weaker check.

Live AI was not called. No provider key is configured. Mock mode is the feature that ran. Screenshot: `test-results/ai-failed-run.png`.

## Login plan executed in Chrome, 2026-11-06

Branch started from merged `master` at `6bb3e23`.

Commands:

```bash
npm test
node test/ai-login.mjs
node test/acceptance.mjs
```

`npm test`: 16 passed, 0 failed. This includes the plan edit checks and `server/ai-proxy.mjs` exiting when `PROXY_AUTH_TOKEN` and `AI_API_KEY` are unset.

`node test/ai-login.mjs`: 5 passed, 0 failed. Chrome launched the extension against the local demo. The prompt was "Test the login form, verify invalid credentials show an error, then test a successful login."

| Check | Result | Evidence |
|---|---|---|
| Mock plan | Pass | Invalid case, then success case. Selectors were `data-testid` username, password, submit, and error from the open page. The success URL was empty. `/app` was not invented |
| Correct assertions | Pass | `navigate, input, input, click, assertText, assertUrl` all passed after the expected error was set to `Invalid credentials` |
| Incorrect assertion | Pass as a real failure | Expected `Not the real error`. Actual `Invalid credentials`. Later steps skipped. Evidence: `Either the '<all_urls>' or 'activeTab' permission is required.` No image was stored |
| Successful login | Pass | Same step list passed after the username was set to `demo` and the expected URL was set to the demo app. The page text was `Welcome, Demo` |
| Playwright export | Pass | The approved success spec imports `@playwright/test`, uses `getByTestId("username")` and `TEST_PASSWORD`, includes the approved app URL, and does not contain `demo123`. Extension storage also did not contain `demo123` or `not-the-password` |

`node test/acceptance.mjs`: 16 passed, 0 failed.

Live mode was not called. The proxy was not started. The Playwright test runner was not used to execute the exported file. Screenshot: `test-results/ai-login-failed.png`.

## Release candidate, 2026-11-06

Branch `feature/ai-login-execution`. Chrome/156.0.8078.80.

Commands:

```bash
npm test
node test/ai-login.mjs
node test/acceptance.mjs
node test/screenshot.mjs
node test/playwright-export.mjs
```

`npm test`: 18 passed, 0 failed, 1 skipped. The skip is `test/live-ai.test.mjs`, because `PROXY_AUTH_TOKEN` and `AI_API_KEY` are not set. The same run includes the four code generators and the local proxy checks in `test/proxy.test.mjs`.

`node test/ai-login.mjs`: 5 passed, 0 failed. Invalid credentials passed. The wrong expected text failed with actual `Invalid credentials` and later steps skipped. The approved success login passed and the page showed `Welcome, Demo`. The export and extension storage did not contain `demo123` or `not-the-password`.

`node test/acceptance.mjs`: 16 passed, 0 failed.

`node test/screenshot.mjs`: 5 passed, 0 failed.

| Scenario | Result | Evidence |
|---|---|---|
| Failed assertion | Pass | No image stored. `screenshotError` starts with `Screenshot unavailable` and includes Chrome's `activeTab` / `<all_urls>` message |
| Results view | Pass | The text `Screenshot unavailable` and `activeTab` were visible. No failure image was shown |
| Navigation | Pass | The stored capture grant was marked `cleared: navigation`, and the error says the page navigated after the icon click |
| Browser page | Pass | `Screenshot unavailable. This page cannot be scripted (chrome:// pages are blocked).` |
| Missing origin | Pass | `Screenshot unavailable. Site access for https://example.com is missing or was revoked.` |

No JPEG was returned. The automated session cannot click the toolbar icon, which is the invocation Chrome requires. `<all_urls>` was not added.

`node test/playwright-export.mjs`: the official Playwright runner executed the exported success login. `recorded.spec.ts` passed. `recorded-fail.spec.ts` failed on `toHaveURL`: expected `http://127.0.0.1:52379/not-the-app`, received `http://127.0.0.1:52379/app.html`. The runner output and the written files did not contain `demo123`. `TEST_PASSWORD` was supplied only as an environment variable.

Mock AI passed inside `npm test` and `node test/ai-login.mjs`. Live AI was not called. The proxy tests proved it refuses to listen without its credentials, rejects a non-local provider URL, requires the bearer token, drops password values from page evidence, rejects a plan that contains `script`, returns 429 after 10 requests in a minute, and does not put the provider key in its responses or logs. The proxy binds to `127.0.0.1` and is not deployed.

## UI and code generation, 2026-11-06

Branch `feature/ui-codegen-quality`, started from `03cd199`.

Commands:

```bash
npm test
node test/shop.mjs
node test/acceptance.mjs
node test/ai-login.mjs
node test/screenshot.mjs
node test/playwright-export.mjs
node test/ai-flow.mjs
node test/persistence.mjs
```

`npm test`: 19 passed, 0 failed, 1 skipped. The skip is still the live provider smoke test. The new unit test checks short method names, one dropped repeated click, both real navigations, no `javascript:` URL, the cart assertion, and `TEST_PASSWORD`.

`node test/shop.mjs`: 5 passed, 0 failed. Chrome recorded the local Demo Web Shop, from the catalog to the notebook page, then Add to cart. Replay passed and the page showed `Notebook is in the cart`. The step list used short titles such as `Click add-cart`, numbered from `01`, and the editor showed `Strategy: testid` plus the CSS path. The AI panel showed `Mock AI`. The official Playwright runner then passed the exported spec. `demo123` was not in the export or the runner output.

`node test/acceptance.mjs`: 16 passed, 0 failed.

`node test/ai-login.mjs`: 5 passed, 0 failed.

`node test/screenshot.mjs`: 5 passed, 0 failed.

`node test/playwright-export.mjs`: the login export passed. The wrong URL assertion failed with expected `/not-the-app` and received `/app.html`. The password was absent from the output and files.

`node test/ai-flow.mjs`: 4 passed, 0 failed.

`node test/persistence.mjs`: the UI save, Chrome restart, and reopened step list passed. The extensions-page Reload check remains the known debug-session limitation and is not a product failure.

## Pre-merge check, 2026-11-06

`03cd199` is an ancestor of this branch. `master` (`6bb3e23`) has no commits that this branch lacks. Nothing was merged.

A click is removed only when the next click has the same selector and the same recorder timestamp. Two clicks with different timestamps, and two clicks with no timestamp, both stay. A non-unique semantic locator is exported as its structural CSS path with the structural warning. Method names that would collide are suffixed (`clickSave`, `clickSave2`).

`npm test`: 19 passed, 0 failed, 1 skipped (live provider, secrets unset).

`node test/acceptance.mjs`: 16/16 passed.

`node test/ai-login.mjs`: 5/5 passed.

`node test/screenshot.mjs`: 5 passed, 0 failed. No image was invented.

`node test/playwright-export.mjs`: success spec passed. The deliberate failure expected `http://127.0.0.1:55122/not-the-app` and received `http://127.0.0.1:55122/app.html`. The password was absent.

`node test/ai-flow.mjs`: 4/4 passed.

`node test/shop.mjs`: 5 passed, 0 failed.

`node test/persistence.mjs`: product save, Chrome restart, and reopened steps passed. The extensions Reload check is still the debug-session limitation.

## Smart locator engine, 2026-11-06

Branch `feature/smart-locator-engine`, from `origin/master` at `86e97a9`.

Recording still makes no AI call. Each element stores the best verified locator, the other candidates, and a fingerprint of tag, role, accessible name, stable attributes, and a parent anchor. Field values are not stored. A locator that matches nothing or matches more than one element fails the step. A safe backup is shown for approval and is not applied by itself. An ambiguous backup is not clicked.

`npm test`: 20 passed, 0 failed, 1 skipped. The skip is the live provider smoke test. The new test covers a unique test id, a duplicate test id, a role and accessible name, two Add to cart buttons in separate sections, a dynamic id, an element with no stable attributes, a changed primary locator, a safe backup, an ambiguous backup, legacy selector migration, repeated clicks, generated Playwright, Selenium, and Cypress, and a failed step that stays failed.

`node test/acceptance.mjs`: 16/16 passed.

`node test/ai-login.mjs`: 5/5 passed.

`node test/screenshot.mjs`: 5 passed, 0 failed. No image was invented.

`node test/playwright-export.mjs`: the success spec passed. The deliberate failure expected `http://127.0.0.1:55832/not-the-app` and received `http://127.0.0.1:55832/app.html`. The password was absent.

`node test/ai-flow.mjs`: the combined run timed out once while Chrome was already busy. Run on its own, 4/4 passed.

`node test/shop.mjs`: 5 passed, 0 failed. The notebook Add to cart step kept `data-testid=add-cart`, a button fingerprint, and backup candidates. Replay passed and the page showed `Notebook is in the cart`. The official Playwright runner passed the export.

`node test/persistence.mjs`: product save, Chrome restart, and reopened steps passed. The extensions Reload check is still the debug-session limitation.

## Live AI planning, 2026-11-06

Branch `feature/live-ai-beta`, from `origin/master` at `cd406d0`.

Live planning sends a compact summary: heading, at most 24 interactive elements, verified locators, form ids, and at most four visible messages. It does not send field values, cookies, or the DOM. Password inputs stay secret parameters. `javascript:` URLs are removed. An approved live plan is reused for the same prompt and summary without another provider call. Mock mode still builds the plan locally.

The real provider was not called. `PROXY_AUTH_TOKEN` and `AI_API_KEY` are unset, so `test/live-ai.test.mjs` is UNVERIFIED, not passed. A stub provider reported `promptTokens: 11`, `completionTokens: 7`, `totalTokens: 18`, and `cost: 0.01`. No live token count was observed. Setup is in `docs/AI_POLICY.md`.

`npm test`: 21 passed, 0 failed, 1 skipped.

`node test/acceptance.mjs`: 16/16 passed.

`node test/ai-login.mjs`: 5/5 passed.

`node test/screenshot.mjs`: 5 passed, 0 failed. No image was invented.

`node test/playwright-export.mjs`: the success spec passed. The deliberate failure expected `http://127.0.0.1:56613/not-the-app` and received `http://127.0.0.1:56613/app.html`. The password was absent.

`node test/ai-flow.mjs`: 4/4 passed.

`node test/shop.mjs`: 5 passed, 0 failed. Replay reached `Notebook is in the cart`.

`node test/persistence.mjs`: product save, Chrome restart, and reopened steps passed. The extensions Reload check is still the debug-session limitation.

Chrome suites were run one after another.

## Recorder start, 2026-11-07

Branch `feature/fix-recorder-start`, from `feature/live-ai-beta` at `e9337a4`.

A second Start failed with `Duplicate script ID 'asg-recorder'` because Stop tried to unregister `asg-network` when network capture was off. Chrome rejects that whole request and leaves `asg-recorder` registered. Start now queries the registered scripts, updates the recorder when the origin changes, and registers an id only when it is missing.

`node test/recorder-start.mjs` in Chrome/156.0.8078.80, extension `nicdpehkdfphgdnmbhmmfkoiaeicmcia`: 13/13 passed. Two demo origins, `http://127.0.0.1:58061` and `http://127.0.0.1:58062`, stood in for the two sites. Cancel kept the first draft. The second Start recorded only `http://127.0.0.1:58062/*`. A click on the first site was not stored. One click produced one step. Stop and start, pause and resume, two overlapping starts, a saved test, navigation to `/app.html`, opt-in API capture, a service-worker restart, and a Chrome restart all started recording. The Chrome restart origin was `http://127.0.0.1:58085`.

`npm test`: 22 passed, 0 failed, 1 skipped. The skipped test is the live provider, still UNVERIFIED.

`node test/acceptance.mjs`: 16/16 passed. Demo port `58111`.

`node test/ai-login.mjs`: 5/5 passed.

`node test/screenshot.mjs`: 5 passed, 0 failed. No image was invented.

`node test/playwright-export.mjs`: the success spec passed. The deliberate failure expected `http://127.0.0.1:58171/not-the-app` and received `http://127.0.0.1:58171/app.html`. The password was absent.

`node test/ai-flow.mjs`: the combined run timed out once while Chrome was already busy. Run on its own, 4/4 passed.

`node test/shop.mjs`: 5 passed, 0 failed. Demo port `58222`.

`node test/persistence.mjs`: product save, Chrome restart, and reopened steps passed. Demo port `58247`. The extensions Reload check is still the debug-session limitation.
