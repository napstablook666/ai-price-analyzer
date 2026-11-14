# Privacy and Public-Release Notes

This document describes the data handling of the AI Price Analyzer Chromium extension and its public source repository.

## What the extension reads

- Model names and pricing fields exposed by a configured station page or endpoint.
- Data returned by a configured same-origin or cross-origin pricing endpoint when the station permits it.
- Public OpenRouter model metadata from `https://openrouter.ai/api/v1/models`.
- Public exchange-rate data from `https://www.boc.cn/sourcedb/whpj/` when the request succeeds.
- The current browser page, cookies, or configured station credential only when the user selects a page-based collection or an optional station workflow that needs it.

## What the extension stores

- Station configuration and collection settings in extension local storage.
- Collected pricing snapshots and comparison state in IndexedDB.
- Optional station credentials in the browser extension storage area selected by the extension.
- Cached public reference data and matching preferences.

The project does not operate a server-side account or analytics service. Collected data and credentials are not uploaded to an AI Price Analyzer server.

## What is not included in this repository

Do not commit or publish:

- API keys, access tokens, cookies, authorization headers, or session exports;
- private pricing responses or account-specific URLs;
- screenshots containing account identifiers or private data;
- local editor, operating-system, machine-specific, or browser-profile files.

Before opening an issue or pull request, replace private response values with a small sanitized structure or a synthetic example.

## Network permissions

The extension declares broad page access because station URLs and page-bridge collection are user-configured. The extension may contact the configured station, OpenRouter, and the Bank of China public exchange-rate page. A station may have its own privacy policy and terms; review those policies before using it.

## Station check-in

Check-in is user-initiated from the dashboard or popup; the optional auto check-in alarm only runs for stations where the user enabled it. The request is sent to the station's own daily-reward API with the station's existing browser cookies or a credential the user configured. Check-in records stay in extension local storage and are not sent to an AI Price Analyzer server.

## Limitations

This is a technical repository statement, not legal advice. Browser extensions, visited sites, network providers, and station operators may have independent logging or telemetry outside this project's control.
