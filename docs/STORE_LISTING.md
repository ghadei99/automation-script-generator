# Store listing

Name: Browser Test Recorder

Short description (manifest and store, 114 characters):

Record one site you choose, replay the steps in Chrome, and export Playwright, Selenium, Cypress, or REST Assured.

## Long description

Browser Test Recorder records a site after you press Start. It does not record until then, and it records only the tab you started.

You can edit the steps, add assertions, and run them in Chrome. A failed step stays failed. Later steps are skipped. Passwords are entered at run time and are not saved in the test.

Results show the test name, time, duration, and how many steps passed, failed, or were skipped. You can download an HTML report or a JSON report. Both open without a network connection. Failure screenshots are left out of the file unless you choose to include them.

The export writes Selenium Java, Playwright TypeScript, Cypress JavaScript, or REST Assured Java from the same steps. Secret fields become environment parameters.

Mock AI proposes a plan from the page that is open. The plan is a proposal until you approve it. This store package does not include Live AI and does not contact an AI provider.

## Permission summary for the listing

The extension stores tests and results on the device. It injects its own recorder into the tab you start. Localhost is allowed for a local demo. Any other site needs the permission Chrome asks you to grant.

## Screenshots to upload

Capture these from the running controller and upload the PNGs in `store/screenshots/` after they are taken from the application:

1. Recorder idle, before Start.
2. Results for a failed assertion, including skipped steps and "Screenshot unavailable".
3. AI assistant labeled Mock AI.
4. The store package stating that Live AI is not included.

Version 1.0.1 also captured Home and the empty Test library in `store/screenshots/1.0.1/`. The 1.0.0 captures are in `store/screenshots/1.0.0/`.

Do not use a mockup, a stock photo, or a claim that the extension always captures screenshots.
