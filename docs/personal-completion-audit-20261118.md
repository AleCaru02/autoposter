# Personal completion audit — 2026-11-18

Production inspected: `c1d00158d82f807c0140d94164c1a49c19038f14` (Vercel READY).
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
The same suite also passed with `UI_QA_BROWSER=webkit`; mobile contexts use the
Playwright iPhone 13 device settings. The gate now runs WebKit with fixtures on
every PR. This is browser/device emulation, not physical iPhone certification.
## Isolated live API workflow evidence
The opt-in runner `tests/personal-isolated-api.mjs` targets only the existing
`reel-qa` deployment and its separate Neon project. It first requires health to
confirm `targetEnv=reel-qa` and `isolatedNeon=true`. It creates a disposable
identity, keeps credentials in memory, and reversibly archives its profile in
`finally`. It does not run automatically in CI or publish to social providers.

From a checkout already linked to the canonical Vercel project, with an
authenticated Vercel CLI and native curl installed:
```powershell
$env:PERSONAL_QA_ALLOW_TEST_WRITES='true'
$env:PERSONAL_QA_WORKFLOWS='true'
$env:PERSONAL_QA_ASSETS='true'
$env:PERSONAL_QA_REEL_DRY_RUN='true'
node tests/personal-isolated-api.mjs
```
Observed complete run: process exit 0 and all enabled checks PASS:
- Email signup, session persistence and JWT issuance.
- First-profile provisioning and idempotent replay, onboarding completion,
  profile edit/read persistence, and denial of access to an existing foreign profile.
- Brand description, additional context and tone persistence.
- Disabled LinkedIn calendar frequency save/update without duplicates,
  timezone validation, persistence, and foreign-profile write denial.
- PNG upload to actual Blob storage, profile-scoped deduplication, listing,
  preview byte equality, and reuse on a draft with approval and QA still pending.
- Review text persistence, change request, and rejection of a stale edit (409).
  A separate administrative read confirmed the corresponding `WRONG_TONE`
  feedback event. The feedback table is server-only, so the customer API test
  does not attempt to read it.
- Reel input validation, idempotent enqueue, real queue/render/Blob completion,
  `READY_FOR_REVIEW`, output draft guards, and MP4 download/signature validation.
  Artifact: 22.2 seconds, 546500 bytes, provider cost USD 0. The dry-run uses
  synthetic media and does not prove paid AI image, voice or avatar availability.
- Reversible profile archive and verification that it leaves active-profile queries.

This run exposed a real first-profile failure for accounts without package
defaults. PR #372 restored the commercial package fallback in the eight-argument
provisioning function. Its SQL regression covers a fresh account, an explicit
package default, idempotent replay, operation conflict and server-only execution.
The migration was applied to QA and production; the live QA repro now passes.

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
| Brand and site | Brand API persistence verified; authenticated owner UI edits and page-by-page scan results still need completion. |
| Text and OpenAI Images | Owner-reviewed generated result, persisted quota/cost and asset record. |
| Review and calendar | Edit, review, approval, schedule/reschedule and reload persistence in authenticated UI. |
| Social channels | Per-profile current credentials, permissions and provider readiness; presence of environment variables alone is insufficient. |
| Metrics and learning | Provider-derived rows, visible provenance, correct per-profile calculations and actual sample thresholds. |
| Library and Reel | Live isolated upload, preview, reuse and technical dry-run render verified; paid AI media and authenticated in-page video playback remain unverified. |
| Mobile | Chromium and WebKit suites pass at desktop/mobile sizes with fixture APIs; physical iPhone behavior remains unverified. |
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
