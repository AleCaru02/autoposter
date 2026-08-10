# Visual Pipeline

## Stato

Il visual workflow locale è progettato per funzionare a costo fisso aggiuntivo €0 e senza dipendere da provider esterni. La produzione locale usa Supabase Storage/Postgres, un renderer SVG deterministico, classifier/selector mock deterministici e `MockImageGenerationProvider` dietro interfacce sostituibili.

## Asset flow

```text
upload cliente
→ autenticazione + tenant membership
→ MIME / size / corruption validation
→ filename sanitization
→ SHA-256
→ dedup per tenant
→ Supabase Storage locale /brand-assets/{tenant_id}/assets/...
→ metadata `brand_assets`
→ deterministic classification
→ Asset Library / Brand Visual Settings
```

Il tenant non viene derivato dal payload dell'asset. Il local API riceve il tenant dalla route autenticata, verifica membership/role e genera server-side il path Storage.

Tipi supportati nel metadata model:

- logo / logo_alt
- product / service
- property / food
- team / person
- interior / exterior
- testimonial / screenshot
- document / brochure
- background / generic_photo
- generated_visual

Stati: `ACTIVE`, `ARCHIVED`, `BLOCKED`.

I documenti PDF/brochure vengono salvati con `index_status=pending`; il parsing semantico reale è intenzionalmente rinviato al futuro ingestion provider.

## Selection

`AssetSelectionEngine` riceve tenant, topic, pillar, platform, format, visual brief, asset disponibili e usage history.

Ordine decisionale:

1. asset reale molto pertinente;
2. asset reale adattabile;
3. branded graphic;
4. generated visual soltanto quando il brief richiede realmente una nuova immagine.

Il punteggio combina pertinenza semantica deterministica, asset type/settore, quality score, preferred/brand lock e penalità per utilizzi recenti. `BLOCKED` e `ARCHIVED` non entrano tra i candidati.

L'output persistito contiene decision, selected asset, motivation code, confidence e score.

## Repetition / anti-clone

`asset_usage_history` registra asset, platform, template, visual type e visual fingerprint.

Il fingerprint visuale include almeno:

```text
template
+ visual_type
+ asset
+ headline shape
+ background/palette
+ CTA placement profile
```

La scelta penalizza fotografie usate ripetutamente nella settimana e il Visual Director ruota template quando una combinazione recente è troppo simile.

Ogni tenant riceve inoltre un `visual_template_profile` deterministico e persistente: preferred templates, spacing, image ratio, text density, logo position, border style e CTA style. Questo evita un unico stile universale per tutti i clienti.

## Visual Director

Output strutturato:

- visual type;
- objective;
- selected asset IDs;
- headline;
- supporting text;
- layout/template;
- emphasis;
- brand elements;
- visual CTA;
- image prompt marker quando serve;
- accessibility notes.

Visual type supportati:

- real_photo
- photo_plus_overlay
- branded_card
- quote_card
- testimonial
- infographic
- promotional
- carousel
- generated_image
- no_visual come contratto supportato per i formati che lo consentiranno

## Template system

Famiglie parametriche:

1. Photo Full Bleed
2. Photo + Text Overlay
3. Split Layout
4. Minimal Brand Card
5. Quote/Testimonial
6. Educational Tip
7. Promotional
8. Statistic/Data
9. Service Highlight
10. Local/Google Business Profile

I template non definiscono una palette universale. Il renderer riceve palette, font, logo, fotografie, headline e CTA dal Brand Profile / Visual Template Profile.

## Renderer

`DeterministicGraphicRenderer` produce SVG localmente, senza SaaS esterno.

Preset centralizzati:

- square: 1080 × 1080
- portrait: 1080 × 1350
- landscape: 1200 × 630

Le immagini reali sono inserite come data URI nel render locale. Il logo viene renderizzato con `preserveAspectRatio="xMidYMid meet"`, quindi non viene stirato o tagliato dal renderer.

Gli SVG finali vengono caricati nel bucket privato `post-assets` e registrati in `visual_renders` con version, visual spec, QA result e fingerprint.

## Carousel

Il carousel dispone di una struttura per slide con:

- slide index;
- headline;
- body;
- layout;
- visual type.

Le tipologie locali supportate sono educational, checklist, mistakes, step-by-step, before/after concettuale, FAQ e tips. La pipeline genera cover, slide intermedie e CTA conclusiva e renderizza ogni slide come file persistente separato.

## Visual QA

Il renderer controlla almeno:

- headline troppo lunga;
- supporting text troppo lungo;
- CTA troppo lunga;
- contrast ratio insufficiente;
- claim visuali vietati/non verificati;
- dimensioni/preset;
- template repetition tramite fingerprint a monte.

Il quality score visuale persistito espone:

- brand_match;
- asset_relevance;
- layout_quality;
- readability;
- visual_novelty;
- platform_fit;
- text_density;
- template_repetition;
- passed.

## Selective repair

Il repair layer non deve rigenerare l'intero post.

```text
QA issue
→ affected component
→ repair action
→ component version
→ retest/render
```

Componenti versionabili:

- hook
- caption
- hashtags
- CTA
- visual
- fact claim

Esempi:

- hook fallisce → riscrive soltanto hook;
- caption troppo lunga → accorcia soltanto caption;
- CTA debole/lunga → modifica soltanto CTA;
- hashtag → normalizza/deduplica soltanto hashtag;
- visual overflow → accorcia solo testo visuale / corregge contrasto e rerenderizza;
- template repetition → ruota soltanto template;
- claim vietata → rimane blocker e non viene nascosta da un repair automatico.

`content_component_versions` mantiene versione, reason, repair action, current flag, author e timestamp.

## Fact-safe graphics

Il testo visuale passa lo stesso principio di fact safety del copy. `forbiddenClaims` dal Brand Profile vengono confrontati con headline/supporting text: un claim vietato produce un blocker `FORBIDDEN_FACT_CLAIM` e il render resta `qa_failed`.

## Image generation provider abstraction

Contratto:

```ts
interface ImageGenerationProvider {
  generate(...): Promise<ImageGenerationResult>
  edit(...): Promise<ImageGenerationResult>
  variation(...): Promise<ImageGenerationResult>
}
```

Implementazione locale: `MockImageGenerationProvider`.

Il mock produce un SVG deterministico e non esegue chiamate di rete. `ImagePromptBuilder` prepara già un input strutturato che include brand, visual brief, content, platform, style, forbidden elements, asset references e photographic direction.

La futura `OpenAIImageGenerationProvider` sostituirà il provider dietro la stessa interfaccia; non è presente alcuna API key o chiamata OpenAI in questa fase.

## Approval Center

Per ogni variante MANUALE il client può vedere il render persistito e agire su:

- APPROVA;
- MODIFICA TESTO;
- CAMBIA GRAFICA/template;
- RIGENERA GRAFICA;
- CAMBIA FOTO;
- RIFIUTA.

Le azioni aggiornano local API/Postgres e il rerender crea una nuova `render_version`, mantenendo auditabilità.

## Full local flow

```text
content concept
→ platform variant
→ visual brief
→ asset search
→ asset selection
→ visual type
→ template selection
→ SVG render / mock image fallback
→ visual QA
→ selective repair
→ visual fingerprint / anti-clone
→ persisted preview
→ approval
→ scheduler
→ publish mock
→ analytics / learning
```

## Future OpenAI integration

Prima del passaggio live serviranno:

1. implementazione concreta `OpenAIImageGenerationProvider`;
2. secret server-side nel futuro ambiente remoto;
3. real image moderation/safety handling;
4. eventuale Vision classifier al posto del deterministic classifier;
5. test cost/latency/provider errors;
6. mantenimento dello stesso DB/service boundary, senza dipendenze OpenAI nei componenti UI.
