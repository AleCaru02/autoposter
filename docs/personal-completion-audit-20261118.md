# Personal completion audit — 2026-11-18

Production inspected: `f1ee2f9db2476ff6b24b29101ab57b797502dc86` (Vercel READY).
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

## Additional observed evidence

- Google linking now uses Google Identity Services plus Neon `linkSocial` with a verified ID token. The canonical JavaScript origin was saved in the matching Google OAuth client. The owner completed consent; `listAccounts` confirmed the Google provider, including after a full page reload. A separate subsequent Google sign-in has not been exercised.
- A clearly labeled QA activity was created through the authenticated UI without a website. Its dashboard showed zero reviews, scheduled posts and connected channels. Editing its name in Settings persisted across a full reload. Cleanup used the same reversible `archived_at` update as the archive API, constrained to the exact QA profile and owner after confirming zero contents, connections and publication jobs; a second database read confirmed it stayed archived. The browser confirmation part of the archive flow remains unverified because Computer Use stopped at the native dialog.
- The canonical health endpoint returned HTTP 200, `ready=true` and `database=postgres_ready`. PR #370 corrected the monitor's unreachable legacy target and manual image generation's use of the caption hook instead of the confirmed graphic headline. The full CI passed; the release was deployed READY. The previously failed images still need actual regeneration and QA.
- Production configuration confirms `REEL_ENGINE_ENABLED=true` and `AUTO_REEL_PILOT_ENABLED=false`. There are no render jobs. This proves configuration only, not generation, playback or provider success.
- Authenticated live dashboard inspection showed overdue jobs in the attention section and only future jobs in upcoming releases. Live review inspection showed the saved detailed visual rejection reason and a disabled Approva button for failed QA.

## Remaining live evidence

| Requirement | Evidence still required |
| --- | --- |
| Google account access | Owner linking and persistence verified; subsequent Google login remains unverified. |
| Password recovery | Actual delivered message and completed reset. |
| Independent profiles | Authenticated create/edit/reload and an empty isolated dashboard verified; switching back and the browser archive confirmation still need runtime verification. |
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
