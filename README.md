# Selenium Script Generator

A Chrome extension (Manifest V3) that records interactions and API calls made
while browsing a page, then generates test code from that recording:
Selenium (Java), Cypress (JavaScript), and Playwright (TypeScript) for UI
automation, plus Rest Assured (Java) for the API calls the page made during
the same session.

## Problem this solves

Writing UI and API test scaffolding by hand is repetitive: find a selector,
write the interaction, find the request, write the assertion. Existing
recorder tools solve part of this (see below), but nothing in common use
solves all three of:

- outputting more than one test framework from a single recording,
- capturing the API traffic that happened alongside the UI actions and
  turning it into assertions against the actual responses, and
- structuring the output as something other than one linear, throwaway
  script.

This extension records once and produces UI automation code (in a choice of
three frameworks) and API test code together, structured as Page Object
Model rather than a flat script.

## How this differs from Playwright codegen / Selenium IDE

| | Playwright codegen | Selenium IDE | This extension |
|---|---|---|---|
| Output frameworks | Playwright only | Selenium only (a few language bindings) | Selenium, Cypress, or Playwright from the same recording |
| API/network capture | No | No | Captures `fetch`/`XHR` calls made during the recording and generates Rest Assured tests with assertions from the actual response |
| Output structure | Flat script | Flat script | Page Object Model: a `RecordedPage` class with one reusable method per distinct element interaction, plus a separate test file |
| Selector strategy | Auto-generated, framework-internal | Whatever the recorder finds first | Explicit priority order (`data-testid` → ARIA → visible text → `id`/`name` → CSS), with fragile fallback selectors flagged inline in the generated code |

Playwright codegen and Selenium IDE are both good at the thing they do: they
record one framework's worth of UI steps into a script. This extension is
aimed at the case where you also want the API assertions from the same
session, in more than one framework's syntax, without hand-restructuring the
output afterward into something reusable.

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/ghadei99/Selenium-script-generator.git
   ```
2. Open the project folder:
   ```bash
   cd Selenium-script-generator
   ```
3. Load the extension in Chrome:
   - Open `chrome://extensions/`.
   - Enable "Developer mode".
   - Click "Load unpacked" and select the project folder.

## Usage

1. Click the extension icon to open the recorder popup.
2. Browse normally: click, type, submit forms, navigate between pages. Any
   `fetch`/`XHR` calls the page makes are captured alongside your actions.
3. In the popup, switch between the **UI Automation** and **API Tests**
   tabs. Under UI Automation, pick a framework from the dropdown, or choose
   **All** to see all three side by side.
4. Use **Copy** to copy the code currently shown, or **Clear** to reset the
   recording and start over.

### Example: recording a login

Given a recording of visiting a login page, typing a username (into an
element with `data-testid="username-input"`), typing a password (into an
element with `aria-label="Password"`), and clicking a "Sign in" button (no
`data-testid`/ARIA attributes, matched by its visible text) — three
distinct actions, no repeats — the UI Automation tab produces:

**Selenium (Java)**
```java
// ==== RecordedPage.java ====
public class RecordedPage {
    private final WebDriver driver;

    public RecordedPage(WebDriver driver) {
        this.driver = driver;
    }

    public void navigateTo(String url) {
        driver.get(url);
    }

    public void enterUsernameInput(String value) {
        driver.findElement(By.cssSelector("[data-testid=\"username-input\"]")).sendKeys(value);
    }

    public void enterPassword(String value) {
        driver.findElement(By.cssSelector("[aria-label=\"Password\"]")).sendKeys(value);
    }

    public void clickSignIn() {
        driver.findElement(By.xpath("//button[contains(normalize-space(.), \"Sign in\")]")).click();
    }
}

// ==== RecordedTest.java ====
public class RecordedTest {
    public static void main(String[] args) {
        WebDriver driver = new ChromeDriver();
        RecordedPage page = new RecordedPage(driver);

        page.navigateTo("https://example.com/login");
        page.enterUsernameInput("alice");
        page.enterPassword("hunter2");
        page.clickSignIn();
    }
}
```

**Playwright (TypeScript)**
```ts
// ==== RecordedPage.ts ====
import { Page } from '@playwright/test';

export class RecordedPage {
  constructor(private page: Page) {}

  async navigateTo(url: string) {
    await this.page.goto(url);
  }

  async enterUsernameInput(value: string) {
    await this.page.locator('[data-testid="username-input"]').fill(value);
  }

  async enterPassword(value: string) {
    await this.page.locator('[aria-label="Password"]').fill(value);
  }

  async clickSignIn() {
    await this.page.getByText("Sign in").click();
  }
}

// ==== recorded.spec.ts ====
import { test } from '@playwright/test';
import { RecordedPage } from './RecordedPage';

test('replays the recorded actions', async ({ page: pwPage }) => {
  const page = new RecordedPage(pwPage);
  await page.navigateTo("https://example.com/login");
  await page.enterUsernameInput("alice");
  await page.enterPassword("hunter2");
  await page.clickSignIn();
});
```

**Cypress (JavaScript)**
```js
// ==== RecordedPage.js ====
class RecordedPage {
  navigateTo(url) {
    cy.visit(url);
    return this;
  }

  enterUsernameInput(value) {
    cy.get('[data-testid="username-input"]').clear().type(value);
    return this;
  }

  enterPassword(value) {
    cy.get('[aria-label="Password"]').clear().type(value);
    return this;
  }

  clickSignIn() {
    cy.contains('button', "Sign in").click();
    return this;
  }
}

export default RecordedPage;

// ==== recorded.cy.js ====
import RecordedPage from './RecordedPage';

describe('Recorded session', () => {
  it('replays the recorded actions', () => {
    const page = new RecordedPage();
    page.navigateTo("https://example.com/login");
    page.enterUsernameInput("alice");
    page.enterPassword("hunter2");
    page.clickSignIn();
  });
});
```

If the same element is interacted with more than once in a recording (e.g.
the same button clicked twice), it produces one method, called twice — not
two duplicate method definitions.

If no `data-testid`, ARIA attribute, visible text, `id`, or `name` is
available for an element, the generator falls back to a bare tag-name CSS
selector and marks every line using it, in every framework, with an inline
comment: `// FRAGILE SELECTOR: ... - verify manually`.

### Example: API Tests tab (Rest Assured)

If the page made a `GET /api/session` call during the recording that
returned `{"userId": 42, "name": "Alice", "roles": ["admin", "user"]}` with
a `200` status and a JSON content type:

```java
given()
.when()
    .get("https://example.com/api/session")
.then()
    .statusCode(200)
    .contentType(containsString("application/json"))
    .body("userId", equalTo(42))
    .body("name", equalTo("Alice"))
    .body("roles.size()", equalTo(2));
```

Assertions are derived from the actual response body: scalar fields become
`equalTo()` checks, arrays become `.size()` checks, and nested objects
become `notNullValue()` checks. This isn't a generic "assert 200" stub — the
recorded response's structure is not just being echoed back, it's read at
generation time.

## Architecture

### Event capture

`content.js` is injected into every page (`document_start`, isolated world)
and listens for `click`, `input`, `change` (radio/checkbox), `submit`, and
`dblclick` on `document`. Each event is turned into a framework-agnostic
action object — `{ type, selector, value?, checked? }` — and appended to
`chrome.storage.local` under `recordedActions`. The append is a
read-modify-write against storage on every event rather than an in-memory
array, because content scripts are re-created on every page load; an
in-memory array would be wiped by the very first navigation.

The selector attached to each action is a descriptor, not a rendered
selector string: `{ strategy, value, fragile }`, where `strategy` is one of
`testid` / `ariaLabel` / `role` / `text` / `id` / `name` / `css`, tried in
that order (see `getSelectorDescriptor()` in `content.js`). Keeping the
descriptor framework-agnostic is what makes it possible to render three
different selector syntaxes from the same recording without re-recording.

### API capture

`intercept.js` runs as a second content script declared with `"world":
"MAIN"` in `manifest.json`, so it executes in the page's own JavaScript
context rather than the isolated content-script sandbox. It wraps
`window.fetch` and `XMLHttpRequest.prototype.open`/`send` to capture method,
URL, request body, response status, response content-type, and response
body for every call the page's own scripts make, then relays each capture
to `content.js` via a `CustomEvent` (`__selRecorderApiCall`) — the isolated
and main worlds don't share objects directly, so the payload is JSON-encoded
across that boundary. `content.js` stores these under a separate
`recordedApiCalls` key.

This was chosen over `chrome.webRequest` (which can't see response bodies at
all) and the `chrome.debugger` API (which can, but requires a much broader
permission and shows a persistent "this extension is debugging your
browser" banner in Chrome — a poor fit for something meant to run
continuously in the background). The tradeoff is that only `fetch`/`XHR`
traffic is captured, not e.g. requests issued by a service worker directly;
that's judged acceptable since API test generation only cares about the
calls the recorded page code itself makes.

### Navigation tracking

Content scripts alone can't reliably observe SPA client-side routing (there
is no DOM event that fires on `history.pushState`/`replaceState` that a
content script can listen for without the page cooperating). Instead,
`background.js` uses `chrome.webNavigation.onCommitted` (full page loads,
reloads, link-driven navigations) and `chrome.webNavigation.onHistoryStateUpdated`
(SPA route changes), both filtered to the top-level frame, and appends a
`{ type: 'navigate', url }` action directly to the same `recordedActions`
storage array content.js writes to — deduplicated against consecutive
identical URLs.

### Code generation

`codegen.js` is loaded by `popup.html` and exports one render function per
output format (`renderSelenium`, `renderCypress`, `renderPlaywright`,
`renderRestAssured`). All four read from the same stored action/API-call
arrays; none of them touch the DOM or `chrome.*` APIs, so they're pure
functions of the recorded data and can be tested standalone (as most of this
was during development, since the popup's own `chrome.storage` dependency
makes it awkward to drive interactively outside a real installed
extension).

`renderSelenium`/`renderCypress`/`renderPlaywright` share a
`buildPageModel()` step that turns the flat, chronological action list into
a page-object model: a map from `(action type, selector)` to one reusable
method (deduplicating repeated interactions with the same element), plus the
ordered list of calls the test file makes into those methods. Each
framework then has its own per-method renderer (selector syntax and
API differ — e.g. Selenium has no native "set checkbox to state X", so its
checkbox method reads `isSelected()` and only clicks if the state doesn't
already match, whereas Cypress/Playwright's `check()`/`uncheck()` are
idempotent already) but all three consume the same `{ methods, calls }`
structure.

`renderRestAssured` is independent of the page-object step — API calls
don't have a "reusable method" abstraction that fits the same shape as UI
interactions here — and instead maps each captured call straight to one
`given().when().then()` block, deriving assertions from the parsed JSON
response.

## Known limitations

- Recording is global and always-on for any page the content scripts are
  injected into — there's no start/stop toggle for a specific recording
  session; `Clear` resets everything captured so far.
- Text-based selectors (the third priority tier) are capped at 60 characters
  and matched via `contains()`/`cy.contains()`/`getByText()`, so they can
  still match more than one element on the page; there's no attempt to
  verify uniqueness at record time.
- API capture only sees `fetch`/`XHR` traffic issued by the page's own
  scripts, not requests from service workers or other extensions.
- Checkbox/radio "set to state X" replay assumes the target element's
  current state at replay time is discoverable the same way it was at
  record time; this holds for standard HTML form controls but not for
  custom widgets that fake a checkbox's appearance without an underlying
  `<input>`.
