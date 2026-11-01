---
name: premium-3d-web-experience
description: Build polished, performant, brand-specific interactive 3D websites with Three.js, React Three Fiber, Drei, GSAP ScrollTrigger, Spline, Motion, React/Next.js and Playwright. Select tools based on requirements rather than installing everything.
---
# Premium 3D Web Experience

## Purpose
A specialist companion to `premium-website-architect`. Use when the brief genuinely benefits from immersive 3D, scroll-driven storytelling, interactive products, or sophisticated motion. Do not confuse a skill (agent instructions) with installed packages or a deployed service.

## Audit first
- Inspect repository, AGENTS.md, existing skills, framework, package manager, brand kit, visual system and existing components before writing code.
- Reuse existing Three.js, R3F, Drei, GSAP, Spline, Motion, Playwright and Next.js dependencies where available. Never install conflicting frameworks or duplicate animation engines without justification.
- Confirm customer rights for logos, fonts, product models, images and reference designs. Never copy a third-party website verbatim.
- Establish audience, conversion goal, primary CTA, design references and mobile constraints.

## Tools and responsibilities
1. **Three.js**: low-level 3D scenes, physically based materials, lighting, cameras, postprocessing and optimized WebGL/WebGPU only when supported.
2. **React Three Fiber (@react-three/fiber)**: React scene graph, lifecycle, event handling, componentized 3D and frame management.
3. **Drei (@react-three/drei)**: vetted R3F helpers such as Environment, Html, useGLTF, Float, Bounds and controls; import only necessary helpers.
4. **GSAP + ScrollTrigger**: deliberate scroll-linked 3D choreography and complex timelines. Use gsap.context cleanup and avoid scroll hijacking.
5. **Spline**: optional authored scenes when licensed and suitable; evaluate embed weight, controls, fallback and account/API requirements. Never require manual Spline use when the requested workflow is code-only.
6. **Motion**: accessible UI microinteractions, page transitions and hover/focus states; avoid duplicating GSAP responsibility.
7. **React / Next.js**: semantic page structure, routing, server/client boundaries, metadata, images, responsive layouts and SEO. Follow the target repo's existing framework instead of forcing Next.js.
8. **Playwright**: automated screenshots and functional tests at mobile/tablet/desktop viewports; verify WebGL fallback and reduced-motion behavior.

## Implementation workflow
1. **Concept**: produce a concise art direction with a distinctive layout, design tokens, mobile-first wireframe, 3D interaction storyboard and measurable CTA.
2. **Base site**: build semantic, responsive, accessible HTML/CSS and conversion flow first. Brand palette and typography come from the verified brand kit.
3. **3D scene**: prefer small GLB/GLTF assets, compressed textures, realistic but restrained lighting, responsive camera, pointer/touch handling, and graceful fallback. Do not invent product-specific geometry when accurate models are required.
4. **Motion**: implement intentional GSAP/ScrollTrigger scene progress and Motion UI interactions. Respect `prefers-reduced-motion`; provide non-animated content and keyboard alternatives.
5. **Optimization**: lazy-load the 3D bundle, cap device pixel ratio, minimize draw calls and texture sizes, dispose GPU resources, pause offscreen animation and provide poster/static fallback for slow devices and no-WebGL contexts.
6. **QA**: test 320/375/390/768/1024/1440px layouts; keyboard navigation, contrast, links/forms, no overflow, scroll, interaction, performance and console errors. Take Playwright screenshots and visually inspect them.
7. **Delivery**: report changed files, dependencies and licensing, test commands and actual results, measured Lighthouse/Core Web Vitals if run, remaining issues, and deployment status. Do not assert success without execution.

## Guardrails
- A premium site is not defined by adding 3D everywhere. Use 3D only if it supports the business story and conversion.
- No paid assets, Spline plans, hosting upgrades, fonts or metered APIs without explicit approval.
- No automatic deployment, credential disclosure, fabricated testimonials, misleading claims or unlicensed models.
- Keep Core Web Vitals, accessibility, SEO and real mobile usability first.
- Fail transparently if rendering, screenshot testing or provider integrations cannot be verified.

## Acceptance checklist
- Consistent, brand-specific art direction with a clear primary CTA.
- Interactive 3D where appropriate; correct fallback on unsupported hardware.
- Smooth, purposeful motion; reduced-motion support; no broken mobile layout.
- Real Playwright visual/function checks and documented performance results.
- No unapproved spending and no claims of installed dependencies unless confirmed.
