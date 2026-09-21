# Privacy and Public-Release Notes

This document describes the data handling relevant to the public source repository and the browser userscript.

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

The repository does not operate a server-side account or analytics service for this script. No API key is required by the script.

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

## Limitations

This is a technical repository statement, not legal advice. Browser extensions, userscript managers, visited sites, and network providers can have independent logging or telemetry outside this project's control.
