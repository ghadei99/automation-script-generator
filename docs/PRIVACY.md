# Privacy policy

Browser Test Recorder
Version 1.0.1
Effective 26 November 2026

This policy describes the Browser Test Recorder extension published for the Chrome Web Store.

## Who operates it

The extension runs on your computer. It does not create an account, and it does not send your tests or recordings to the developer.

## Data stored on the device

The extension stores this information in Chrome's local extension storage:

- the test name, steps, locators, and assertions you record or approve
- run status, step results, expected values, actual values, and failure messages
- a failure screenshot only when Chrome allows the capture
- settings such as step timeouts

Passwords and other secret parameters are kept in memory for the current run. They are not written to extension storage. A recorded password field is stored as a parameter name, not as the typed value.

A downloaded report leaves out failure screenshots unless you check "Include available failure screenshots". Reports remove bearer tokens, JWTs, and values assigned to password, token, or API-key fields. They do not include request or response bodies.

## Data that stays on the device

Proposals are created on your computer from the page you have open. They are not sent to an AI provider.

The extension reads the page you chose to record so it can build steps. That reading happens in the browser. Optional network capture, which is off unless you turn it on, keeps calls from the recording site in local storage after removing sensitive fields.

A screenshot can contain whatever was visible, including text you typed. It remains in local extension storage unless you choose to include it in a downloaded report.

## What this extension does not do

- It does not sell personal data.
- It does not use data for advertising.
- It does not record until you press Start.
- It does not require a remote account.
- It does not send prompts, page contents, or recordings to an AI provider.

## Your choices

You can delete the extension's stored data from `chrome://extensions`. Refusing a site permission stops recording and replay on that site. Leaving the screenshot box unchecked keeps captured images out of a downloaded report.

## Contact

Privacy questions: https://github.com/ghadei99/automation-script-generator
