# Privacy and Public-Release Notes

This document describes the data handling relevant to the public source repository, browser userscript, and Chromium extension.

## What the script reads

- Model names and pricing fields exposed by the active pricing page.
- Data returned by a same-origin pricing endpoint when the page exposes one.
- Public OpenRouter model metadata from `https://openrouter.ai/api/v1/models`.
- Public exchange-rate data from `https://www.boc.cn/sourcedb/whpj/` when the request succeeds.

## What the script stores

The userscript manager's local storage may contain:

- cached public OpenRouter model data;
- matching-rule preferences;
- the floating button position;
- values entered into the analysis form while the page is open.

The repository does not operate a server-side account or analytics service. The userscript requires no API key; the Chromium extension uses separately configured providers for optional on-demand model actions.

## What is not included in this repository

Do not commit or publish:

- API keys, access tokens, cookies, authorization headers, or session exports;
- private pricing responses or account-specific URLs;
- screenshots containing account identifiers or private data;
- local editor, operating-system, or machine-specific files.

Before opening an issue or pull request, replace private response values with a small sanitized structure or a synthetic example.

## Network permissions

The userscript declares only the following cross-origin request permissions:

- `openrouter.ai` for the public model catalog;
- `www.boc.cn` for the public exchange-rate page.

Page data is read in the context of the site where the userscript is installed. A site may have its own privacy policy and terms; review those policies before using the script there.


## Chromium extension JEV actions

JEV analysis is user-initiated and runs only after a dashboard action. Collection and scheduled refreshes do not call JEV.

- Model matching sends the proxy model name and up to 40 public OpenRouter candidates (IDs, names, providers, and aliases). A suggestion is applied only after the user confirms it.
- Comparison review sends the proxy and official model names plus derived flags such as price-gap direction, available price fields, freshness, estimated fields, tier/group effects, and match confidence. Exact prices, station names or URLs, raw API responses, cookies, and station credentials are excluded.
- Analysis uses only the active JEV profile key; if that profile has no key, the request fails rather than falling back to legacy or LLM credentials. The configured provider receives the submitted data and may retain it under its own privacy policy.
- Confirmed model mappings are stored in the extension's local settings and included in state exports; unconfirmed JEV results remain in the open dashboard only.

## Chromium extension station check-in

Check-in is user-initiated from the dashboard or popup; the optional auto check-in alarm only runs for stations where the user enabled it. The request is sent directly to the station's own daily-reward API with the station's existing browser cookies (or a token the user configured), so the station receives the request as if it came from the user's own browser. Check-in records (timestamps, streak, last result) stay in the extension's local storage and are not sent anywhere.
## Limitations

This is a technical repository statement, not legal advice. Browser extensions, userscript managers, visited sites, and network providers can have independent logging or telemetry outside this project's control.
