# AI Pipeline

## Pipeline locale

1. verifica utente/tenant/ruolo;
2. carica Brand Profile + lock + Visual Settings;
3. carica strategia/editorial memory;
4. seleziona topic/pillar dal calendario;
5. genera core concept;
6. genera varianti specifiche per piattaforma;
7. GBP decide `native_variant | separate_concept | skip`;
8. genera hook, caption, CTA, hashtag e visual brief;
9. anti-duplicate testuale;
10. salva concept/varianti/score;
11. cerca asset `ACTIVE` del tenant;
12. Asset Selection Engine decide real asset / branded graphic / generated visual;
13. Visual Director decide visual type e template;
14. renderer SVG locale o `MockImageGenerationProvider`;
15. visual QA + fact-safe graphics;
16. selective repair del solo componente fallito;
17. visual fingerprint + repetition/anti-clone;
18. salva render/versioni/usage/score;
19. applica AUTO/MANUALE per piattaforma;
20. scheduler idempotente;
21. publish mock con external ID;
22. analytics snapshot;
23. editorial memory + evidence-gated learning.

Il runtime è deterministico ma varia per tenant, topic/correlation, piattaforma, asset history e visual template profile.

## Asset classification / selection

Fino alla futura Vision AI, `DeterministicAssetClassifier` implementa l'interfaccia del classifier e produce tipo, tag, quality score, topic/platform compatibility.

`AssetSelectionEngine` riceve tenant, brand context, topic/pillar, piattaforma/formato, visual brief, asset e usage history.

Priorità:

1. asset reale altamente pertinente;
2. asset reale adattabile;
3. branded graphic;
4. visual generativo soltanto quando realmente utile.

Asset `BLOCKED`/`ARCHIVED` non sono candidati. Il riuso recente penalizza il punteggio per evitare la stessa foto continuamente.

## Visual Director

Visual type supportati dal contratto:

- `real_photo`;
- `photo_plus_overlay`;
- `branded_card`;
- `quote_card`;
- `testimonial`;
- `infographic`;
- `promotional`;
- `carousel`;
- `generated_image`;
- `no_visual` per futuri formati appropriati.

Output: objective, asset IDs, headline, supporting text, layout/template, emphasis, brand elements, visual CTA, image prompt marker e accessibility notes.

## Graphic Engine / templates

`DeterministicGraphicRenderer` produce SVG senza chiamate esterne. Palette, font e logo arrivano dal Brand Profile/Visual Settings.

Dieci famiglie template parametriche:

1. Photo Full Bleed;
2. Photo + Text Overlay;
3. Split Layout;
4. Minimal Brand Card;
5. Quote/Testimonial;
6. Educational Tip;
7. Promotional;
8. Statistic/Data;
9. Service Highlight;
10. Local/GBP.

Preset: square, portrait, landscape. Carousel: educational, checklist, mistakes, step-by-step, before/after concettuale, FAQ, tips.

## Visual anti-clone

Ogni tenant ha `visual_template_profile` con preferred templates, spacing, ratio, text density, logo position, border e CTA style.

Il fingerprint visuale combina template, visual type, asset, headline shape, background/palette e placement. Il motore usa `asset_usage_history` e render recenti per evitare combinazioni ripetitive.

Acceptance tests dedicati coprono tre Pizzerie e tre Property Manager con asset/fingerprint/profile/palette differenziati.

## Quality gate

Copy score:

- brandMatch;
- relevance;
- novelty;
- clarity;
- platformFit;
- visualFit;
- factConfidence;
- ctaQuality;
- duplicateRisk.

Visual quality persistita:

- brand_match;
- asset_relevance;
- layout_quality;
- readability;
- visual_novelty;
- platform_fit;
- text_density;
- template_repetition;
- passed.

Il renderer verifica headline/body/CTA troppo lunghi, contrasto insufficiente e forbidden fact claims.

## Selective QA repair

Il repair non rigenera il post intero.

```text
QA issue
→ affected_component
→ repair_action
→ new component version
→ retest / rerender
```

Supportato localmente:

- hook → riscrive soltanto hook;
- caption → accorcia soltanto caption;
- hashtag → normalizza/deduplica soltanto hashtag;
- CTA → riscrive/accorcia soltanto CTA;
- visual overflow → modifica soltanto testo/palette del visual e rerenderizza;
- template repetition → ruota soltanto template;
- fact claim vietata → resta blocker.

`content_component_versions` rende auditabile il prima/dopo.

## Fact-safe graphics

Il visual non può introdurre claim vietati dal Brand Profile. Un claim come “il miglior ristorante di Milano”, se presente nella forbidden list/non supportato, produce `FORBIDDEN_FACT_CLAIM` e il render resta `qa_failed`.

## Image generation abstraction

`ImageGenerationProvider` espone:

- `generate()`;
- `edit()`;
- `variation()`.

Implementazione corrente: `MockImageGenerationProvider`, che produce un SVG deterministico e non esegue chiamate di rete.

`ImagePromptBuilder` prepara brand, brief, content, platform, style, forbidden elements, asset references e photographic direction, impedendo per design loghi inventati, prodotti non verificati e false testimonianze.

La futura implementazione OpenAI sostituirà soltanto il provider, senza modificare UI/database/service boundary.

## Approval / publishing

MANUALE → Approval Center con preview visuale persistita e modifica copy/grafica/foto.

AUTO + QA verde → publication job indipendente.

Publishing resilience resta testata per timeout, rate limit, auth expired, validation/platform rejection e successful-publish + timeout reconciliation.

## Analytics / learning / cost control

Learning usa performance, approvazioni, rifiuti e modifiche utente con soglia minima di evidenza.

`ai_usage_events` registra anche operazioni visuali mock:

- asset classification;
- image generation;
- visual QA.

Il costo reale di queste operazioni locali è zero; il ledger resta pronto per simulazioni/prezzi futuri configurabili.

## Ancora live da collegare

Non sono attivi:

- OpenAI reale / Vision;
- image generation reale;
- web search AI live;
- social provider/OAuth reali;
- Telegram reale;
- document semantic ingestion reale.

Dettagli tecnici: `VISUAL_PIPELINE.md`.
