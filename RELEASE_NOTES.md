# AI Price Analyzer v0.2.1

This release packages the current Chromium MV3 extension, the reworked dashboard, and the two-repository plugin workflow.

## Highlights

- **One row per model.** Multiple official candidates that used to produce duplicate rows now collapse into a single row: the proxy side is counted once, the best-matching official entry drives the official price, diff, and monthly cost, and the remaining candidates are shown as `+N 候选`.
- **Price distribution chart.** A horizontal bar per station under every canonical model, normalized inside the group, with the official blended unit price drawn as a reference line. Clicking a bar filters by that station and model. Paid mode only; hidden on the public-station tab.
- **Batch plugin management.** The plugin registry and the installed list both support select-all, Shift range select, batch install, and batch uninstall. Uninstalling removes the stations attached to a plugin along with their credentials in one transaction.
- **Install adds stations.** Installing a plugin that ships default stations adds them to the workspace directly, so the extra "添加站点" click is only needed for URL-based and check-in plugins.
- **Settings navigation.** The settings page uses a two-level sidebar (installed / registry / costs / AI assistant / workspace), and the dashboard opens it on the installed view.
- **No toolbar popup.** Clicking the extension icon opens the price dashboard directly; an already-open tab is focused instead. The 折叠全部 / 展开全部 buttons merged into one toggle inside the new top-bar menu, which also hosts the daily check-in group.
- **Docs.** The guide now covers the price chart, batch plugin install, the renamed table columns, and the new entry points. `README.md` is Simplified Chinese with `README.en.md` alongside.

## Validation

- `npm test` passed for the extension test suite (`268` tests).
- `node scripts/plugin-build.mjs --check` passed for the generated plugin runtime files (23 plugins).
- `npm run docs:build` built the VitePress site.
- Extension entry points and the MV3 manifest were syntax-checked; `package.json` and `manifest.json` both report `0.2.1`.

## Privacy review

The public source was checked for common credential and private-key markers. Do not add credentials, cookies, private responses, or account-specific URLs to source files, fixtures, issues, or release assets.

## Assets

- `ai-relay-price-extension-v0.2.1.zip` — load-unpacked extension bundle.
- `ai-price-analyzer-v0.2.1-source.zip` — extension source with the plugin repository checked out at `plugins/`.
- `SHA256SUMS.txt` — checksums for both archives.