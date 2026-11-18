# Personal completion audit — 2026-11-18

Candidate: `effde1f55f194ade3ff88654050418883d8baad5` (production Vercel).
Overall completion: **NOT CERTIFIED**. Test results below do not replace live workflow verification.

## Reproducible regression evidence

Executed from the isolated checkout with `npm.cmd run <script>`; all 25 passed:

`test:auth-security`, `test:auth-proxy`, `test:auth-session-race`,
`test:profile-isolation`, `test:personal-brand-profile`, `test:crawler`,
`test:site-intelligence`, `test:fase7a-editable-brand`,
`test:fase7c-content-generation`, `test:fase7d-content-review`,
`test:fase7e-calendar-mutations`, `test:fase7f-publication-engine`,
`test:fase7h-analytics-engine`, `test:fase7i-learning-runtime`,
`test:fase7j-settings-account`, `test:asset-library`, `test:carousel-content`,
`test:reel-render`, `test:reel-pipeline`, `test:reel-length-audio`,
`test:approval-workflow-v2`, `test:scheduling-certification`,
`test:cron-24x7-certification`, `test:provider-analytics-certification`,
`test:mobile-desktop-ui-qa`.

Browser command (requires installed Playwright Chromium):

```powershell
$env:UI_SMOKE_BASE='https://post-automatici-canonical.vercel.app'
$env:UI_SMOKE_START_LOCAL='0'
node tests/mobile-desktop-ui-browser.mjs
```

Result: `MOBILE_DESKTOP_UI_BROWSER_QA = PASS` at 1440×900, 1280×720,
390×844 and 360×800. API responses are test fixtures; writes are intercepted.
Checks cover navigation, dashboard, editorial plan, approvals, calendar, social,
analytics, profiles, contained overflow, social error recovery and login validation.
This is Chromium viewport coverage, not a physical iPhone/Safari certification.

## Remaining live evidence

| Requirement | Evidence still required |
| --- | --- |
| Google account access | Successful owner linking and subsequent Google login; prior attempt returned `state_mismatch`. Explicit error callbacks deployed; root cause not proven resolved. |
| Password recovery | Actual delivered message and completed reset. |
| Independent profiles | Authenticated create/edit/switch flows and data isolation checks against real persisted state. |
| Brand and site | Persisted edits and page-by-page scan results verified in UI. |
| Text and OpenAI Images | Owner-reviewed generated result, persisted quota/cost and asset record. |
| Review and calendar | Edit, review, approval, schedule/reschedule and reload persistence in authenticated UI. |
| Social channels | Per-profile current credentials, permissions and provider readiness; presence of environment variables alone is insufficient. |
| Metrics and learning | Provider-derived rows, visible provenance, correct per-profile calculations and actual sample thresholds. |
| Library and Reel | Authenticated upload/read/playback and completed render with technical QA. |
| Mobile | Chromium dashboard/editorial screenshots inspected at 390px; actual Safari/iPhone behavior remains unverified. |
| Meta publishing | Project rules require SAFE_MODE on and no real Meta writes; cannot certify live publishing while this invariant applies. |

## Dependency audit scope

`npm audit` reports vulnerable transitive Better Auth packages bundled with the
installed Neon client. The app uses hosted Neon Auth, not a locally hosted
Better Auth server. Neon configuration reports `magic_link.enabled=false`.
The critical advisory GHSA-965c-763c-88jm requires Magic Link plus other server
settings; applicability to this deployment is not established by the package
inventory. Hosted server patch status remains outside this local package audit.
Other high-severity dependency findings require individual compatibility and
reachability assessment; no forced major upgrades were applied.
