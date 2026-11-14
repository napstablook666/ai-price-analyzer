<h1 align="center">AI Price Analyzer</h1>

<p align="center"><strong>A no-build Chromium MV3 extension for comparing AI gateway model prices with public reference data.</strong></p>

<p align="center">
  <a href="./README.md">English</a> |
  <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/napstablook666/ai-price-analyzer/actions/workflows/ci.yml"><img src="https://github.com/napstablook666/ai-price-analyzer/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="https://github.com/napstablook666/ai-price-analyzer/releases"><img src="https://img.shields.io/github/v/release/napstablook666/ai-price-analyzer?style=flat-square" alt="Latest release"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-GPL--3.0-22C55E?style=flat-square" alt="GPL-3.0 license"></a>
</p>

AI Price Analyzer collects model prices from configured AI gateway stations, normalizes different model names to a shared identity, and presents local comparison tables. It runs as a Chromium Manifest V3 extension and does not require a bundler or hosted backend.

## Repositories

This project is intentionally split into two public repositories:

- **Extension repository:** this repository. It contains the MV3 pages, service worker, collection and matching core, generated plugin runtime files, tests, and documentation.
- **Plugin repository:** [ai-price-analyzer-plugins](https://github.com/napstablook666/ai-price-analyzer-plugins). It contains the hand-written station adapters, one station per directory.

For plugin development, check the plugin repository out as a sibling `plugins/` directory next to this repository. The extension build then generates `src/site-plugins/` from those sources. The generated files are committed here so a release checkout can load the extension directly.

## Highlights

| Capability | Description |
| --- | --- |
| Multi-station collection | Configure several gateway stations and refresh their model catalogs from one dashboard. |
| Local comparison dashboard | Store snapshots in IndexedDB, filter and sort results, and compare estimated costs. |
| Direct and page collection | Use a CORS-enabled JSON endpoint directly, or use a page bridge when a station requires the current browser login. |
| Model identity matching | Map station-specific names to canonical model identities with plugin aliases and user overrides. |
| Public reference data | Cache OpenRouter model data and a Bank of China exchange-rate reference for paid comparisons. |
| Optional account workflows | Use supported station check-ins when those features are enabled. |

## Install

1. Download `ai-relay-price-extension-v<version>.zip` from [GitHub Releases](https://github.com/napstablook666/ai-price-analyzer/releases), or clone this repository.
2. If you downloaded the ZIP, extract it. The directory you load must contain `manifest.json`.
3. Open `chrome://extensions` in a Chromium-based browser.
4. Enable **Developer mode**, choose **Load unpacked**, and select the extracted directory or this repository itself.

## Quick start

1. Open the extension popup and choose **站点与设置**, or open the extension dashboard.
2. Add a station URL, review the proposed host, endpoint, authentication mode, and collection mode, then confirm it.
3. Use **direct** collection for a CORS-enabled JSON endpoint. Use **page** collection when the station requires an existing browser login, and keep that station open and signed in in the current tab.
4. Save the station and choose **Refresh all** from the dashboard.
5. Review collected models, reference prices, matching status, estimated monthly cost, and recommendations.

The settings page also provides reference refresh, supported check-in settings, and JSON state import/export. Exported state excludes station secrets and API keys.

## Documentation

- [User guide](./docs/user-guide.md)
- [Development guide](./docs/development.md)
- [Architecture and data flow](./docs/architecture.md)
- [Extension-side plugin contract](./docs/plugin-development.md)
- Full docs site (VitePress): run `npm run docs:dev` in this repository, or read [`docs/`](./docs/) on GitHub
- [Plugin repository README](https://github.com/napstablook666/ai-price-analyzer-plugins/blob/main/README.md)
- [Plugin repository development guide](https://github.com/napstablook666/ai-price-analyzer-plugins/blob/main/DEVELOPMENT.md)

## Data and privacy

- The extension reads model and pricing data from configured station pages or endpoints.
- It may request the public OpenRouter model catalog at `https://openrouter.ai/api/v1/models` and the Bank of China exchange-rate page at `https://www.boc.cn/sourcedb/whpj/`.
- Settings and collected snapshots stay in the extension's local storage and IndexedDB.
- The project does not operate a server-side account or analytics service.
- Do not publish private API responses, cookies, authorization headers, account identifiers, or credentials in issues or pull requests.

See [PRIVACY.md](./PRIVACY.md) for the public data-handling statement and [SECURITY.md](./SECURITY.md) for vulnerability reports.

## Development

Clone both repositories when working on station plugins:

```bash
git clone https://github.com/napstablook666/ai-price-analyzer.git
cd ai-price-analyzer
git clone https://github.com/napstablook666/ai-price-analyzer-plugins.git plugins
```

Run commands from the extension repository root:

```bash
npm test
node scripts/plugin-build.mjs --check
node scripts/model-lookup.mjs claude 4.6
node canonical/build.mjs --offline
```

After changing a plugin source, run `node scripts/plugin-build.mjs`, then run the tests and reload this repository in Chromium. For an external plugin checkout, set `PLUGIN_DIR` to its path. Do not edit generated files under `src/site-plugins/` or `src/shared/plugin-order.js` by hand.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the pull request checklist.

## Releases

Releases are tag-driven. Keep the version in `package.json` and `manifest.json` synchronized, then push a tag such as `v0.2.1`. GitHub Actions publishes:

- `ai-relay-price-extension-v<version>.zip`: the loadable Chromium extension.
- `ai-price-analyzer-v<version>-source.zip`: source files plus the plugin snapshot used for the build.
- `SHA256SUMS.txt`: checksums for the published files.

## License

[GPL-3.0](./LICENSE)
