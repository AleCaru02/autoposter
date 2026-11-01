---
name: premium-website-architect
description: Design, implement, audit and refine premium conversion-focused websites with tasteful optional 3D, motion, mobile-first layouts, accessibility and SEO. Reuse existing project design systems and agent skills before introducing dependencies.
---
# Premium Website Architect

## First: audit, do not duplicate
Inspect the target repository's existing SKILL.md files, AGENTS.md, design system, components, CSS tokens, brand extraction and testing infrastructure. Reuse them; this skill coordinates rather than replaces specialist skills. Never claim a tool or skill is installed without checking. Respect existing customer site branding.

## Discover and design
1. Gather or extract a verified brand kit from the customer's website: logo, palette, fonts, imagery, tone, audience, offer and CTA. Confirm questionable inferences; never fabricate testimonials, customer photos, awards or performance metrics.
2. Define page goal and conversion event. Create a structured page outline and a distinctive art direction, not a generic AI template.
3. Implement a coherent system of typography, spacing, responsive grid, color contrast, components and interaction states. Favor professional visual hierarchy, whitespace, useful content and accessible navigation.
4. Mobile first: test at 320, 375, 390, 768, 1024 and 1440px. No overflow, tiny text, broken forms or off-screen CTAs.

## Recommended stack (choose only what is justified)
- React/Next.js or the site's existing framework; semantic HTML and modern CSS.
- Motion or GSAP/ScrollTrigger for deliberate animation; provide reduced-motion fallbacks.
- Three.js + React Three Fiber or Spline for **optional** 3D that reinforces the product or story. Use static or lightweight fallbacks for low-power devices.
- 21st.dev as an optional inspiration/component source; review license, accessibility, dependencies and code quality before use. Do not clone proprietary designs.
- Playwright for screenshots, navigation/form tests and cross-viewport visual review.
- Lighthouse/Core Web Vitals and standard SEO checks for performance and discoverability.

## 3D and animation constraints
- No 3D by default: add only when it strengthens clarity or differentiation and performs well on mobile.
- Defer loading heavy assets, compress models/textures, dispose WebGL resources and avoid scroll-jacking.
- Animate with restraint: purposeful hover feedback, section transitions, refined entrance effects. Never impair keyboard use, scrolling or reading.
- Honor prefers-reduced-motion, touch interactions and device capabilities.

## Conversion and production quality
- Clear value proposition above the fold, one primary CTA, visible proof only if verified, and short forms with meaningful validation.
- SEO: titles, descriptions, canonicals, sitemap, robots, Open Graph, structured data only when valid, proper heading hierarchy and alt text.
- Accessibility: semantic landmarks, visible focus, keyboard operation, labels, contrast and reduced-motion support.
- Performance: optimize image formats and sizes, lazy load below-the-fold media, avoid unnecessary JavaScript, measure LCP/CLS/INP.
- Privacy and compliance: do not add tracking, external fonts, cookies or third-party embeds without reviewing consent and licensing requirements. Prefer licensed free assets and self-hosted fonts where appropriate.
- No unapproved paid services, plugins or metered API calls.

## Delivery process
1. Audit existing site, brand kit and code; record baseline.
2. Build a single polished hero and core page system; obtain preview before expanding.
3. Implement remaining sections using reusable components and coherent design tokens.
4. Run typecheck, tests, Playwright screenshots on desktop/mobile, link/form checks, accessibility checks and performance audit.
5. Fix evidenced defects, review visuals again, and report measured results and outstanding issues.
6. Deploy only with permission; do not claim a site is live or tests passed unless verified.

## Acceptance gates
- Distinctive brand-appropriate visual design, not stock-template output.
- No horizontal overflow at mobile sizes; readable typography and usable CTA.
- Animations respect reduced motion; any 3D has a non-WebGL fallback.
- No fabricated business claims or unlicensed assets.
- No critical accessibility or functional regressions; measured performance and SEO results.
- A concise delivery report listing files changed, tests actually executed, screenshots and unresolved blockers.

## Scope
This is an agent skill, **not** a running site generator or installed 3D engine. The target application's orchestrator must load it and connect appropriate development tools before autonomous site production is possible.
