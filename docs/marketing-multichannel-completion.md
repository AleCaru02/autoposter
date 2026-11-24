# Marketing multicanale — piano di completamento (2026-11-24)

Production baseline checked via Vercel and read-only Neon queries: deployment READY at b46aeea; 17 publication jobs BLOCKED_APPROVAL, 25 QA PENDING and 2 FAIL, no QA PASS and no render jobs. 300 provider snapshots cover 25 Instagram and 5 Facebook remote posts. One active learning insight; scoring fix requires recomputation and validation. GBP expired and requires owner OAuth. Facebook, Instagram and LinkedIn are ACTIVE in DB; this is not proof of a successful write.

## Delivery gates
- Image quality: existing Media Manager, visual brief, deterministic typography and QA. Owner-reviewed brand-specific images with technical, editorial and identity QA PASS. Do not loosen thresholds to pass; compare candidate outputs at phone size. No paid calls in CI.
- Reel/avatars: use existing isolated reel-qa pipeline; synthetic render first, then owner-authorized paid provider A/B with consent and written spend cap; check output playback, identity and captions. No production render or automatic Reel pilot before evidence.
- Publishing: keep SAFE_MODE; require provider permissions and approved media; first controlled per-provider publication, remote ID and retrieval. GBP reconnect via user consent. Never bulk release 17 jobs.
- Learning: use actual post-level data, deduplicate, validate metric semantics and thresholds; require correctly recalculated insights and observable effect on future plan. No GBP location metrics as post-level learning.
- Ads creatives and Meta Ads: the initial Marketing workspace prepares structured briefs and a proposed budget only. Next: profile-scoped draft storage, metered AI generation, image QA, advertiser OAuth with minimum scopes and read-only campaign insights. Campaign creation paused by default; separate explicit budget and activation approval. No spend without user authorization.
- Marketing assistant: use existing profile context and budget engine; structured AI outputs with source evidence and tenant isolation, preview proposed changes; no privileged external tools by default.
- SEO/GEO: use verified site crawl and Search Console evidence, draft articles and structured source-backed FAQ, approval and diff before CMS publication, actual query/citation tracking. No invented rankings or citations.
- Email: metered drafts, consent/suppression list, unsubscribe and test send; provider integration only after owner confirmation. No bulk sends or contact imports by default.

Each phase requires CI PASS and isolated runtime evidence before production release. Brief workspace has no network, no persistence, no AI calls, no campaign activation or email sending. It is not equivalent to Holo's integrations yet.
