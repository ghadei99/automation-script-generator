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

## Recorder merge gate, 2026-11-07

`origin/master` is `6f1e17b`, the merge of live AI. This branch contains that work through `e9337a4`. The merge commit itself is not an ancestor, and it has no file changes. A merge into master is content-clean.

`node test/recorder-start.mjs` in Chrome/156.0.8078.80: 18/18 passed. With API capture off, switching from `http://127.0.0.1:59776` to `http://127.0.0.1:59777` left only `asg-recorder` on the new origin. Stop then Start worked without restarting Chrome. A missing tab, `chrome://version`, and `https://example.com` without permission all failed without replacing the draft. The API checkbox was unchecked and disabled while capture was off, and checked and disabled while capture was on.

`node test/acceptance.mjs`: 16/16 passed. Demo port `59824`.

`node test/ai-login.mjs`: 5/5 passed.

`node test/playwright-export.mjs`: the success spec passed. The deliberate failure expected `http://127.0.0.1:59866/not-the-app` and received `http://127.0.0.1:59866/app.html`. The password was absent.

`node test/persistence.mjs`: product save, Chrome restart, and reopened steps passed. Demo port `59888`. The extensions Reload check is still the debug-session limitation.

## Live locator binding, 2026-11-10

Branch `feature/live-ai-verification`, from `origin/master` at `f71bcbd`.

A live plan reached the runner with no selector. The provider was not asked for an element reference, `validatePlan` dropped anything that was not a selector object, and `groundPlan` only removed selectors. The step editor could not add one. Mock mode had been attaching selectors locally, which is why those tests passed.

The model now receives element references, roles, labels, and control types. It does not receive CSS. `bindPlan` attaches a verified locator when the reference matches one element, or when the action has one semantic match. Duplicate labels, invented references, and structural CSS stay unresolved. Approval and execution stop on those steps. After navigation, revalidation checks the current page and does not keep a stale target.

`npm test`: 32 passed, 0 failed, 1 skipped. The skip is `test/live-ai.test.mjs` in this shell, which does not have the proxy variables. The new tests cover a valid reference, a unique semantic match, duplicate labels, an invented reference, a structural locator, a stale locator, the captured no-selector provider plan, secret parameters, unresolved execution, and Playwright export text.

`node test/acceptance.mjs`: 16/16 passed. Demo port `60199`.

`node test/ai-login.mjs`: 6/6 passed. An empty expected result stayed editable, its Approve button stayed disabled, and the corrected assertion passed. The wrong assertion expected `Not the real error` and received `Invalid credentials`.

`node test/ai-flow.mjs`: the run immediately after acceptance timed out once. Run on its own, 4/4 passed. The wrong message was `Invalid credentials`.

`node test/screenshot.mjs`: 5 passed, 0 failed. No image was invented.

`node test/playwright-export.mjs`: the success spec passed. The deliberate failure expected `http://127.0.0.1:60348/not-the-app` and received `http://127.0.0.1:60348/app.html`. The password was absent.

`node test/shop.mjs`: 5 passed, 0 failed. Demo port `60398`. The official Playwright runner passed the export.

`node test/persistence.mjs`: product save, Chrome restart, and reopened steps passed. Demo port `60429`. The extensions Reload check is still the debug-session limitation.

`node test/recorder-start.mjs` in Chrome/157.0.8103.39: 18/18 passed. Origins `http://127.0.0.1:60461` and `http://127.0.0.1:60462`. The Chrome restart origin was `http://127.0.0.1:60500`.

One GPT-4.1-mini request on `http://127.0.0.1:60971/` returned `Invalid Login Credentials` and `Successful Login`. Provider usage was prompt 323, completion 438, total 761. No cost was reported. The steps were `data-testid=username`, `data-testid=password`, `data-testid=remember`, `data-testid=submit`, and `data-testid=error`. The password step was `{{Password}}`.

The browser session closed before Approve because the verification script called a missing Puppeteer method. A second provider call was not made. The captured steps were replayed through the packaged runner on `http://127.0.0.1:61283/`. Invalid login passed, including the observed error `Invalid credentials`. The wrong assertion expected `Not the real error` and received `Invalid credentials`. Successful login reached `Welcome, Demo`. Revalidation on `/app.html` resolved `testid=welcome`. The wrong heading expected `Welcome, Nobody` and received `Welcome, Demo`.

The official Playwright runner passed the export. The failing spec expected `Welcome, Nobody` and received `Welcome, Demo` from `getByTestId('welcome')`. The password literal was absent. `TEST_PASSWORD` supplied the secret.

## 1.0.0 release candidate, 2026-11-26

Chrome for the extension runs: Chrome/158.0.8127.38.

`npm test`: 42 passed, 0 failed, 1 skipped. The skip is the live provider test when the shell has no credentials.

`node --test test/live-ai.test.mjs`, using the proxy already listening on 127.0.0.1:8787: 1 passed. This does not repeat the Demo Bank login in the controller. That full login was not run again in this release session.

`node test/recorder-start.mjs`: passed, including stop, start again, and a Chrome restart.

`node test/acceptance.mjs`: 16 passed.

`node test/persistence.mjs`: save, Chrome restart, and restored steps passed. The in-session extension reload remains the debug-session limitation and is not a product pass.

`node test/ai-login.mjs`: passed.

`node test/playwright-export.mjs`: exported login passed, the deliberate wrong URL failed as intended, and the password was absent.

`node test/runtime-secrets.mjs`: passed.

`node test/shop.mjs`: 5 passed.

`node test/screenshot.mjs`: 5 passed after the Results view kept Chrome's screenshot reason. The first run in this session failed that one check because the reason was hidden. No image was invented.

`node scripts/capture-store-ui.mjs`: 6 passed. The Results buttons downloaded an HTML report and a JSON report. The JSON kept the failed assertion and omitted screenshot bytes. Chrome loaded `dist/browser-test-recorder-1.0.0.zip` and the controller said Live AI is not included.

`npm run package`: Chrome loaded the zip. The package manifest is version 1.0.0.

## 1.0.1 test management, 2026-11-26

Chrome for the extension runs: Chrome/158.0.8127.38.

`npm test`: 47 passed, 0 failed, 1 skipped. The skip is `test/live-ai.test.mjs` because `PROXY_AUTH_TOKEN` and `AI_API_KEY` were not set in this shell. A process was listening on 127.0.0.1:8787. This session did not call the provider.

`node test/library-ui.mjs`: 10/10. Empty Home does not invent a result. Search, the AI filter, rename, duplicate, cancelled delete, confirmed delete, and navigation during recording passed. The deleted copy was gone and the original failed run remained.

`node test/recorder-start.mjs`: passed, including stop, start again, and a Chrome restart.

`node test/acceptance.mjs`: 16/16.

`node test/persistence.mjs`: save, Chrome restart, and restored steps passed. The in-session extension reload remains the debug-session limitation.

`node test/ai-login.mjs`: 6/6.

`node test/playwright-export.mjs`: exported login passed, the deliberate wrong URL failed as intended, and the password was absent.

`node test/runtime-secrets.mjs`: passed.

`node test/shop.mjs`: 5/5.

`node test/screenshot.mjs`: 5/5.

`node scripts/capture-store-ui.mjs`: 8/8. Home, the empty library, Recorder, Results, Mock AI, and the store package were captured from Chrome. The store package says Live AI is not included. The 1.0.1 zip SHA-256 is `08e231cb76be6dfeb0f9c3a46fdb6e205869a56e3e2616e1a171ea0b9e8470fa`. The 1.0.0 zip hash did not change.
