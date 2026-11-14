# Contributing

Thanks for helping improve AI Price Analyzer.

## Repository boundaries

The extension repository contains the Chromium MV3 extension, shared collection and matching logic, generated plugin runtime files, tests, and documentation. Station adapter source is maintained in the separate [plugin repository](https://github.com/napstablook666/ai-price-analyzer-plugins).

When changing a station adapter, edit the matching directory in the plugin repository, regenerate the extension outputs, and submit the two repository changes separately:

1. Change `<id>/manifest.json`, `<id>/plugin.js`, or `<id>/models.json` in the plugin repository.
2. From the extension repository, run `node scripts/plugin-build.mjs`.
3. Run the extension tests and `node scripts/plugin-build.mjs --check`.
4. Commit the plugin source and the generated extension files in their respective repositories.

## Before opening a pull request

- Run `npm test`.
- Run the relevant `node --check` commands for changed JavaScript files.
- Run `node scripts/plugin-build.mjs --check` when plugin sources or generated outputs are involved.
- Remove credentials, cookies, authorization headers, private URLs, and account identifiers from examples, logs, and screenshots.
- Describe the extension behavior, station, collection mode, affected pages, and how you tested the change.
- Provide only a sanitized response structure when reporting a station adapter problem.
- Changes to host permissions or cross-origin requests should include a short reason and update [`PRIVACY.md`](./PRIVACY.md) when relevant.

## Pull requests

Explain the user-visible behavior, the affected extension files or station adapters, and the tests you ran. Keep changes focused on the extension, its tests, documentation, release automation, or the plugin source that belongs in the separate plugin repository.

For plugin-specific fields and runtime restrictions, read the [extension-side plugin contract](./docs/plugin-development.md) and the [plugin repository development guide](https://github.com/napstablook666/ai-price-analyzer-plugins/blob/main/DEVELOPMENT.md).
