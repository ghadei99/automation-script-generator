# AI planning and Chrome Web Store policy

This note records the review for the live-planning sprint. It is not a legal opinion and it is not a statement that the extension is Chrome Web Store compliant.

## What the store policy cares about

Manifest V3 requires the extension's executable logic to ship inside the package. Chrome's additional MV3 requirements prohibit remotely hosted code. That includes fetching JavaScript or WebAssembly and running it, and it includes `eval` or `new Function` on a string the extension did not ship.

A JSON response that passes a schema check is not automatically allowed. The risk is what the extension does with the JSON:

- If the extension evaluates a string from the model, that is remote code.
- If the JSON is an open command language, with arbitrary scripts, loops, or new step types, a local interpreter can still be treated as a way to run logic that was not reviewed with the package.
- If a public proxy accepts unauthenticated requests and returns instructions the extension runs, the review problem is larger, and so is the abuse problem.

## What this package does

The model is asked for a fixed shape: a title, a summary, and cases of steps. The step type has to be one of `navigate`, `click`, `dblclick`, `input`, `checkbox`, `radio`, `select`, `submit`, `wait`, `assertVisible`, `assertText`, `assertUrl`, or `assertExists`. `lib/schema.js` rejects any other type and rejects fields named `script`, `code`, `eval`, `javascript`, or `functionBody`.

Before a plan is shown:

- The page summary is built locally. It is the heading, at most 24 interactive elements, verified locator candidates, form ids, and at most four visible validation messages. Field values, cookies, and tokens are not included.
- Selectors that were not in that summary are removed.
- Password-like inputs become `{ secret: true, paramName }` with the value deleted.
- Navigation URLs that are not `http:` or `https:` are deleted.
- The plan is marked proposed. Replay starts only after the user approves it and then chooses Run.

The runner that executes a step is the packaged code in `background.js`, `lib/runner.js`, and `content.js`. It does not evaluate the model text.

The reference proxy keeps the provider key in its own environment. The extension stores only an optional proxy token and sends it to the proxy URL the user typed. The proxy binds to `127.0.0.1`, requires `PROXY_AUTH_TOKEN` and `AI_API_KEY` before it listens, and allows 10 requests a minute. It is not deployed.

An approved live plan is saved with the prompt and page-summary key. The same request reuses that saved plan and does not call the provider.

## Remaining policy risk

A reviewer can still decide that a remotely produced list of clicks and assertions is remote configuration of extension behavior, even though the interpreter is closed and the user approves every plan. This document does not claim that decision would go in the extension's favor.

The risk becomes immediate if a later change adds any of these:

- executing JavaScript, CSS, or selectors that the model invented and the page summary did not contain
- running a plan before the user approves it
- adding step types that carry code
- deploying the proxy without authentication and a usage limit
- putting `AI_API_KEY` in the extension package

## Real-provider check

The smoke test does not run unless both secrets are set. With them unset, the result is UNVERIFIED, not passed.

```bash
export PROXY_AUTH_TOKEN='a long random token'
export AI_API_KEY='the provider key'
export AI_MODEL='gpt-4.1-mini'
export AI_BASE_URL='https://api.openai.com/v1/chat/completions'
node server/ai-proxy.mjs
```

`AI_BASE_URL` is optional. It must be `https`, or `http://127.0.0.1` for a local stub. In another shell, with the same token and key:

```bash
node --test test/live-ai.test.mjs
```

Then set Settings to Live proxy, URL `http://127.0.0.1:8787`, and the same proxy token. Generate a proposal. The assistant label reads Live AI. Token counts appear only when the provider response includes them. The extension does not invent a cost.
