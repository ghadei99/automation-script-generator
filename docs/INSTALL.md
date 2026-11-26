# Installation and use

## Development load

1. Clone the repository and open `chrome://extensions`.
2. Turn on Developer mode.
3. Choose Load unpacked and select this directory.
4. Open the site you want to test, then click the Browser Test Recorder icon. A controller window opens. It is not recording yet.

There is no build step for this load. The source tree includes Live AI. Leave Settings on Mock AI unless you are running the local proxy described in `docs/AI_POLICY.md`.

## Store package

```bash
npm install
npm run package
```

The zip is `dist/browser-test-recorder-1.0.1.zip`. The 1.0.0 zip is kept beside it. Unzip it and load that folder with Load unpacked to review the store build. That build does not offer Live AI. Do not submit the zip while the developer registration payment is pending.

## Record, run, and report

1. Press Start and allow the site if Chrome asks.
2. Use the page. Pause, resume, or stop from the controller.
3. Edit steps, add assertions, and save the test.
4. On Run tests, enter any secret for this run. It is not stored.
5. Open Results. Download HTML Report or Export result JSON.
6. Open Code export for Playwright, Selenium, Cypress, or REST Assured.

The local demo is `npm run demo`, then `http://127.0.0.1:4173`. The published dummy account is username `demo` and password `demo123`.
