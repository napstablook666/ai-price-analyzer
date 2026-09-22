# AI Price Analyzer

<p align="center"><strong>Compare AI gateway model prices against OpenRouter reference data directly in your browser.</strong></p>

<p align="center">
  <a href="./README.md">English</a> |
  <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/napstablook666/ai-price-analyzer/actions/workflows/ci.yml"><img src="https://github.com/napstablook666/ai-price-analyzer/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="https://github.com/napstablook666/ai-price-analyzer/releases"><img src="https://img.shields.io/github/v/release/napstablook666/ai-price-analyzer?style=flat-square" alt="Latest release"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-GPL--3.0-22C55E?style=flat-square" alt="GPL-3.0 license"></a>
</p>

AI Price Analyzer is a browser userscript for comparing model pricing exposed by supported AI gateway pages. It captures pricing data from the current page or the page's same-origin pricing endpoint, matches equivalent models, and estimates costs for a configurable workload.

## Highlights

| Capability | Why it matters |
|---|---|
| Page and endpoint capture | Analyze data already available in the current pricing page without maintaining a separate provider database. |
| OpenRouter reference data | Compare gateway prices with the OpenRouter model catalog when its public endpoint is reachable. |
| Matching rules | Start with exact model names and optionally enable suffix, version, or fuzzy matching. |
| Workload estimation | Enter requests and token volumes to compare estimated 24-hour or monthly cost. |
| Local persistence | Keep matching rules, layout position, and cached reference data in the browser's userscript storage. |

## Architecture

```text
+----------------------+     +----------------------+     +----------------------+
| Supported pricing    | --> | Userscript capture   | --> | Normalize model      |
| page or JSON endpoint|     | and page integration |     | names and price data |
+----------------------+     +----------------------+     +----------+-----------+
                                                                      |
                                                                      v
+----------------------+     +----------------------+     +----------------------+
| User workload and    | --> | Cost calculation and  | --> | Comparison table,    |
| exchange-rate inputs |     | matching rules       |     | recommendations      |
+----------------------+     +----------------------+     +----------------------+
                                                                      ^
                                                                      |
                                                        +-------------+-------------+
                                                        | OpenRouter model reference |
                                                        | and Bank of China FX data |
                                                        +---------------------------+
```

## Screenshots

The screenshots below are real outputs from this project.

<p align="center">
  <img src="./assets/tokenflux-pricing-analysis.png" width="720" alt="AI Price Analyzer comparing TokenFlux model pricing">
</p>


## Quick Install

1. Install a userscript manager such as [Tampermonkey](https://www.tampermonkey.net/) in a Chromium- or Firefox-based browser.
2. Download [`ai-price-analyzer.user.js`](https://github.com/napstablook666/ai-price-analyzer/releases/latest/download/ai-price-analyzer.user.js) from the latest GitHub release.
3. Open the downloaded file and confirm the userscript installation.

The repository source file is [`AI中转站价格分析工具.js`](./AI中转站价格分析工具.js). The release asset uses the ASCII filename `ai-price-analyzer.user.js` so the direct download URL works reliably across clients.

## Quick Start

1. Open a supported model, pricing, or rate page.
2. Click the floating `AI 价格分析` button.
3. If data is not captured automatically, paste a JSON payload into the proxy-data field and choose the matching data source.
4. Set the exchange rate and workload values if the defaults do not match your use case.
5. Click `开始计算` to view matched models, estimated cost, and recommendations.

The script is designed to work with pricing pages that expose recognizable model cards or a same-origin `/api/pricing` endpoint. The exact fields available depend on the page being analyzed.

## Supported page patterns

The userscript is intentionally limited to pricing-oriented paths rather than running on every website:

- `https://*/model*`
- `https://*/pricing*`
- `https://*/rate*`
- `https://compute.sinanlab.com/`
- `https://soleapi.com/zh/models*`
- `https://www.soleapi.com/zh/models*`

The script also recognizes the Jiji model-list page and the Sinan model plaza in its runtime logic. Site-specific page structures can change without notice; open an issue with a sanitized sample when a page stops working.

## Data sources and privacy

- The script reads pricing/model data from the active page and its same-origin pricing APIs.
- It may request the public OpenRouter model catalog at `https://openrouter.ai/api/v1/models`.
- It may request the Bank of China foreign-exchange page at `https://www.boc.cn/sourcedb/whpj/` for a reference rate.
- It stores settings and cached public reference data through the userscript manager's local storage APIs.
- It does not require an API key, and this repository does not include credentials.
- Do not paste private API responses, cookies, authorization headers, or account information into an issue or pull request.

See [`PRIVACY.md`](./PRIVACY.md) for the public-release privacy statement.

## Development

No build toolchain is required for the userscript source. Use Node.js for syntax checks and the included pricing self-check:

```bash
node --check "AI中转站价格分析工具.js"
node test-kbq-pricing.js
```

The GitHub Actions workflow runs the same checks and verifies that the release source contains no obvious private-key or credential markers.

## Release process

Releases are tag-driven. Push a semantic version tag such as `v0.1.0` to run the release workflow. It creates a source ZIP and a userscript asset, then publishes a GitHub Release with generated notes.

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow is defined in [`.github/workflows/release.yml`](./.github/workflows/release.yml). The `GITHUB_TOKEN` is used only by GitHub Actions to publish the release; no repository secret is needed for the default flow.

## Contributing

Issues and pull requests are welcome. Before submitting one:

- remove credentials and private URLs from examples and logs;
- run the Node.js checks above;
- describe the target page pattern and include only sanitized response structure;
- keep changes focused on the userscript or release automation.

## License

[GPL-3.0](./LICENSE)
