---
name: autoposter-brand-content-director
description: Enforce per-profile visual identity and personal brand for every Instagram post, story, carousel and Reel created through cloud APIs.
---
# Autoposter Brand Content Director

Use for **every** content creation job, before image/video API calls or cloud rendering. This is a production specification for an agent, not an activated API integration.

## Identity isolation
- Load the **selected profile ID** from the authenticated server-side context, never trust a client-provided ID without authorization.
- Load the matching profile's brand kit: brand type (PERSONAL or BUSINESS), approved logo and portrait assets, palette, typography, tone, audience, offer, banned claims, and example posts.
- Never mix brand assets, captions, API credentials or costs between profiles.
- **Fail closed** if no verified brand kit is available; request setup rather than inventing colours, logos, identity, portraits or endorsements.

## Visual system
- Business brand: approved primary/secondary/accent HEX colours, logo placement, approved fonts, consistent CTA and contrast.
- Personal brand: recognizable portrait **only if approved and licensed**, signature colours, authentic voice, personal point of view, consistent visual language. Do not fabricate photos of the account owner.
- Respect minimum text contrast, safe areas and accessibility. Treat AI-generated text in images as untrusted; compose headlines, prices and CTAs using deterministic text layers in the cloud.
- Match templates to the format, not vice versa. Keep visual consistency without repeating the same composition every time.

## Formats
- **Post 1080×1350**: one message, strong hook, recognizable visual, concise CTA.
- **Carousel 1080×1350**: coherent five-slide story: hook → problem → insight → solution → CTA. Same brand kit across all slides.
- **Story 1080×1920**: one clear idea, safe areas for Instagram UI, appropriate sticker space; interactive stickers may require platform-native capabilities.
- **Reel 1080×1920**: original licensed motion, narration and captions; cloud Remotion composition, approved colours/type, branded closing CTA. Apply the separate cloud video editor skill.

## Content strategy
- Read the profile's actual product/service and current editorial plan. Do not hardcode Autoposter's owner's offer into **other customers'** brands.
- For the user's web-design profile, only when confirmed by that profile's brand kit: sites at 99 EUR/month and a free initial mock-up.
- Use the same content pillar, target audience, offer and tone across a campaign, while varying angles and hooks.
- Produce Italian content by default for Italian profiles, honoring the stored locale.
- No unsupported revenue promises, false reviews or invented case studies.

## API and approval gates
1. Retrieve and validate brand kit, editorial brief and profile access.
2. Plan format and campaign; estimate all provider API costs in EUR with verified pricing and FX.
3. Reserve spend durably under the global **30 EUR monthly AI API cap**, including retries.
4. Generate licensed media through cloud APIs; compose brand-specific text and motion in a cloud worker.
5. Validate branding (palette, logo, font, tone), visual QA, factual claims, rights and output dimensions.
6. Store previews with brand kit version and provider provenance.
7. Require explicit approval before Instagram Graph API publishing. If the brand kit changes, invalidate outdated previews when necessary.
8. Reconcile actual costs and release unused reservations.

## Acceptance criteria
- Changing selected profile changes all branding and never leaks assets between tenants.
- Posts, all carousel slides, stories and Reels share the selected brand kit.
- Missing colours, logo permissions, approved portrait or verified provider quote blocks only the affected operation with a specific reason.
- No local rendering, no unapproved paid calls and no silent publishing.
