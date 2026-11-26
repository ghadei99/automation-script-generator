# Permission justification

Product: Browser Test Recorder 1.0.0. Manifest V3.

| Permission | Why it is requested | What it is not used for |
| --- | --- | --- |
| `storage` | Saves tests, redacted steps, run results, and settings on this browser profile. | It does not sync to a developer account. |
| `scripting` | Injects the packaged recorder and replay scripts into the tab the user started. | It does not inject remote code. |
| `webNavigation` | Records a top-level navigation on the tab that is already being recorded. | It does not record other tabs or run while recording is stopped. |
| `tabs` | Finds the tab the controller is driving and sends it the packaged step. | It does not read page contents from every tab in the background. |
| `activeTab` | Lets a click on the extension icon act on the current tab when Chrome grants that temporary access. | It does not keep access after the user leaves the page. |
| Host `http://localhost/*` and `http://127.0.0.1/*` | Lets the local demo run without an extra site prompt. | It does not grant the public web. |
| Optional host `http://*/*` and `https://*/*` | Chrome asks before the extension can record or replay another origin. The user can deny it. | The package does not declare `<all_urls>` as a required host permission. |

Recording stays off until the user presses Start. Only the chosen tab is recorded, and only while the status is Recording. Network capture is off unless the user opts in, and captured calls are redacted before they are stored.

The store package does not include a provider key, a proxy token, or the local AI proxy.
