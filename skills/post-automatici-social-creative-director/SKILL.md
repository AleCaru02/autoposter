---
name: post-automatici-social-creative-director
description: Reusable social copy and visual creative direction for Post Automatici. Applied to every business profile before paid OpenAI Images 2 generation.
version: 1.0.0
---

# Post Automatici — Creative Director

## References adapted into this project's runtime
- [social-media-skills/skills: brand-profile](https://github.com/social-media-skills/skills/blob/main/skills/brand-profile/SKILL.md): every activity has its own verified brand, voice, evidence, palette, audience and forbidden claims.
- [hook-writer](https://github.com/social-media-skills/skills/blob/main/skills/hook-writer/SKILL.md): one truthful, specific promise supported by the full post, rather than clickbait.
- [caption-writer](https://github.com/social-media-skills/skills/blob/main/skills/caption-writer/SKILL.md): platform-native hook, useful body, one CTA; don't repeat the graphic.
- [image-prompt](https://github.com/social-media-skills/skills/blob/main/skills/image-prompt/SKILL.md): purpose -> meaning -> subject -> composition -> lighting -> palette -> constraints; don't use unrelated stock scenes.
- [social-post-designer](https://github.com/kmcdotninja/social-post-designer) (MIT): brand kit first, measured text fit, grid, mobile contrast, photo-led creative layout, collision checks, no giant blank bands; these principles are adapted to Post Automatici's existing SVG/Resvg renderer rather than bundling a separate frontend/editor.
- [design-and-templates](https://github.com/social-media-skills/skills/blob/main/skills/design-and-templates/SKILL.md): reusable brand kit, repeatable templates, one visual focus, mobile legibility and safe zones.
- [OpenAI Codex image prompting](https://github.com/openai/codex/blob/main/codex-rs/skills/src/assets/samples/imagegen/references/prompting.md): scene-first creative brief with concrete framing, no generic prompt-token spam and strict legible overlay constraints.

These sources provide guidance only; prompts are implemented in Post Automatici as original rules in `api/_lib/social-creative-direction.ts`. We do not connect any other image provider.

## Order for every profile and every format

1. Read the **current profile's** brand, website evidence, target, tone and restrictions; never mix data across tenants.
2. Choose a truthful **single central idea**. Write a specific hook; the caption must deliver on it and close with one CTA.
3. Select a visual role based on content: `ECONOMICS_CONTRAST`, `PROCESS_PROOF`, `EDITORIAL_HERO`, `CAROUSEL_STEP`, or `STORY_HERO`. These are layouts, not fixed generic objects.
4. Build a concrete subject-led prompt for OpenAI Images 2. Avoid keys, notebooks, computers, coffee, doors and generic apartments unless intrinsically necessary for the claim. No invented brand premises or employees.
5. Choose a **message-specific editorial design**: EDITORIAL_SPLIT for economic trade-offs (55% brand typography + 45% right-hand documentary photo), TOP_GRADIENT for process/carousels, or BOTTOM_GRADIENT for immersive stories. The layout is passed identically to the Media Manager, Images 2, geometry preflight and SVG renderer. All text remains deterministic. If the brief describes economic contrast but the Media Manager returns only a generic room or work scene without visual evidence of contrast, stop before the costly image request.
6. Typography is overlaid **deterministically** after OpenAI image generation. The gradient, safe area and baseline must fit measured text; never place a large milky card across the photo. `assertAutopilotGraphicBrief` requires a quoted headline (up to 62 characters) and detailed concept; `preflightDeterministicTypography` rejects long copy and geometry collisions before any provider spends.
7. Before paid Images 2 call, run `creativeConceptIssues` on the Media Manager result, enforcing topical evidence, right-hand focal placement, and a substantive art direction for EDITORIAL_SPLIT. This consumes at most the cheap text direction call on rejected concepts, not a full image. Then run visual/factual/editorial QA when an image exists. Save draft for user inspection; **never** self-approve or publish.

## Negative reference — the November 17 failed Facebook graphic

Unacceptable: a generic apartment, a notebook/keys foreground, a white transparent rectangle filling half the graphic, a short disconnected title at top, blank space under it. This is **not** a creative direction. Build a specific idea and use compact measured typography before requesting any more paid generation.

## Cost and release gate

- `AUTOPILOT_AI_ENABLED=false` in production until the new process passes deterministic tests **and** the owner authorizes a new paid canary.
- Reuse existing assets or mock fixtures for tests. Never silently rerun failed images in a paid loop.
- An OpenAI API call may happen only after budget, entitlement, media geometry and brand/layout preflight.
- QA PASS enables owner review, not publication. Global social auto-publishing stays disabled.
- Apply `problema → correzione → verifica → PASS → prossimo problema`, including iPhone preview.
