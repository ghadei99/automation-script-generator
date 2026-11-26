# Chrome Web Store policy note

Reviewed 26 November 2026 against the Chrome Web Store Program Policies and the Manifest V3 additional requirements published by Google. This is not a legal opinion and it is not a statement that a reviewer will approve the package.

## The precise risk

Manifest V3 requires the extension's executable logic to ship inside the package. Google's MV3 requirements prohibit remotely hosted code. That includes fetching JavaScript or WebAssembly and running it. It also covers an extension whose behavior is changed by code that was not in the reviewed package.

This project does not `eval` provider output, and `lib/schema.js` rejects fields that would carry a script. The live path still asks a remote model for a list of actions and then runs that list with the packaged runner. The actions are limited to navigate, click, type, submit, wait, and assertions, and a person approves the plan first. A reviewer can still treat that remote list as configuration of extension behavior that was not part of the reviewed package. Schema checks and an approval button do not, by themselves, put the plan inside the package the reviewer saw.

Mock AI does not have this problem. The proposal rules are in `lib/ai.js`, which is part of the package. The open page supplies element references. Nothing is fetched in order to decide what the extension will do.

## Store package

`npm run package` writes `dist/browser-test-recorder-1.0.0.zip`. In that zip, `lib/build.js` sets `storeBuild` to true. The packaged controller:

- labels the assistant **Mock AI**
- states that **Live AI is not included in this package**
- does not show a Live AI control, a proxy URL, or a proxy token
- refuses a live planning request with that same sentence

The development tree keeps `storeBuild` false. Live AI remains available there, including the local reference proxy. The proxy is not part of the extension package.

The store listing must describe on-device proposals only. It must not say that the published extension contacts an AI provider.

## What would reopen the risk

Shipping a package with `storeBuild` false, or adding a step type that carries JavaScript, CSS, or a selector the page summary did not contain, would put the remote-code question back in front of review.
