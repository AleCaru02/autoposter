// Catalog snapshot from Higgsfield model metadata, 2026-11-25. Not an API price quote.
export type SceneModel={id:string;name:string;description:string;durations:number[]|null;min:number|null;max:number|null;resolutions:string[];tags:string[]};
export const SCENE_CATALOG_DATE="2026-11-25";
export const SCENE_MODELS:SceneModel[]=[
  {
    "id": "cinematic_studio_3_0",
    "name": "Cinema Studio Video 3.0",
    "description": "Most advanced cinema-grade model",
    "durations": null,
    "min": 4,
    "max": 15,
    "resolutions": [
      "480p",
      "720p",
      "1080p",
      "4k"
    ],
    "tags": [
      "cinematic",
      "premium",
      "advanced",
      "sota",
      "film",
      "best-quality"
    ]
  },
  {
    "id": "cinematic_studio_video",
    "name": "Cinema Studio Video",
    "description": "Solid cinematic, dramatic compositions",
    "durations": [
      5,
      10
    ],
    "min": null,
    "max": null,
    "resolutions": [],
    "tags": [
      "cinematic",
      "dramatic",
      "compositions",
      "sound",
      "slow-motion"
    ]
  },
  {
    "id": "cinematic_studio_video_v2",
    "name": "Cinema Studio Video",
    "description": "Refined cinematic camera and color, genre control",
    "durations": null,
    "min": 3,
    "max": 12,
    "resolutions": [],
    "tags": [
      "cinematic",
      "camera",
      "color",
      "genre",
      "refined"
    ]
  },
  {
    "id": "marketing_studio_video",
    "name": "Marketing Studio",
    "description": "One-click product ads, TikTok/Reels ready",
    "durations": null,
    "min": 12,
    "max": 15,
    "resolutions": [
      "480p",
      "720p",
      "1080p"
    ],
    "tags": [
      "marketing",
      "ugc",
      "ads",
      "tiktok",
      "reels",
      "product",
      "social-media"
    ]
  },
  {
    "id": "flux_3_video",
    "name": "FLUX 3 Video",
    "description": "Text-to-video, multi-frame image-to-video, and video continuation with synchronized audio",
    "durations": null,
    "min": 5,
    "max": 20,
    "resolutions": [
      "720p",
      "1080p",
      "2k",
      "4k"
    ],
    "tags": [
      "text-to-video",
      "image-to-video",
      "video-continuation",
      "audio",
      "start-frame",
      "end-frame",
      "storyboard",
      "1080p",
      "2k",
      "4k"
    ]
  },
  {
    "id": "grok_video_v15_lite",
    "name": "Grok Imagine Video 1.5 Lite",
    "description": "Fast text and first-frame image-to-video generation, up to 1080p (upscaled)",
    "durations": null,
    "min": 1,
    "max": 15,
    "resolutions": [
      "480p",
      "720p",
      "1080p"
    ],
    "tags": [
      "audio",
      "fast",
      "lite",
      "text-to-video",
      "image-to-video",
      "start-frame"
    ]
  },
  {
    "id": "minimax_h3",
    "name": "MiniMax H3",
    "description": "Multimodal video generation with keyframes or image/video/audio references",
    "durations": null,
    "min": 4,
    "max": 15,
    "resolutions": [
      "2K"
    ],
    "tags": [
      "text-to-video",
      "image-to-video",
      "reference",
      "audio-reference",
      "video-reference",
      "start-frame",
      "end-frame",
      "2k"
    ]
  },
  {
    "id": "minimax_h3_max",
    "name": "MiniMax H3 Max",
    "description": "Fast text-to-video, keyframe, and multimodal-reference video generation",
    "durations": null,
    "min": 5,
    "max": 15,
    "resolutions": [
      "480p",
      "768p"
    ],
    "tags": [
      "text-to-video",
      "image-to-video",
      "reference",
      "video-reference",
      "audio-reference",
      "start-frame",
      "end-frame",
      "fast"
    ]
  },
  {
    "id": "wan2_6",
    "name": "Wan 2.6 Video",
    "description": "Open-weight, stylized, experimental creative",
    "durations": [
      5,
      10,
      15
    ],
    "min": null,
    "max": null,
    "resolutions": [],
    "tags": [
      "stylized",
      "experimental",
      "creative",
      "open-weight",
      "artistic"
    ]
  },
  {
    "id": "seedance_2_0",
    "name": "Seedance 2.0",
    "description": "Reference-driven video with image/video/audio reference inputs, consistent identity, multi-SKU; optional generate_audio for native audio",
    "durations": null,
    "min": 4,
    "max": 15,
    "resolutions": [
      "480p",
      "720p",
      "1080p",
      "4k"
    ],
    "tags": [
      "reference",
      "identity",
      "consistent",
      "product",
      "multi-sku",
      "e-commerce",
      "audio",
      "audio-reference",
      "video-reference",
      "start-frame",
      "end-frame",
      "4k",
      "high-resolution",
      "unlim"
    ]
  },
  {
    "id": "seedance_2_0_mini",
    "name": "Seedance 2.0 Mini",
    "description": "Fast budget Seedance 2.0 variant with image/video/audio reference inputs and native audio",
    "durations": null,
    "min": 4,
    "max": 15,
    "resolutions": [
      "480p",
      "720p"
    ],
    "tags": [
      "fast",
      "budget",
      "reference",
      "identity",
      "consistent",
      "audio",
      "audio-reference",
      "video-reference",
      "start-frame",
      "end-frame"
    ]
  },
  {
    "id": "seedance_2_5",
    "name": "Seedance 2.5",
    "description": "Seedance 2.5 text-to-video, multimodal omni-reference generation, video edit, and video extension",
    "durations": null,
    "min": 4,
    "max": 30,
    "resolutions": [
      "480p",
      "720p",
      "1080p",
      "4k"
    ],
    "tags": [
      "text-to-video",
      "reference",
      "identity",
      "audio-reference",
      "video-reference",
      "video-edit",
      "video-extension",
      "480p",
      "720p",
      "1080p",
      "unlim"
    ]
  },
  {
    "id": "seedance_2_5_flash",
    "name": "Seedance 2.5 Flash",
    "description": "Seedance 2.5 Flash video generation, editing, and extension",
    "durations": null,
    "min": 4,
    "max": 30,
    "resolutions": [
      "480p",
      "720p"
    ],
    "tags": [
      "text-to-video",
      "reference",
      "identity",
      "audio-reference",
      "video-reference",
      "video-edit",
      "video-extension",
      "480p",
      "720p"
    ]
  },
  {
    "id": "ad_multiplier",
    "name": "Ad Multiplier",
    "description": "Ad Multiplier video generation powered by Seedance 2.5",
    "durations": null,
    "min": 4,
    "max": 30,
    "resolutions": [
      "480p",
      "720p",
      "1080p"
    ],
    "tags": [
      "text-to-video",
      "reference",
      "identity",
      "audio-reference",
      "video-reference",
      "video-edit",
      "video-extension",
      "480p",
      "720p",
      "1080p"
    ]
  },
  {
    "id": "cinematic_studio_video_4_0",
    "name": "Cinema Studio 4.0",
    "description": "Cinema-grade video generation with automatic prompt direction and camera, lighting, pacing, genre, era, and color controls",
    "durations": null,
    "min": 4,
    "max": 30,
    "resolutions": [
      "480p",
      "720p",
      "1080p"
    ],
    "tags": [
      "cinematic",
      "director",
      "text-to-video",
      "reference",
      "audio-reference",
      "video-reference",
      "video-edit",
      "video-extension",
      "480p",
      "720p"
    ]
  },
  {
    "id": "kling2_6",
    "name": "Kling 2.6 Video",
    "description": "Cinematic motion, advanced physics",
    "durations": [
      5,
      10
    ],
    "min": null,
    "max": null,
    "resolutions": [],
    "tags": [
      "cinematic",
      "motion",
      "physics",
      "advanced",
      "audio"
    ]
  },
  {
    "id": "kling3_0",
    "name": "Kling v3.0",
    "description": "Multi-shot, audio sync, motion transfer",
    "durations": null,
    "min": 3,
    "max": 15,
    "resolutions": [],
    "tags": [
      "multi-shot",
      "audio",
      "motion-transfer",
      "cinematic",
      "advanced"
    ]
  },
  {
    "id": "kling3_0_turbo",
    "name": "Kling 3.0 Turbo",
    "description": "Fast text-to-video and single start-frame animation",
    "durations": null,
    "min": 3,
    "max": 15,
    "resolutions": [
      "720p",
      "1080p"
    ],
    "tags": [
      "fast",
      "turbo",
      "text-to-video",
      "image-to-video",
      "start-frame",
      "budget",
      "kling"
    ]
  },
  {
    "id": "kling4_0",
    "name": "Kling 4.0",
    "description": "Generate video from text, ordered keyframes, references, or edit an input video",
    "durations": null,
    "min": 3,
    "max": 30,
    "resolutions": [
      "720p",
      "1080p",
      "4k"
    ],
    "tags": [
      "text-to-video",
      "image-to-video",
      "reference-to-video",
      "video-edit",
      "keyframes"
    ]
  },
  {
    "id": "kling_4_0_flash",
    "name": "Kling 4.0 Flash",
    "description": "Fast 720p video from text, one first frame, references, or an input video",
    "durations": null,
    "min": 3,
    "max": 20,
    "resolutions": [
      "720p"
    ],
    "tags": [
      "fast",
      "text-to-video",
      "image-to-video",
      "reference-to-video",
      "video-edit"
    ]
  },
  {
    "id": "kling_o3_image_reference",
    "name": "Kling 3.0 Omni",
    "description": "Generate video from text and up to seven reference images",
    "durations": null,
    "min": 3,
    "max": 15,
    "resolutions": [],
    "tags": [
      "multi-shot",
      "audio",
      "4k"
    ]
  },
  {
    "id": "kling_o3_flf",
    "name": "Kling 3.0 Omni (Frames)",
    "description": "Generate video from text or a first frame and optional last frame",
    "durations": null,
    "min": 3,
    "max": 15,
    "resolutions": [],
    "tags": [
      "multi-shot",
      "audio",
      "4k"
    ]
  },
  {
    "id": "happy_horse_video",
    "name": "Happy Horse Video",
    "description": "Text-to-video and single start-frame animation",
    "durations": null,
    "min": 3,
    "max": 15,
    "resolutions": [
      "720p",
      "1080p"
    ],
    "tags": [
      "text-to-video",
      "image-to-video",
      "start-frame",
      "happy-horse"
    ]
  },
  {
    "id": "grok_video",
    "name": "Grok Video",
    "description": "Text and image-to-video, audio support",
    "durations": null,
    "min": 1,
    "max": 15,
    "resolutions": [],
    "tags": [
      "audio",
      "versatile",
      "text-to-video",
      "image-to-video"
    ]
  },
  {
    "id": "gemini_omni_flash_1_1",
    "name": "Gemini Omni Flash 1.1",
    "description": "Gemini Omni Flash 1.1 text-to-video, keyframe animation, multimodal reference generation, and video editing with native audio",
    "durations": null,
    "min": 3,
    "max": 10,
    "resolutions": [
      "360p",
      "720p",
      "1080p",
      "4k"
    ],
    "tags": [
      "audio",
      "text-to-video",
      "image-to-video",
      "reference",
      "video-edit",
      "360p",
      "720p",
      "1080p",
      "4k"
    ]
  },
  {
    "id": "gemini_omni_flash_1_2",
    "name": "Gemini Omni Flash 1.2",
    "description": "Gemini Omni Flash 1.2 video generation, keyframes, multimodal references, editing with reference images, and clip extension with native audio",
    "durations": null,
    "min": 3,
    "max": 15,
    "resolutions": [
      "360p",
      "720p",
      "1080p",
      "4k"
    ],
    "tags": [
      "audio",
      "text-to-video",
      "image-to-video",
      "reference",
      "video-edit",
      "360p",
      "720p",
      "1080p",
      "4k",
      "video-extend"
    ]
  },
  {
    "id": "magi_2",
    "name": "MAGI-2",
    "description": "MAGI-2 video with native audio from text, a first frame, first and last frames, or image, video and audio references",
    "durations": null,
    "min": 4,
    "max": 30,
    "resolutions": [
      "1080p"
    ],
    "tags": [
      "audio",
      "text-to-video",
      "image-to-video",
      "first-last-frame",
      "reference",
      "1080p"
    ]
  },
  {
    "id": "wan2_7",
    "name": "Wan 2.7",
    "description": "Synchronized audio, character-consistent video",
    "durations": null,
    "min": 2,
    "max": 15,
    "resolutions": [
      "720p",
      "1080p"
    ],
    "tags": [
      "audio",
      "character",
      "consistent",
      "sync",
      "sound"
    ]
  },
  {
    "id": "wan3_0",
    "name": "Wan 3.0",
    "description": "Wan 3.0 text-to-video, first/last frame video, and multimodal reference-to-video with native audio",
    "durations": null,
    "min": 1,
    "max": 30,
    "resolutions": [
      "480p",
      "720p",
      "1080p"
    ],
    "tags": [
      "text-to-video",
      "reference",
      "identity",
      "audio-reference",
      "video-reference",
      "first-last-frame",
      "sound",
      "thinking",
      "480p",
      "720p",
      "1080p"
    ]
  },
  {
    "id": "wan3_0_prime",
    "name": "Wan 3.0 Prime",
    "description": "Wan 3.0 Prime text-to-video, first/last frame video, and multimodal reference-to-video with native audio",
    "durations": null,
    "min": 1,
    "max": 30,
    "resolutions": [
      "480p",
      "720p",
      "1080p"
    ],
    "tags": [
      "text-to-video",
      "reference",
      "identity",
      "audio-reference",
      "video-reference",
      "first-last-frame",
      "sound",
      "thinking",
      "480p",
      "720p",
      "1080p",
      "prime"
    ]
  },
  {
    "id": "veo3_1",
    "name": "Google Veo 3.1",
    "description": "Ultra-realistic, top-tier cinematic quality",
    "durations": [
      4,
      6,
      8
    ],
    "min": null,
    "max": null,
    "resolutions": [],
    "tags": [
      "ultra-realistic",
      "cinematic",
      "top-tier",
      "quality",
      "audio"
    ]
  },
  {
    "id": "veo3_1_lite",
    "name": "Google Veo 3.1 Lite",
    "description": "Fast, affordable, budget batch clips",
    "durations": [
      4,
      6,
      8
    ],
    "min": null,
    "max": null,
    "resolutions": [],
    "tags": [
      "fast",
      "budget",
      "affordable",
      "batch",
      "lite"
    ]
  },
  {
    "id": "marketing_studio_v2_video",
    "name": "Marketing Studio Video",
    "description": "Marketing Studio V2 motion and UGC product videos, and the Product Link, Ad Reference and App video tools",
    "durations": null,
    "min": 4,
    "max": 30,
    "resolutions": [
      "480p",
      "720p",
      "1080p"
    ],
    "tags": [
      "marketing",
      "ugc",
      "ads",
      "product",
      "motion",
      "social-media"
    ]
  },
  {
    "id": "realtor_studio_video",
    "name": "Property Studio video",
    "description": "Property Studio walkthrough and close-up clips, made only in the Property Studio flow; not a general video model",
    "durations": null,
    "min": 4,
    "max": 30,
    "resolutions": [
      "480p",
      "720p",
      "1080p",
      "4k"
    ],
    "tags": [
      "text-to-video",
      "reference",
      "identity",
      "audio-reference",
      "video-reference",
      "video-edit",
      "video-extension",
      "480p",
      "720p",
      "1080p"
    ]
  }
];
export function durationOptions(m:SceneModel):number[]{
 if(m.durations?.length)return [...new Set(m.durations)].filter(n=>Number.isInteger(n)&&n>0).sort((a,b)=>a-b);
 if(m.min===null||m.max===null||!Number.isInteger(m.min)||!Number.isInteger(m.max)||m.min<1||m.max<m.min||m.max>120)return [];
 return Array.from({length:m.max-m.min+1},(_,i)=>m.min!+i);
}
export function compareCatalog(previous:SceneModel[],next:SceneModel[]){
 const old=new Map(previous.map(m=>[m.id,m]));const fresh=new Map(next.map(m=>[m.id,m]));
 const signature=(m:SceneModel)=>JSON.stringify([m.name,m.description,durationOptions(m),[...m.resolutions].sort(),[...m.tags].sort()]);
 return {added:next.filter(m=>!old.has(m.id)),removed:previous.filter(m=>!fresh.has(m.id)),changed:next.filter(m=>old.has(m.id)&&signature(old.get(m.id)!)!==signature(m))};
}
export function sceneEstimate(count:number,seconds:number,usdPerSecond:number|null,days=30):number|null{
 if(!Number.isInteger(count)||count<0||count>10||!Number.isInteger(seconds)||seconds<1||!Number.isInteger(days)||days<1||days>31||usdPerSecond===null||!Number.isFinite(usdPerSecond)||usdPerSecond<0)return null;
 return count*seconds*usdPerSecond*days;
}
export const SOCIAL_VIDEO_TARGETS=["INSTAGRAM","TIKTOK","FACEBOOK"] as const;
export type EditorialSeed={pillar:string;topic:string;reel:string;linkedin:string;proof:string};
const seed=(pillar:string,topic:string,reel:string,linkedin:string,proof:string):EditorialSeed=>({pillar,topic,reel,linkedin,proof});
export const EDITORIAL_SEEDS:EditorialSeed[]=[
 seed("Web","Un sito bello non basta","Mostra cosa rende facile contattare un'attività","Tre criteri per valutare un sito","Demo o esempio esplicitamente ipotetico"),
 seed("AI","Automatizzare una mansione","Spiega input, processo e risultato","Quando conviene automatizzare","Workflow autorizzato"),
 seed("Lifestyle","Una lezione da un viaggio","Racconta un episodio vero e la lezione","Collega l'esperienza a una decisione","Ricordo confermato e materiale autorizzato"),
 seed("Web","Prima e dopo","Mostra una trasformazione reale","Motiva tre scelte di design","Screenshot autorizzati"),
 seed("Impresa","Un problema ancora aperto","Spiega cosa non funziona e il prossimo test","Racconta l'approccio senza promettere risultati","Stato del progetto verificato"),
 seed("AI","AI contro lavoro manuale","Confronta due flussi","Spiega costi e limiti","Dati misurati o esempio dichiarato"),
 seed("Lifestyle","Obiettivi e priorità","Racconta una scelta personale confermata","Una riflessione sulla disciplina","Nota personale autorizzata"),
 seed("Web","Sito mobile","Mostra navigazione e contatto da smartphone","Checklist mobile per aziende","Demo autorizzata"),
 seed("AI","Dalla richiesta all'automazione","Mostra un trigger e un'azione","Spiega come evitare errori","Workflow autorizzato"),
 seed("Impresa","Imparare una competenza","Racconta cosa stai studiando","Metodo e risorse realmente usate","Fonte o nota confermata"),
 seed("Web","Prenotazioni online","Mostra il percorso del cliente","Benefici e limiti della prenotazione diretta","Demo o esempio dichiarato"),
 seed("Lifestyle","Una destinazione da esplorare","Spiega perché ti interessa","Riflessione su curiosità e organizzazione","Non presentare un viaggio futuro come avvenuto"),
 seed("AI","Controllo qualità","Mostra una verifica automatica","Perché un agente deve poter fermarsi","Test documentato"),
 seed("Impresa","Riepilogo settimana","Tre progressi verificati oppure una lezione","Bilancio senza metriche inventate","Attività datate"),
 seed("Web","Velocità e usabilità","Mostra come valutare una pagina","Spiega quali misure contano","Misurazione o checklist"),
 seed("AI","Memoria degli agenti","Spiega perché serve contesto","Memoria, privacy e coerenza","Architettura o demo"),
 seed("Lifestyle","Organizzare un viaggio","Mostra un metodo di pianificazione","Una lezione sulla gestione dei vincoli","Note autorizzate"),
 seed("Web","SEO senza promesse","Spiega un errore tecnico comune","Distinguere indicizzazione e posizionamento","Esempio verificabile"),
 seed("AI","Dai dati alle decisioni","Mostra un controllo su dati reali anonimizzati","Spiega come verificare una conclusione","Dati pubblicabili"),
 seed("Impresa","Un esperimento commerciale","Spiega ipotesi e test","Cosa si misura prima di scalare","Esperimento confermato"),
 seed("Web","Un progetto in corso","Mostra cosa è pronto e cosa manca","Scelte tecniche spiegate al cliente","Stato verificato"),
 seed("Lifestyle","Una lezione fuori dal lavoro","Racconta un interesse o episodio reale","Collega solo se naturale al percorso","Nota confermata"),
 seed("AI","Budget degli agenti","Mostra come limitare costi","Spiega limiti e compromessi","Tariffe aggiornate o esempi dichiarati"),
 seed("Web","Homepage che converte","Mostra gerarchia e CTA","Tre domande per un titolare","Demo"),
 seed("Impresa","Una decisione difficile","Racconta alternative e scelta","Spiega cosa hai imparato","Decisione confermata"),
 seed("AI","AI e autenticità","Spiega perché controlli i risultati","Come distinguere fatti e bozze","Processo documentato"),
 seed("Web","Automazioni per professionisti","Mostra una richiesta e una risposta","Un caso d'uso, senza promesse","Demo dichiarata"),
 seed("Lifestyle","Un obiettivo futuro","Racconta cosa vuoi costruire","Obiettivo e passi concreti","Obiettivo confermato"),
 seed("Servizi","Come posso aiutare un'attività","Mostra un problema e invita al confronto","Proposta chiara senza risultati inventati","Servizio realmente offerto"),
 seed("Impresa","Riepilogo mese","Racconta progressi e prossima priorità","Bilancio e domanda alla community","Cronologia verificata")
];
export function normalizeTopic(topic:string){return topic.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim()}
export function editorialDraft(recentTopics:string[],count=30){const used=new Set(recentTopics.map(normalizeTopic));return EDITORIAL_SEEDS.filter(s=>!used.has(normalizeTopic(s.topic))).slice(0,Math.max(0,Math.min(30,count))).map((s,i)=>({...s,day:i+1,status:"DRAFT_REQUIRES_EVIDENCE" as const,videoTargets:SOCIAL_VIDEO_TARGETS}));}
