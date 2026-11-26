# Known limitations

Version 1.0.0.

- Failure screenshots require Chrome to allow `captureVisibleTab`. A fresh click on the extension icon can grant that for the current page. Navigation clears it. The result then says "Screenshot unavailable" and does not pretend an image exists.
- The store package does not include Live AI. Remote plans remain a policy risk and stay in the development tree only. See `docs/STORE_POLICY.md`.
- Reloading the extension from `chrome://extensions` inside an automated debug session can fail to reopen the controller. A normal Chrome restart still reads the saved test.
- Optional site permission is per origin. A site the user has not allowed cannot be recorded or replayed.
- The extension does not run tests in the cloud, and it does not connect to Jira or Excel.
- An AI proposal is not a passing test. Only a run can pass or fail.
- Mock AI does not know account names or the page that appears after a successful login. Those steps need a person to fill them in before a run.
