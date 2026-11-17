<p align="center">
  <img src="./icons/icon.svg" width="96" height="96" alt="AI Price Analyzer">
</p>
<h1 align="center">AI Price Analyzer</h1>

<p align="center">Compare AI gateway model prices side by side in your browser: collect once, align by model identity, price it with your own usage.</p>

<p align="center">
  <a href="./README.md">简体中文</a> |
  <a href="./README.en.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/napstablook666/ai-price-analyzer/actions/workflows/ci.yml"><img src="https://github.com/napstablook666/ai-price-analyzer/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="https://github.com/napstablook666/ai-price-analyzer/releases"><img src="https://img.shields.io/github/v/release/napstablook666/ai-price-analyzer?style=flat-square" alt="Latest release"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-GPL--3.0-22C55E?style=flat-square" alt="GPL-3.0 license"></a>
  <a href="https://napstablook666.github.io/ai-price-analyzer/"><img src="https://img.shields.io/badge/docs-%E5%9C%A8%E7%BA%BF-4F46E5?style=flat-square" alt="Documentation"></a>
</p>

The same model appears under a dozen names across relay stations, and each station bills top-ups, group multipliers, and cache reads differently, so comparing prices by hand is slow and error-prone. AI Price Analyzer is a Chromium Manifest V3 extension. It collects prices from the stations you add, collapses station-specific names into one canonical model identity, then uses your own usage to compute a monthly cost and a gap against the official price. There is no backend and no bundler; the repository root is the loadable extension.

## Highlights

| Highlight | Why it matters |
| --- | --- |
| One collection rule per station | Station knowledge lives in `<id>/` directories in the plugin repository, so adding a station never touches the extension core. |
| Model identity before price | Canonical table, plugin aliases, and manual overrides resolve in three layers, so `GLM-5.3`, `z-ai/glm-5.3`, and `glm-5.3:thinking` land on one row. |
| Direct and page collection | Collect CORS-enabled JSON endpoints directly, or reuse the current browser session when a station needs a login. |
| Costed with your usage | Input, cache read, cache write, and output are priced separately and rolled into monthly cost and blended unit price. |
| Data stays local | Snapshots live in IndexedDB and station credentials in extension local storage; requests go only to stations you added and two public reference sources. |
| Generated files under test | `node:test` covers core, collection, matching, and generated plugin files; drift turns red. |

## Architecture

```text
┌──────────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
│ site-plugin          │──▶│ provider-registry    │──▶│ adapters             │
└──────────────────────┘   └──────────────────────┘   └───────────┬──────────┘
                                                                  │ snapshot
                                                                  ▼
┌──────────────────────┐                              ┌───────────▼──────────┐
│ openrouter + boc     │─────────────────────────────▶│ matching             │
└──────────────────────┘                              └───────────┬──────────┘
                                                                  │
                                                                  ▼
                                                      ┌───────────▼──────────┐
                                                      │ pricing              │
                                                      └───────────┬──────────┘
                                                                  │
                                                                  ▼
                                                      ┌───────────▼──────────┐
                                                      │ dashboard            │
                                                      └──────────────────────┘
```

- `src/site-plugins/providers/<id>.js`: one collection rule per station, generated from the plugin repository.
- `src/core/provider-registry.js`: request strategies for direct requests, page auth, and cookie sessions.
- `src/core/adapters.js`: parses responses by `responseFormat` into one snapshot per station.
- `src/core/matching.js`: maps station model names to canonical model IDs, reading reference data and the canonical table.
- `src/core/pricing.js`: turns snapshots, reference prices, and your usage into comparison rows.
- `src/service-worker.js`: message entry points, with `REFRESH_ALL` / `REFRESH_STATION` for collection, `FETCH_REFERENCES` for reference prices, `GET_DASHBOARD` for comparison data, and `ADAPT_STATION` for station detection.

## Install

| Item | Requirement |
| --- | --- |
| Browser | Chrome, Edge, or any Chromium-based browser with Manifest V3 |
| Extension version | `0.6.0` (see `manifest.json`) |
| Node.js | Development and tests only, Node 20 or newer |
| Permissions | `storage`, `scripting`, `tabs`, `alarms`, `cookies`, `declarativeNetRequest`, and `<all_urls>` host permission |

`<all_urls>` is intentional: station domains come from plugins, so adding a station does not require a new permission grant. Page scripts are injected only into stations you added.

Install from a release:

1. Open [Releases](https://github.com/napstablook666/ai-price-analyzer/releases) and download `ai-relay-price-extension-v<version>.zip`.
2. Extract it to a stable directory, not a temporary or auto-cleaned folder.
3. Make sure `manifest.json` is **directly** inside that directory. An extra nesting level is the most common load failure.
4. Open `chrome://extensions` (or `edge://extensions`) and enable **Developer mode**.
5. Choose **Load unpacked** and select the directory from step 3.

Install from source:

```bash
git clone https://github.com/napstablook666/ai-price-analyzer.git
cd ai-price-analyzer
```

Then load that directory itself in the browser. To change station collection logic, also check out the plugin repository; see [Repositories](#repositories).

## Quick Start

1. Click the toolbar icon to open the comparison dashboard, and use the gear in its top bar for station and settings.
2. Add a station: enter the station URL and choose analyze, and the extension probes the pricing endpoints and page structure and fills in what it found. Alternatively install a site plugin from the plugin registry first, then add the station from the installed list.
3. Confirm the configuration: collection mode, endpoint path, request method, authentication mode, and top-up ratio. Save the proposed values on the first run; tune them once collection works.
4. Choose refresh all. Stations that need a login go through a login pre-check that sorts them into already signed in, needs sign-in, needs manual confirmation, and no login needed; sign in and retry as prompted.
5. Read the table: each row is one station, group, and model offer, sorted by blended unit price, with a monthly-cost bar for the same model at the bottom of the cell.
6. Open the cost estimation settings, pick a usage preset or enter your own input and output volume, and monthly cost and price gap recalculate.

After one round the dashboard should show a table with reference prices, match confidence, and monthly cost. See the [documentation site](https://napstablook666.github.io/ai-price-analyzer/) for a walkthrough of every part.

## Commands

Run these from the repository root:

| Command | Purpose |
| --- | --- |
| `npm test` | Full test suite; it must stay green |
| `node scripts/plugin-build.mjs` | Regenerate `src/site-plugins/` after changing plugin sources |
| `node scripts/plugin-build.mjs --check` | Check generated files for drift only |
| `node scripts/model-lookup.mjs <model name>` | Look up a canonical model ID, for example `claude 4.6` |
| `node canonical/build.mjs --offline` | Rebuild the canonical model table from cache |
| `npm run version:check` | Verify `package.json` and `manifest.json` versions match |
| `npm run docs:dev` | Preview the documentation site locally |

## Documentation

| Task | Where to look |
| --- | --- |
| Install, load, and common pitfalls | [docs/guide/install.md](./docs/guide/install.md) |
| Adding stations and field-by-field reference | [docs/configuration/station-fields.md](./docs/configuration/station-fields.md) |
| Reading the comparison table | [docs/guide/dashboard.md](./docs/guide/dashboard.md) |
| Tuning the cost model | [docs/guide/cost.md](./docs/guide/cost.md) |
| Login state, tokens, and check-in | [docs/guide/session.md](./docs/guide/session.md), [docs/guide/checkin.md](./docs/guide/checkin.md) |
| Writing a site plugin | [docs/plugin-development.md](./docs/plugin-development.md) |
| Architecture and data flow | [docs/architecture.md](./docs/architecture.md) |
| Troubleshooting | [docs/troubleshooting.md](./docs/troubleshooting.md), [docs/faq.md](./docs/faq.md) |
| Full manuals | [docs/user-guide.md](./docs/user-guide.md), [docs/development.md](./docs/development.md) |
| Documentation site | <https://napstablook666.github.io/ai-price-analyzer/> |

## Repositories

The project is split into two public repositories:

- **Extension repository** (this one): MV3 pages, service worker, collection and matching core, generated plugin runtime files, tests, and documentation.
- **Plugin repository**: [ai-price-analyzer-plugins](https://github.com/napstablook666/ai-price-analyzer-plugins), the single hand-written source for station adapters, one directory per station.

For plugin development, check the plugin repository out as a `plugins/` directory next to this repository:

```bash
git clone https://github.com/napstablook666/ai-price-analyzer.git
cd ai-price-analyzer
git clone https://github.com/napstablook666/ai-price-analyzer-plugins.git plugins
```

The builder generates `src/site-plugins/providers/<id>.js`, `src/site-plugins/catalog.js`, and `src/shared/plugin-order.js` from `plugins/<id>/`. Generated files are committed here so a release checkout loads directly. Regenerate them after plugin source changes; never edit them by hand. Point `PLUGIN_DIR` at the plugin repository when it lives elsewhere.

## Data sources and privacy

- Model and price data come from the stations you configure, through their pages or endpoints.
- There are exactly two public reference sources: the OpenRouter model catalog at `https://openrouter.ai/api/v1/models` and the Bank of China exchange rates at `https://www.boc.cn/sourcedb/whpj/`.
- Settings and collection snapshots stay in extension local storage and IndexedDB. The project runs no server-side account or analytics service.
- Do not paste private API responses, cookies, authorization headers, account identifiers, or credentials into issues or pull requests.

See [PRIVACY.md](./PRIVACY.md) for details and [SECURITY.md](./SECURITY.md) for vulnerability reporting.

## Disclaimer

The extension produces estimates. Treat every price and conclusion as a reference only; the station's own invoice is authoritative.

- Prices come from the pricing page or endpoint your station served at collection time. After the station changes prices, group multipliers, or billing rules, an old snapshot stays stale.
- Monthly cost, blended unit price, and price difference all rest on the monthly usage you enter under "Preferences & cost". Your real invoice will not match, and the numbers only make sense as a comparison on one ruler.
- Cells marked `≈`, "estimated", "derived price", or "currency unverified" carry the largest error. Do not treat them as a quote.
- The extension does not reconcile invoices, place orders, or speak for any station. Decisions about topping up or purchasing based on these numbers are yours to carry.

Full text: [docs/disclaimer.md](./docs/disclaimer.md).

## Release

Git tags trigger releases. Sync the version with `npm run version:patch` (or `minor` / `major`), then push a tag such as `v0.6.0`. `package.json`, `manifest.json`, and the tag name must agree; bump the hardcoded version in README and `docs/` in the same pass. GitHub Actions publishes three files:

- `ai-relay-price-extension-v<version>.zip`: the loadable Chromium extension.
- `ai-price-analyzer-v<version>-source.zip`: the source and plugin snapshot used for the build.
- `SHA256SUMS.txt`: checksums for both archives.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the change flow, pre-submit checks, and code conventions. For station plugin work, also read [DEVELOPMENT.md](https://github.com/napstablook666/ai-price-analyzer-plugins/blob/main/DEVELOPMENT.md) in the plugin repository.

## License

[GPL-3.0](./LICENSE)