# Verification

## Automated checks

- `npm --prefix extension test`: 241 tests, 241 passed, 0 failed. Log: `out/ui-browser/workspace-tests.log`.
- `node --check` for every `extension/src/**/*.js`: passed. Log: `out/ui-browser/workspace-syntax.log`.
- `git diff --check`: passed. Log: `out/ui-browser/workspace-diff.log`.
- `createModelBands()` test verifies `[gpt-a, gpt-a, gpt-b, gpt-b, gpt-c]` maps to `[0, 0, 1, 1, 0]`.

## Browser evidence

Used the local static server and mock extension data with four offers across three canonical models, including two stations offering `gpt-4o`. Full result: `out/ui-browser/workspace-report.json`.

- 1440×900: table is **1108×601**, `scrollHeight=601`, `bodyOverflow=false`, `horizontalOverflow=false`, `errors=[]`.
- 1280×720: table is **938×411**, `bodyOverflow=false`, `horizontalOverflow=false`, `errors=[]`. Its 1040px content scrolls horizontally inside the table, not the page.
- 1100×800: stacked layout remains available; table is 1054×404.
- 360×800: card layout table is 314×385, with internal scrolling and no body or horizontal page overflow.
- Search, check-in, and page-size controls remain visible in every measured layout. The sidebar itself scrolls when its content exceeds available height.

## Color bands

Computed desktop rows:

- `gpt-4o-mini`: `model-band-even`, `rgb(255, 255, 255)`.
- `gpt-4o` at CentOS: `model-band-odd`, `rgb(244, 244, 245)`.
- `gpt-4o` at TokenFlux: `model-band-odd`, `rgb(244, 244, 245)`.
- `gpt-4.1`: `model-band-even`, `rgb(255, 255, 255)`.
- Hover uses `rgb(240, 240, 241)`.

Screenshots: `out/ui-browser/workspace-desktop.png`, `workspace-1280.png`, and `workspace-mobile.png`. Third-party Dark Reader mutations were removed only in the test pages, as in the previous UI verification.

## Layout correction

The first browser run exposed DOM auto-placement putting the aside in the wide track and the table in the 280px track. Explicit `grid-template-areas: "comparison sidebar"` and `height: 100%` fixed it. The final measurements above are after that correction.
