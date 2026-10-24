# SevenAI Model Plaza Station Integration

## Goal

Add `https://sevenai.moe/model-plaza?embedded=1` as a selectable pricing station in the extension and collect its public model prices for comparison.

## Verified Site Behavior

- The page loads its catalog with `GET /api/v1/model-plaza?timezone=Asia%2FShanghai`.
- The endpoint returned HTTP 200 and `{ "code": 0, "message": "success", "data": { "description": "", "groups": [...] } }` when fetched with `credentials: "omit"`; no login or credential was required for the public catalog.
- The observed response contains 6 groups and 50 model entries. All observed models use `pricing.billing_mode: "token"`. Group rate is `rate_multiplier`; model prices are in `pricing`, and some models carry multiple `intervals` with `tier_label`, `min_tokens`, and `max_tokens`.
- Price values are USD per token in the API. The page labels displayed values as USD per 1M tokens and applies the group multiplier. For example, `grok-4.5` has input price `0.000002`, `GROK` has multiplier `0.12`, and the displayed `<200K` input price is `$0.24 / 1M tokens`.
- The page mentions login-only personal groups, which are not part of the anonymous response and are not covered here.
- The extension comparison contract treats station model-list rows as `CREDITS`, regardless of raw currency labels. The displayed USD label does not establish a recharge conversion rate.

## Requirements

- Recognize and prepare SevenAI model-plaza station URLs.
- Collect the public catalog with the verified GET endpoint and no credentials.
- Normalize observed token prices, all returned intervals, tier labels, group names, and `rate_multiplier` values using the existing model-plaza parsing path.
- Keep station comparison rows in the project's `CREDITS` unit and do not infer a verified recharge conversion from the USD price label.
- Register a selectable preset and backfill existing station lists idempotently without changing empty-list behavior.
- Keep the change isolated from other providers and preserve user station settings.
- Add regression coverage for registration, URL preparation, credential-free request behavior, normalization, and comparison of the verified response shape.

## Acceptance Criteria

- [ ] SevenAI appears as a selectable station and is backfilled once for existing station lists.
- [ ] The empty-list default and other providers' behavior remain unchanged.
- [ ] The supplied URL is prepared for the direct public API request; collection uses `GET /api/v1/model-plaza?timezone=Asia%2FShanghai` with credentials omitted and no authorization header.
- [ ] The observed token price intervals normalize with their tier labels, group names, price fields, and group multipliers.
- [ ] Comparison rows use `CREDITS`; no verified recharge conversion is configured from the USD label.
- [ ] Tests cover the observed API payload and the extension test suite passes.

## Out of Scope

- Changes to unrelated station providers or comparison behavior.
- Automated account creation, login, or collection of login-only personal groups.
- Non-token billing modes not present in the verified public response.

## Known Limitations

- SevenAI's actual recharge conversion remains unverified. Preserve the project's existing unconfirmed-rate behavior; do not claim that USD model prices establish a recharge rate.
- The public endpoint's login-only groups and their custom multipliers are not included.
