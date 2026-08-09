export type Platform = 'Instagram' | 'Facebook' | 'LinkedIn' | 'Google Business Profile';
export type PostState = 'Idea' | 'Draft' | 'In approvazione' | 'Programmato' | 'Pubblicato' | 'Da rivedere';

export interface DemoPost {
  id: string;
  date: string;
  title: string;
  platform: Platform;
  state: PostState;
  decision: 'native_variant' | 'separate_concept' | 'skip';
}

export const demoPosts: DemoPost[] = [
  { id: 'p1', date: '10 Ago', title: 'Come scegliere il servizio giusto', platform: 'Instagram', state: 'Programmato', decision: 'native_variant' },
  { id: 'p2', date: '10 Ago', title: 'Tre criteri per una decisione più consapevole', platform: 'Facebook', state: 'In approvazione', decision: 'native_variant' },
  { id: 'p3', date: '11 Ago', title: 'Processo, misurazione e qualità del servizio', platform: 'LinkedIn', state: 'Draft', decision: 'separate_concept' },
  { id: 'p4', date: '11 Ago', title: 'Consulenza disponibile a Milano', platform: 'Google Business Profile', state: 'Programmato', decision: 'native_variant' },
  { id: 'p5', date: '12 Ago', title: 'Dietro le quinte del metodo', platform: 'Instagram', state: 'Idea', decision: 'native_variant' },
  { id: 'p6', date: '13 Ago', title: 'Domande frequenti dei clienti', platform: 'Facebook', state: 'Da rivedere', decision: 'native_variant' },
  { id: 'p7', date: '14 Ago', title: 'Cosa misurare dopo 30 giorni', platform: 'LinkedIn', state: 'Pubblicato', decision: 'native_variant' },
  { id: 'p8', date: '15 Ago', title: 'Aggiornamento locale della settimana', platform: 'Google Business Profile', state: 'Idea', decision: 'separate_concept' },
];

export const navigation = [
  ['Panoramica', '/app'],
  ['Onboarding', '/onboarding'],
  ['Brand Profile', '/app/brand'],
  ['Asset Library', '/app/assets'],
  ['Strategia', '/app/strategy'],
  ['Calendario', '/app/calendar'],
  ['Approvazioni', '/app/approvals'],
  ['Connessioni social', '/app/connections'],
  ['Analytics', '/app/analytics'],
  ['Notifiche', '/app/notifications'],
  ['Supporto', '/app/support'],
  ['Piano e quote', '/app/billing'],
  ['Impostazioni', '/app/settings'],
  ['Admin', '/admin'],
] as const;

export const brandSections = [
  ['Identità', 'Demo Studio Milano', 'Confermato'],
  ['Settore', 'Servizi professionali', 'Confermato'],
  ['Target', 'PMI e professionisti nell’area di Milano', 'Inferito'],
  ['Tone of voice', 'Chiaro, concreto, competente, senza iperboli', 'Confermato'],
  ['Proposta di valore', 'Analisi trasparente e piano operativo misurabile', 'Confermato'],
  ['CTA preferita', 'Prenota una consulenza conoscitiva', 'Confermato'],
  ['Claim vietati', 'Risultati garantiti; migliore in assoluto', 'Bloccato'],
  ['Palette', '#0F766E · #F5F7F6 · #17201E', 'Confermato'],
] as const;

export const connectionRows = [
  ['Instagram', 'Connesso', '@demo.studio', '2 min fa'],
  ['Facebook', 'Connesso', 'Demo Studio', '2 min fa'],
  ['LinkedIn', 'Da riconnettere', 'Demo Studio Srl', '3 giorni fa'],
  ['Google Business Profile', 'Connesso', 'Milano Centro', '10 min fa'],
] as const;
