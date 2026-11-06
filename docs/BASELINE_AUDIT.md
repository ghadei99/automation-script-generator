# Baseline audit

Audited commit: `270506b88f6a947d73371e2640a69193e5920f82` on `master`  
Branch created for this work: `feature/private-beta`  
Date: 2026-11-06  
Method: source inspection of every extension file, comparison with `README.md`, and a deterministic simulation of the storage write pattern. No feature was marked working unless the code path exists. Nothing was executed in Chrome during this audit.

## Repository

| Item | Verified value |
|---|---|
| Remote | `https://github.com/ghadei99/automation-script-generator.git` |
| Default branch | `master` |
| HEAD | `270506b` Rewrite README for the current multi-framework/API/POM architecture |
| Working tree at audit | clean |
| Dependencies | none (`package.json` absent) |
| Tests | none |
| Install surface | unpacked Manifest V3 extension, no build step |

The README install snippet clones `Selenium-script-generator.git`. That URL is not this repository.

## What the code actually is

A Manifest V3 extension with a service worker (`background.js`), an isolated content script (`content.js`), a main-world network hook (`intercept.js`), a pure generator (`codegen.js`), and a controller window (`popup.html` + `popup.js`). The toolbar icon opens a 600×400 window. There is no `default_popup`.

There is no start/stop control, no replay engine, no assertion model, no saved tests, no result history, and no AI client. The README states the start/stop gap. It does not claim replay or AI.

## Manifest V3

| Check | Result |
|---|---|
| `manifest_version` | 3 |
| Background | service worker, classic script (not a module) |
| Remote code | none. No `eval`, no remotely loaded scripts |
| Content scripts | `<all_urls>`, `document_start` |
| Main world | `intercept.js` only |
| Permissions | `storage`, `webNavigation` |
| Host access | implicit from `<all_urls>` content scripts |
| Action popup | not used |

`webNavigation` listeners are registered for every top-level commit and history update. In modern Chrome those events still require host access; the content-script match pattern supplies that access for all http(s) pages. The extension therefore observes navigation on every site, not a user-selected one.

## Feature status

| Capability | Status | Evidence |
|---|---|---|
| Record click, double-click, submit | Works, always on | `content.js` document listeners |
| Record typing | Partial | `input` listener stores every keystroke as its own step, including the full current value |
| Record checkbox and radio | Partial | `change` listeners exist. Radio does not store the selected value. Shared `name` selectors are not checked for uniqueness |
| Record navigation and SPA history | Partial | `background.js` appends `{type:'navigate', url}` and drops only a consecutive duplicate URL. Fires for every tab |
| Capture fetch / XHR | Partial | `intercept.js` records method, URL, string body, status, content-type, and up to 10k of the response. Always on. Request headers are not captured. Bodies inside a `Request` object are missed because only `init.body` is read |
| Selenium Java POM | Works for the recorded action types | `renderSelenium` |
| Cypress JavaScript POM | Works, with string-escaping holes | `renderCypress` |
| Playwright TypeScript POM | Works as source text, not executed here | `renderPlaywright` |
| REST Assured Java | Works as source text from captured calls | `renderRestAssured` |
| Start / pause / stop | Missing | README limitation matches the code |
| Restrict recording to a tab or origin | Missing | listeners are global |
| Assertions | Missing | no action type and no generator branch |
| Replay in the browser | Missing | no execution path |
| Pass/fail results, screenshots | Missing | no result objects |
| Save, edit, reorder, history | Missing | one storage array, Clear wipes it |
| Natural-language test planning | Missing | no client, no proxy, no schema |
| Downloadable code files | Missing | copy-to-clipboard only |
| Automated tests | Missing | no test runner |

"Works" above means the code writes the expected structure. It was not replayed in a browser during the audit.

## Recording correctness

Events are appended by a read-modify-write against `chrome.storage.local` from both the content script and the service worker:

```javascript
const { recordedActions } = await chrome.storage.local.get('recordedActions');
const actions = recordedActions || [];
actions.push(action);
await chrome.storage.local.set({ recordedActions: actions });
```

`chrome.storage` returns a structured clone. Overlapping events each write their own clone back, so the last writer deletes the others. A four-call simulation of that pattern kept 1 of 4 events:

```text
storedCount: 1
stored: [{ "type": "navigate", "n": 4 }]
```

Other correctness gaps:

- Recording starts at injection time. Opening any page records it. There is no consent gate.
- Input steps are not coalesced, so one field becomes one step per keystroke.
- Selector order is `data-testid`, `aria-label`, `role`, short `textContent`, `id`, `name`, then the bare tag name. Nothing counts matches. `role="button"` and a long shared text node both look stable while matching many elements.
- `textContent` includes descendants, so a container can be recorded with a large, non-unique string.
- The CSS fallback is the tag name (`button`, `div`), flagged fragile in generated code.
- `document_start` injection is valid for bubble listeners. Full navigations recreate the content script; that part of the design is sound and is why storage, rather than a memory array, is used.

## Privacy and security

This is the blocking product defect.

- Password fields are stored like any other input. `e.target.value` is written to `chrome.storage.local` and later interpolated into Selenium, Cypress, Playwright, and REST Assured output.
- The network hook runs on every page before the user does anything. URLs, request bodies, and response bodies are stored raw. Tokens in query strings and JSON fields such as `password` or `access_token` are kept.
- Generated tests hard-code those values. The README login example shows this shape with a sample password.
- Captured traffic is not scoped to an origin.
- `<all_urls>` plus a main-world `fetch`/`XMLHttpRequest` patch is broader than a recorder that the user starts on one site.
- No `eval` and no remote script execution. That part is compatible with Manifest V3 remote-code policy.
- `popup.js` writes generator output into a textarea value, not `innerHTML`. No XSS in the current UI.
- The main-world hook is a persistent prototype patch. It can change page timing and can observe data the page did not intend to give an extension.

## Code generation

`codegen.js` is a pure function of the stored arrays and is safe to unit test. `buildPageModel` deduplicates page-object methods by `(type, strategy, value)` and keeps call order. That POM behavior is real.

Gaps that block a runnable export:

- JavaScript/TypeScript generators wrap some strings in single quotes (`cy.get('...')`, `page.locator('...')`). A selector or value containing a quote or newline breaks the file.
- `escapeStr` only escapes `\` and `"`. Newlines are not escaped for Java either.
- No explicit wait is emitted. Selenium clicks call `findElement` immediately.
- No assertion steps exist, so none are rendered.
- Secret values are literals, not parameters.
- REST Assured emits `.body("...")` with the recorded body inside a Java string, and only allows the method through by lower-casing it. A captured method outside the HTTP verbs would be emitted as a method call.
- Playwright output imports `@playwright/test` types and uses `async`/`await`, but this audit did not run it.

## UI

The window can show the three UI generators, a REST Assured panel, Copy, and Clear. Clear deletes both storage keys. `chrome.storage.onChanged` refreshes the text areas. There is no recording state, empty-state guidance beyond `// No code saved yet.`, no step list, and no error surface for a failed clipboard write beyond `console.error`.

## What must be fixed before new features

P0. Stop recording until the user starts a session, bind that session to one tab and origin, serialize storage writes, and never persist passwords, tokens, or raw network payloads.

P1. Replay the canonical step list inside the selected tab and report real pass, fail, or skipped results, including why a step failed.

P2. Keep the four generators on that same step list, escape strings, parameterize secrets, and render assertions. Lock them with regression tests.

P3. AI plans stay data. Validate them. Do not execute model output as JavaScript. Mock mode must work with no network. A live proxy is opt-in and must not ship with a provider key.
