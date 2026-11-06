# Browser Test Recorder

A Manifest V3 Chrome extension that records one site after you press Start, replays those steps in Chrome, and exports Selenium (Java), Playwright (TypeScript), Cypress (JavaScript), or REST Assured (Java).

Recording is off until you start it. Passwords and token-like fields are stored as named parameters, not as values. Network capture is off unless you opt in, and captured calls are redacted before they are saved.

## Install the unpacked extension

1. Clone this repository:

   ```bash
   git clone https://github.com/ghadei99/automation-script-generator.git
   cd automation-script-generator
   ```

2. Open `chrome://extensions`.
3. Turn on Developer mode.
4. Choose Load unpacked and select this directory. There is no build step.

Chrome 156 does not load this extension from `--load-extension` on the branded Chrome binary. Developer mode and Load unpacked still work. The acceptance run loads it through the DevTools `Extensions.loadUnpacked` command.

## Record and replay

1. Open the site under test in a normal browser window.
2. Click the extension icon. A controller window opens. It is not recording yet.
3. Press Start and allow the site when Chrome asks. `http://localhost` and `http://127.0.0.1` are already permitted so the local demo does not prompt.
4. Optional: check "Capture API calls" before starting. Leave it off unless you need REST Assured output.
5. Use the site. Pause, resume, or stop from the controller. Only the tab you started on is recorded, and only while status is Recording.
6. Edit steps, add assertions, and save the test.
7. On Run tests, enter any secret parameters for that run. They are not written to extension storage.
8. Pass, fail, and skipped are reported from the run that just executed. A failed step stays failed. Later steps are skipped.

Supported replay steps: navigate, click, double-click, fill text, select, checkbox, radio, submit, wait, assert visible, assert text, assert URL, assert exists.

## Demo site

```bash
npm install
npm run demo
```

Open `http://127.0.0.1:4173`. The dummy account is username `demo` and password `demo123`. The password field is masked in the recording. Invalid credentials show "Invalid credentials". An empty username shows "Username is required".

## Tests

```bash
npm test
node test/acceptance.mjs
```

`npm test` runs the unit tests in Node. `node test/acceptance.mjs` launches the installed Google Chrome, loads the extension, and drives the demo. It needs permission to launch Chrome.

## Code export

The Export view generates the four existing formats from the same step list. Secret inputs are emitted as environment parameters (`TEST_PASSWORD`, `Cypress.env`, `System.getenv`), not as literals. Playwright is the output intended to drop into a `@playwright/test` project. This repo's checks generate that file and assert its shape. They do not launch the Playwright runner.

## AI proposals

The AI assistant in mock mode builds a proposed plan on this machine. It does not call a provider. Selectors are copied from the open page when one element matches. The error message and the page a successful login should reach are left blank, because they were not visible when the plan was created. Edit those, then choose Approve and save. A run is the only thing that can pass or fail.

Live mode calls only a proxy URL you save in Settings. The extension has no provider key. `server/ai-proxy.mjs` is a reference proxy that exits unless `PROXY_AUTH_TOKEN` and `AI_API_KEY` are set. It is not deployed.

## Current limits

- Failure screenshots are not available on Chrome 156 with site-scoped host permissions. `captureVisibleTab` returns "Either the '<all_urls>' or 'activeTab' permission is required." The run still stores the failing step, message, expected value, and actual value. The extension does not invent a screenshot.
- Replay cannot drive `chrome://` pages, the Chrome Web Store, or other non-http(s) URLs. Start tells you that.
- A full Reload from `chrome://extensions` in the automated session blocks the extension page afterwards. The acceptance run instead terminates the service worker and reads the saved test back through a new one.
- AI output is data for the local step runner. The extension does not evaluate model text as JavaScript.
