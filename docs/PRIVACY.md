# Privacy policy

Browser Test Recorder
Version 1.0.0
Effective 26 November 2026

This policy describes the data the extension actually handles. It is the draft to host at a public HTTPS address before a Chrome Web Store submission.

## Who operates it

The extension runs on the user's computer. It does not create an account and it does not send data to the developer by default.

## Data stored on the device

The extension stores, in Chrome's local extension storage:

- the test name, steps, locators, and assertions the user records or approves
- run status, step results, expected values, actual values, and failure messages
- a failure screenshot only when Chrome allows the capture
- settings such as step timeouts
- in a development build only, a proxy URL and proxy token if the user saves them

Runtime passwords and other secret parameters are kept in memory for the current run. They are not written to extension storage. Recorded password fields are stored as parameter names, not as the typed value.

Downloaded reports omit failure screenshots unless the user checks "Include available failure screenshots". Reports redact bearer tokens, JWTs, and values assigned to password, token, or API-key fields. They do not include request or response bodies.

## Data that can leave the device

The store package generates AI proposals on the computer. It does not contact an AI provider.

A development build can send a prompt and a compact page summary to a proxy URL the user types. That summary is the heading, a limited list of interactive elements, and visible validation messages. It does not include field values, cookies, or the provider key. The provider key stays in the proxy process, which is not part of the extension. If the user does not save a proxy URL, that call is not made.

Pages the user records are read in the browser so the extension can build steps. Optional network capture records calls on the recording origin and redacts sensitive fields before saving them.

Screenshots can contain whatever was visible on the page, including data the user typed. They stay in local extension storage until the user includes them in a downloaded report.

## What this extension does not do

- It does not sell personal data.
- It does not use data for advertising.
- It does not record until the user presses Start.
- It does not require a remote account.

## Choices

The user can delete tests and clear extension storage from `chrome://extensions`. Denying an optional site permission stops recording and replay on that site. Leaving the screenshot box unchecked keeps captured images out of the downloaded report.

## Contact

Privacy questions go to the repository owner listed on https://github.com/ghadei99/automation-script-generator.

## Hosting this policy

The store form needs a public HTTPS URL. After this file is on the public `master` branch, use:

https://github.com/ghadei99/automation-script-generator/blob/master/docs/PRIVACY.md

Confirm in a private window that the URL loads without signing in. If the repository is made private, publish this same text on another public HTTPS page and put that URL in the store form. Do not mark the policy as hosted until that page loads.
