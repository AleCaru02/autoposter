/** Deterministic personal video editorial calendar; no external calls. */
export type EditorialPillar = "EDUCATION" | "AUDIT" | "DEMO" | "OFFER";
export type EditorialSlot = { day: number; pillar: EditorialPillar; headline: string; hook: string; cta: string; status: "IDEA"; requiresEvidence: boolean };
export type EditorialCalendar = { profileId: string; timezone: "Europe/Rome"; days: 30; slots: EditorialSlot[] };
const themes: Array<[EditorialPillar,string,string]> = [
  ["EDUCATION","Tre errori che rendono difficile contattare un'azienda","Il tuo sito rende semplice chiedere un preventivo?"],
  ["AUDIT","Come riconoscere una pagina web poco chiara","In dieci secondi riesci a capire cosa offre questa azienda?"],
  ["DEMO","Prima e dopo: una homepage più leggibile","Guarda come cambia una pagina con una struttura migliore"],
  ["EDUCATION","Perché il sito deve funzionare bene da telefono","Quanti visitatori guardano il tuo sito da smartphone?"],
  ["DEMO","Un modulo contatti semplice e utilizzabile","Ecco come rendere più facile una richiesta di informazioni"],
  ["AUDIT","Cinque controlli per una scheda Google e il sito","I tuoi contatti trovano informazioni coerenti?"],
  ["OFFER","Bozza gratuita di un sito web professionale","Vuoi vedere una proposta prima di decidere?"],
  ["EDUCATION","Cosa misurare su un sito web","Le visite non bastano: conta anche cosa fanno le persone"],
  ["DEMO","Come funziona una piccola automazione commerciale","Una richiesta arriva: ecco come organizzarla"],
  ["OFFER","Come funziona il servizio siti web a 99 euro al mese","Ti spiego cosa comprende e cosa va verificato nel contratto"]
];
export function buildPersonalEditorialCalendar(profileId:string, count=12): EditorialCalendar {
  if(!profileId.trim() || !Number.isInteger(count) || count<1 || count>15) throw new Error("INVALID_EDITORIAL_REQUEST");
  const slots:EditorialSlot[]=[];
  for(let i=0;i<count;i++){
    const [pillar,headline,hook]=themes[i%themes.length];
    slots.push({day:1+Math.floor(i*29/Math.max(1,count-1)),pillar,headline,hook,
      cta:pillar==="OFFER"?"Richiedi una bozza gratuita":"Scrivimi per valutare il tuo sito",status:"IDEA",requiresEvidence:true});
  }
  return {profileId:profileId.trim(),timezone:"Europe/Rome",days:30,slots};
}
