# Privacy practices checklist

Use this when filling the Chrome Web Store privacy form. Answer from the 1.0.1 store package, not from the development-only live proxy.

| Practice | Store package |
| --- | --- |
| Personally identifiable information collected by the developer | No. Data stays in the browser profile unless the user downloads a report or, in a development build, configures a proxy. |
| Health, financial, authentication, personal communications, location, web history | Not requested as a category. A recording can contain whatever the user does on a page they chose. Secret fields are stored as names. |
| User activity | The extension records a site only after Start, on the chosen tab. |
| Website content | The recorder reads the chosen page to build steps. Failure screenshots, when Chrome allows them, contain the visible page. |
| Remote code | The store package does not fetch or execute remote code. Live AI is omitted. See `docs/STORE_POLICY.md`. |
| Single purpose | Record a chosen site, replay those steps, export test code, and show the run result. |
| Data sold or used for creditworthiness or advertising | No. |
| Privacy policy URL | Public URL of `docs/PRIVACY.md` after it is confirmed reachable. |

Do not certify categories the recording might incidentally see unless the form asks about data the extension itself collects. The form's "website content" disclosure should be yes, because the recorder reads the page the user selects.
