import type { SocialPlatform } from '@socialpilot/contracts';

export interface StrategyPlannerInput {
  tenantId: string;
  brandName: string;
  industry: string;
  subIndustry?: string | undefined;
  location?: string | undefined;
  goals: string[];
  target: string[];
  services: string[];
  differentiators: string[];
  selectedPlatforms: SocialPlatform[];
  postsPerWeek: number;
  preferredDays?: number[] | undefined;
  preferredTimes?: string[] | undefined;
  editorialMemoryTopics?: string[] | undefined;
  competitorThemes?: string[] | undefined;
}

export interface StrategyPillarPlan {
  key: string;
  name: string;
  share: number;
  objective: string;
  formats: string[];
  platforms: SocialPlatform[];
  topicSeeds: string[];
}

export interface PlannedContentStrategy {
  objectives: string[];
  audience: string[];
  pillars: StrategyPillarPlan[];
  ctaStrategy: string[];
  avoidThemes: string[];
  scheduling: { postsPerWeek: number; preferredDays: number[]; preferredTimes: string[] };
}

export interface CalendarSlot {
  index: number;
  scheduledAt: string;
  platform: SocialPlatform;
  pillarKey: string;
  topic: string;
  objective: string;
  format: string;
  status: 'idea';
}

const normalize = (value: string): string => value.toLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu, '');

const sectorProfile = (industry: string, subIndustry = '') => {
  const text = normalize(`${industry} ${subIndustry}`);
  if (/pizz|ristor|food|restaurant/.test(text)) return {
    pillars: [
      ['prodotto', 'Prodotto e ingredienti', 'Aumentare desiderabilità e qualità percepita', ['hero_product','behind_the_scenes']],
      ['territorio', 'Territorio e comunità', 'Rafforzare rilevanza locale e relazione', ['local_story','community']],
      ['prova', 'Esperienza cliente', 'Ridurre rischio percepito con prova sociale e servizio', ['testimonial','faq']],
      ['conversione', 'Prenotazione e occasioni', 'Convertire intenzione in visita o prenotazione', ['offer','event']],
    ] as const,
    seeds: ['impasto','ingredienti','forno','abbinamenti','quartiere','esperienza al tavolo','prenotazione','specialità'],
  };
  if (/property|immobil|affitt|vacanze|short.?term/.test(text)) return {
    pillars: [
      ['educazione', 'Educazione proprietari', 'Spiegare decisioni economiche e operative', ['carousel','checklist']],
      ['metodo', 'Metodo di gestione', 'Dimostrare processo, controllo e professionalità', ['process','case_study']],
      ['mercato', 'Mercato e performance', 'Aiutare a leggere domanda, prezzi e stagionalità', ['analysis','insight']],
      ['lead', 'Valutazione immobile', 'Generare richieste qualificate', ['lead_magnet','local_post']],
    ] as const,
    seeds: ['occupazione','prezzo dinamico','check-in','recensioni','costi','ROI','portali','valutazione immobile'],
  };
  if (/network|networker|direct.?selling|mlm/.test(text)) return {
    pillars: [
      ['personal', 'Personal brand', 'Costruire fiducia sulla persona e sul metodo', ['story','point_of_view']],
      ['educazione', 'Educazione e competenze', 'Trasferire conoscenze utili senza promesse facili', ['carousel','how_to']],
      ['community', 'Community', 'Stimolare conversazioni e appartenenza', ['question','community_story']],
      ['opportunita', 'Opportunità spiegata', 'Qualificare interesse con trasparenza', ['faq','conversation_cta']],
    ] as const,
    seeds: ['routine','competenze','relazioni','obiettivi','community','formazione','domande frequenti','percorso'],
  };
  return {
    pillars: [
      ['educazione', 'Educazione cliente', 'Chiarire problemi, criteri e decisioni', ['carousel','faq']],
      ['autorevolezza', 'Metodo e autorevolezza', 'Mostrare competenza e processo', ['process','case_study']],
      ['locale', 'Presenza locale', 'Rendere visibile la rilevanza sul territorio', ['local_story','google_update']],
      ['conversione', 'Servizi e conversione', 'Portare utenti qualificati al contatto', ['service','cta_post']],
    ] as const,
    seeds: ['servizio','metodo','domande frequenti','territorio','risultati osservabili','team','processo','contatto'],
  };
};

const unique = <T>(values: T[]): T[] => [...new Set(values)];

export class DeterministicStrategyPlannerMock {
  plan(input: StrategyPlannerInput): PlannedContentStrategy {
    if (!input.tenantId.trim() || !input.brandName.trim()) throw new Error('strategy_context_required');
    const industry = input.industry.trim() || 'Attività locale';
    if (!Number.isInteger(input.postsPerWeek) || input.postsPerWeek < 1 || input.postsPerWeek > 14) throw new Error('strategy_invalid_frequency');
    if (input.selectedPlatforms.length === 0) throw new Error('strategy_platform_required');
    const profile = sectorProfile(industry, input.subIndustry);
    const serviceSeeds = input.services.map((service) => service.trim()).filter(Boolean);
    const goalSeeds = input.goals.map((goal) => goal.trim()).filter(Boolean);
    const excluded = new Set((input.editorialMemoryTopics ?? []).map(normalize));
    const topicPool = unique([...serviceSeeds, ...profile.seeds, ...goalSeeds, ...(input.competitorThemes ?? [])]).filter((topic) => !excluded.has(normalize(topic)));
    const baseShares = [35, 25, 20, 20];
    const pillars = profile.pillars.map(([key, name, objective, formats], index): StrategyPillarPlan => ({
      key, name, share: baseShares[index] ?? 25, objective, formats: [...formats],
      platforms: input.selectedPlatforms.filter((platform) => platform !== 'google_business_profile' || key === 'locale' || key === 'conversione' || key === 'territorio' || key === 'lead'),
      topicSeeds: topicPool.filter((_, topicIndex) => topicIndex % profile.pillars.length === index).slice(0, 5),
    }));
    const localGoal = input.goals.some((goal) => /visit|prenot|lead|vend|traff|locale/i.test(goal));
    const ctaStrategy = unique([...(input.goals.includes('educazione') ? ['Salva o condividi il contenuto'] : []), ...(localGoal ? ['Contatta o prenota con un invito specifico e verificabile'] : []), 'Usa CTA coerenti con il livello di intenzione, senza promesse non dimostrate']);
    return { objectives: [...input.goals], audience: [...input.target], pillars, ctaStrategy, avoidThemes: ['promesse garantite', 'claim non verificati', 'ripetizioni recenti'], scheduling: { postsPerWeek: input.postsPerWeek, preferredDays: input.preferredDays?.length ? [...input.preferredDays] : [1, 3, 5], preferredTimes: input.preferredTimes?.length ? [...input.preferredTimes] : ['10:00'] } };
  }

  buildCalendar(input: { strategy: PlannedContentStrategy; startDate: string; weeks: number }): CalendarSlot[] {
    const start = new Date(input.startDate);
    if (!Number.isFinite(start.getTime()) || !Number.isInteger(input.weeks) || input.weeks < 1 || input.weeks > 12) throw new Error('calendar_invalid_input');
    const total = input.strategy.scheduling.postsPerWeek * input.weeks;
    const activePillars = input.strategy.pillars.filter((pillar) => pillar.platforms.length > 0);
    if (activePillars.length === 0) throw new Error('calendar_no_active_pillars');
    const slots: CalendarSlot[] = [];
    for (let index = 0; index < total; index += 1) {
      const week = Math.floor(index / input.strategy.scheduling.postsPerWeek);
      const withinWeek = index % input.strategy.scheduling.postsPerWeek;
      const day = input.strategy.scheduling.preferredDays[withinWeek % input.strategy.scheduling.preferredDays.length] ?? 1;
      const time = input.strategy.scheduling.preferredTimes[withinWeek % input.strategy.scheduling.preferredTimes.length] ?? '10:00';
      const monday = new Date(start);
      const startDay = monday.getUTCDay() || 7;
      monday.setUTCDate(monday.getUTCDate() - startDay + 1 + week * 7 + (day - 1));
      const [hourText = '10', minuteText = '00'] = time.split(':');
      monday.setUTCHours(Number(hourText), Number(minuteText), 0, 0);
      const pillar = activePillars[index % activePillars.length]!;
      const platform = pillar.platforms[index % pillar.platforms.length]!;
      const topic = pillar.topicSeeds[index % Math.max(1, pillar.topicSeeds.length)] ?? `${pillar.name} ${index + 1}`;
      slots.push({ index, scheduledAt: monday.toISOString(), platform, pillarKey: pillar.key, topic, objective: pillar.objective, format: pillar.formats[index % pillar.formats.length] ?? 'single_image', status: 'idea' });
    }
    return slots;
  }
}
