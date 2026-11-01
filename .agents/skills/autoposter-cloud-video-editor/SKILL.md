---
name: autoposter-cloud-video-editor
description: Produce premium Instagram Reels from approved AI video, voice, and brand assets using Remotion in a cloud worker; fail closed on missing API assets, commercial rights, budget, and human approval.
---
# Autoposter Cloud Video Editor

## Scope
Use this skill when building or reviewing the **cloud** video production pipeline for Autoposter. Do not render on the customer's device, require local installation, or treat a skill as a generation API. The skill is instructions for a coding agent; production requires deployed services.

## Reference
Consult the official `remotion-dev/skills` `remotion-best-practices` before writing Remotion compositions. Pin reviewed versions of Remotion, its renderer, and any installed skills. Never execute unreviewed remote scripts in production.

## Workflow
1. Read brand profile and editorial brief; create an Italian 9:16 storyboard with a 2-second hook, clear benefit, and CTA: **Siti web da 99 €/mese, bozza gratuita**. Do not invent customer testimonials or performance results.
2. Fetch provider API quote and verified account balance. Reserve the worst-case EUR spend durably against a **global 30 EUR/month cap** across image, video, voice and retries. If pricing, FX rate, available credits, reservation or billing identity is unknown, **stop**.
3. Generate short AI motion clips via a licensed video API. Store media in private cloud object storage with provenance, license and job IDs. Use approved stills only as a minority of footage. Never substitute static slideshow footage silently.
4. Generate Italian narration via an authorized TTS API; obtain word timings from the TTS provider or alignment API. Do not invent subtitle timestamps.
5. Compose with Remotion on a **cloud worker**: 1080×1920, 30fps, readable safe-area captions, animated but restrained typography, timed cuts, branded CTA, properly licensed music. FFmpeg may be used **inside the cloud worker** for muxing and verification.
6. Render an MP4 (H.264/AAC) and probe output. Validate 9:16, duration, audio, subtitle legibility, frame integrity and safe margins. Inspect AI artifacts and reject incorrect text, warped UI, watermarks and unlicensed elements.
7. Reconcile actual provider costs, release unused reservations, and retain a durable audit log. Failed attempts also count when providers bill for them.
8. Create a preview in `AWAITING_APPROVAL`. Publish through Instagram's authorized API **only after explicit user approval** and platform eligibility checks. No auto-publishing while the pipeline is unverified.

## Strict gates
- No external paid API call without a current quote, sufficient credits, a successful **database-backed** budget reservation and authorization.
- No credentials in prompts, git, screenshots, logs or generated media.
- No browser automation pretending to be Instagram API.
- No unverified claims of test passes, deployments or finished videos.
- On any failure, return a specific blocker; never bypass the gate or charge again automatically.
- Monthly plan is adaptive: post, carousel, story and Reel counts must be recalculated using measured API costs. The 30 EUR cap is a maximum, not a promise that all requested assets can be produced.

## Acceptance tests
- 30-second pilot from licensed motion assets with Italian voice and synchronized captions.
- Automated probe of 1080×1920, 30fps, audio, timeline and safe areas.
- Explicit approval required before any publish request.
- Insufficient credits, unverified price, exhausted budget and missing provider keys fail closed.
- Cloud CI renders a synthetic fixture **without paid API calls**, then runs FFprobe and asserts output.
