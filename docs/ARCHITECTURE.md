# Architecture

This is the extension after the private-beta work. The baseline, including the always-on recorder, is in `docs/BASELINE_AUDIT.md`.

## What stays

`codegen.js` still turns one step list into Selenium Java, Cypress JavaScript, Playwright TypeScript, and REST Assured Java. UI actions still become a `RecordedPage` class plus a test that calls it. Repeated interactions with the same element still share one method. The generators are pure functions and are covered by `test/core.test.mjs`.

## Session model

The service worker in `background.js` is the only writer of recorder state. Content scripts send events. A mutex serializes read-modify-write so overlapping clicks and navigations cannot drop each other. The reducer in `lib/reducer.js` is pure and is the piece the unit tests exercise.

A session has `idle`, `recording`, `paused`, or `stopped`. Events are appended only while status is `recording`, only for the tab id captured at Start, and only for that tab's origin. Navigation outside the origin becomes a warning, not a step. Consecutive duplicate navigations are dropped. A later visit to the same URL is kept, because that is a reload. Text input on the same field replaces the previous input step instead of storing every keystroke.

Nothing is injected until Start. Start registers content scripts for that origin only and injects them into the current tab. Stop unregisters them. `http://localhost/*` and `http://127.0.0.1/*` are install-time host permissions so the demo can run. Every other site is an optional host permission requested from the Start click.

## Steps

The canonical step is a JSON object with a type from a fixed list: `navigate`, `click`, `dblclick`, `input`, `checkbox`, `radio`, `select`, `submit`, `wait`, `assertVisible`, `assertText`, `assertUrl`, `assertExists`. `lib/schema.js` rejects any other type and rejects fields named `script`, `code`, `eval`, `javascript`, or `functionBody`.

Selectors are collected in the page, then ranked without AI. The order is a verified `data-testid` (or `data-test`, `data-cy`, `data-qa`), a verified role plus accessible name, an associated label, a stable id, name, placeholder, or short text, a selector scoped to a stable parent, then a structural CSS path. A candidate is verified against the live DOM. An attribute is not treated as unique just because it is present. Role checks use the page role and accessible name, and the stored explanation says that this is not a Playwright `getByRole` check. Dynamic ids such as `ember4821` are skipped. The step stores the winning locator, the other candidates, and a short fingerprint: tag, role, accessible name, stable attributes, and a parent anchor. It does not store field values, tokens, or a DOM snapshot. Older saved selectors gain one recorded candidate during schema cleanup and keep their original strategy.

Replay uses the selected primary locator. If that locator matches nothing, or matches more than one element, the step fails. Backup candidates are checked and shown with a reason. A unique backup whose tag, role, and accessible name still match can be approved by the user. Approval edits the step and does not change the failed result. An ambiguous backup is not clicked. A later step stays skipped. Generated Playwright, Selenium, and Cypress use the chosen locator. Structural paths keep their warning. REST Assured is unchanged.

## Secrets and network capture

Password fields, password autocomplete, and names that look like tokens are stored as `{ secret: true, paramName }` with no value. The reducer deletes a value if a caller sends one anyway. Run tests asks for those parameters and passes them only in the replay message. Run history stores the parameter names.

Network capture is off by default. The main-world hook in `injected/network.js` is registered only when the user opts in, and it redacts URLs and JSON before the event crosses into the content script. The content script and the reducer redact again. Calls to other origins are dropped. Bodies are capped and sensitive keys become `REDACTED`.

## Replay

`lib/runner.js` runs steps in order. A thrown step is `failed`. Every later step is `skipped`. Stop becomes `stopped`. The runner never rewrites a failure into a pass. The service worker performs navigation and URL assertions, because the content script is destroyed on a full load. Element steps run in `content.js`. A click that navigates is treated as success only when the tab actually changes URL. If the service worker dies mid-run, startup marks that run `interrupted` and records why. That is not a pass.

Results, saved tests, and the draft session live in `chrome.storage.local`. There is no database server. Screenshots are requested with `chrome.tabs.captureVisibleTab` after the failing tab is focused. On Chrome 156 that call requires `<all_urls>` or a live `activeTab` grant from a click on the extension icon. Site-scoped host permissions do not satisfy it, and a later navigation clears the grant. The extension does not request `<all_urls>`. A stored image has to be a JPEG Chrome returned. Otherwise `screenshot` is null and `screenshotError` starts with "Screenshot unavailable" followed by the reason, including Chrome's own message. The Results view shows that text and does not render a placeholder image.

## Controller

`popup.html` is a window opened from the toolbar icon. It has Recorder, Test steps, Run tests, Results, Code export, AI assistant, and Settings. It talks to the service worker with messages. It does not grant itself permission to record the extension page.

## AI

Mock mode in `lib/ai.js` returns a plan that `validatePlan` accepts. It does not call a provider. The service worker first builds a compact page summary: the visible heading, up to 24 interactive elements, each element's role, accessible name, form id, and up to three verified non-structural locators, plus up to four visible validation messages. It does not read field values, cookies, or tokens. A selector is attached only when that summary contains it. Any other selector is removed. Password-like inputs are stored as secret parameters with no value. `javascript:` navigation URLs are dropped. Saving a plan creates a test with `source: "ai"`. Nothing runs it automatically.

Live mode POSTs `{ prompt, targetOrigin, summary }` to the URL in settings, with an optional bearer token stored only in extension storage. The reference proxy in `server/ai-proxy.mjs` binds to `127.0.0.1`, refuses to listen without `PROXY_AUTH_TOKEN` and `AI_API_KEY`, allows 10 requests a minute, forwards only the compact summary, and returns a plan only after `scrubPlan` and `validatePlan`. When the provider response includes token counts, the proxy passes those numbers through and does not invent a price. An approved live plan is reused for the same prompt and page summary, and that reuse does not call the provider. Remote model text is not evaluated. Replay only executes the allowlisted step types. The proxy is not deployed.

This is not a Chrome Web Store compliance determination. The policy notes are in `docs/AI_POLICY.md`.

## Manifest V3

The package contains no remote script, no `eval`, and no third-party script. The main-world file is packaged with the extension and is installed only for an origin the user started. A model response is still remote data. The extension treats it as a suggestion for a closed local interpreter, and only after the user approves it. That design choice is documented in `docs/AI_POLICY.md`. It is not by itself a claim that the package is Web Store compliant.
