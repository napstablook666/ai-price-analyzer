# Contributing

Thanks for helping improve AI Price Analyzer.

## Current maintenance scope

The maintained product is the Chromium MV3 extension in [`extension/`](./extension/). New issues and pull requests should target the extension.

The root userscript [`AI中转站价格分析工具.js`](./AI中转站价格分析工具.js) is archived. Changes to it are limited to archive, release, or documentation maintenance.

## Before opening a pull request

- Run `node --test extension/test/*.test.js`.
- Run the relevant syntax checks for files under `extension/src/`.
- Remove credentials, cookies, authorization headers, private URLs, and account identifiers from examples, logs, and screenshots.
- Describe the extension behavior, station, collection mode, pages affected, and how you tested the change.
- Provide only a sanitized response structure when reporting a station adapter problem.
- Changes to host permissions or cross-origin requests should include a short reason and update [`PRIVACY.md`](./PRIVACY.md) when relevant.

## Pull requests

Explain the user-visible behavior, the affected extension files or station adapters, and the tests you ran. Keep changes focused on the extension, its tests, documentation, or release automation.
