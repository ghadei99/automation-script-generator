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

Selectors are chosen in the page from `data-testid`, `data-test`, `data-cy`, `data-qa`, id, name, aria-label, placeholder, role plus accessible name, short text, then a structural CSS path. A candidate is used when it matches one element. Otherwise the step keeps the CSS path and a warning. Replay uses the unique path when the semantic selector was ambiguous, and fails when the selector still matches more than one element.

## Secrets and network capture

Password fields, password autocomplete, and names that look like tokens are stored as `{ secret: true, paramName }` with no value. The reducer deletes a value if a caller sends one anyway. Run tests asks for those parameters and passes them only in the replay message. Run history stores the parameter names.

Network capture is off by default. The main-world hook in `injected/network.js` is registered only when the user opts in, and it redacts URLs and JSON before the event crosses into the content script. The content script and the reducer redact again. Calls to other origins are dropped. Bodies are capped and sensitive keys become `REDACTED`.

## Replay

`lib/runner.js` runs steps in order. A thrown step is `failed`. Every later step is `skipped`. Stop becomes `stopped`. The runner never rewrites a failure into a pass. The service worker performs navigation and URL assertions, because the content script is destroyed on a full load. Element steps run in `content.js`. A click that navigates is treated as success only when the tab actually changes URL. If the service worker dies mid-run, startup marks that run `interrupted` and records why. That is not a pass.

Results, saved tests, and the draft session live in `chrome.storage.local`. There is no database server. Screenshots are requested with `chrome.tabs.captureVisibleTab` after the failing tab is focused. On Chrome 156 that call still requires `<all_urls>` or a live `activeTab` grant, which site-scoped host permissions do not satisfy. The stored result then has `screenshot: null` and the Chrome error in `screenshotError`.

## Controller

`popup.html` is a window opened from the toolbar icon. It has Recorder, Test steps, Run tests, Results, Code export, AI assistant, and Settings. It talks to the service worker with messages. It does not grant itself permission to record the extension page.

## AI

Mock mode in `lib/ai.js` returns a plan that `validatePlan` accepts. Before that, the service worker reads a short element list from the open tab: tag, test id, id, name, label, and visible text. It does not read field values. A selector is attached only when one of those elements matches. Any other selector is removed. Saving a plan creates a test with `source: "ai"`. Nothing runs it automatically.

Live mode POSTs `{ prompt, targetOrigin }` to the URL in settings, with an optional bearer token stored only in extension storage. The response must pass the same schema. The reference proxy in `server/ai-proxy.mjs` refuses to listen without `PROXY_AUTH_TOKEN` and `AI_API_KEY`. Remote model text is not evaluated. Replay only executes the allowlisted step types.

## Manifest V3

The package contains no remote script, no `eval`, and no third-party script. The main-world file is packaged with the extension and is installed only for an origin the user started. That matches the Chrome Web Store restriction on remotely hosted code: a JSON plan interpreted by local code is data, not an extension update.
