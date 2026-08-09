import type {
  AnalyticsView,
  AssetView,
  BrandFieldView,
  ConnectionState,
  EditorialPost,
  NotificationView,
  SaasRepository,
  SaasSnapshot,
  SocialConnectionView,
  UsageView,
} from './domain';

const clone = <T>(value: T): T => structuredClone(value);

const initialPosts: EditorialPost[] = [
  { id: 'p1', date: '10 Ago', title: 'Come scegliere il servizio giusto', platform: 'Instagram', state: 'Programmato', decision: 'native_variant' },
  { id: 'p2', date: '10 Ago', title: 'Tre criteri per una decisione più consapevole', platform: 'Facebook', state: 'In approvazione', decision: 'native_variant' },
  { id: 'p3', date: '11 Ago', title: 'Processo, misurazione e qualità del servizio', platform: 'LinkedIn', state: 'Draft', decision: 'separate_concept' },
  { id: 'p4', date: '11 Ago', title: 'Consulenza disponibile a Milano', platform: 'Google Business Profile', state: 'Programmato', decision: 'native_variant' },
  { id: 'p5', date: '12 Ago', title: 'Dietro le quinte del metodo', platform: 'Instagram', state: 'Idea', decision: 'native_variant' },
  { id: 'p6', date: '13 Ago', title: 'Domande frequenti dei clienti', platform: 'Facebook', state: 'Da rivedere', decision: 'native_variant' },
  { id: 'p7', date: '14 Ago', title: 'Cosa misurare dopo 30 giorni', platform: 'LinkedIn', state: 'Pubblicato', decision: 'native_variant' },
  { id: 'p8', date: '15 Ago', title: 'Aggiornamento locale della settimana', platform: 'Google Business Profile', state: 'Idea', decision: 'separate_concept' },
];

const initialBrandFields: BrandFieldView[] = [
  { key: 'identity', label: 'Identità', value: 'Demo Studio Milano', status: 'Confermato', locked: true },
  { key: 'industry', label: 'Settore', value: 'Servizi professionali', status: 'Confermato', locked: false },
  { key: 'target', label: 'Target', value: 'PMI e professionisti nell’area di Milano', status: 'Inferito', locked: false },
  { key: 'voice', label: 'Tone of voice', value: 'Chiaro, concreto, competente, senza iperboli', status: 'Confermato', locked: true },
  { key: 'value', label: 'Proposta di valore', value: 'Analisi trasparente e piano operativo misurabile', status: 'Confermato', locked: false },
  { key: 'cta', label: 'CTA preferita', value: 'Prenota una consulenza conoscitiva', status: 'Confermato', locked: false },
  { key: 'claims', label: 'Claim vietati', value: 'Risultati garantiti; migliore in assoluto', status: 'Bloccato', locked: true },
  { key: 'palette', label: 'Palette', value: '#0F766E · #F5F7F6 · #17201E', status: 'Confermato', locked: true },
];

const initialConnections: SocialConnectionView[] = [
  { id: 'ig', platform: 'Instagram', status: 'Connesso', account: '@demo.studio', lastCheck: '2 min fa' },
  { id: 'fb', platform: 'Facebook', status: 'Connesso', account: 'Demo Studio', lastCheck: '2 min fa' },
  { id: 'li', platform: 'LinkedIn', status: 'Da riconnettere', account: 'Demo Studio Srl', lastCheck: '3 giorni fa' },
  { id: 'gbp', platform: 'Google Business Profile', status: 'Connesso', account: 'Milano Centro', lastCheck: '10 min fa', localLocation: 'Milano Centro' },
];

const initialAssets: AssetView[] = [
  { id: 'a1', name: 'Logo principale', kind: 'image', tag: 'brand', previewVariant: 0, usageCount: 8 },
  { id: 'a2', name: 'Team al lavoro', kind: 'image', tag: 'brand', previewVariant: 1, usageCount: 3 },
  { id: 'a3', name: 'Sede Milano', kind: 'image', tag: 'content', previewVariant: 2, usageCount: 5 },
  { id: 'a4', name: 'Template informativo', kind: 'image', tag: 'content', previewVariant: 0, usageCount: 12 },
  { id: 'a5', name: 'Foto servizio', kind: 'image', tag: 'content', previewVariant: 1, usageCount: 2 },
  { id: 'a6', name: 'Brand guide PDF', kind: 'document', tag: 'brand', previewVariant: 2, usageCount: 1 },
];

const initialNotifications: NotificationView[] = [
  { id: 'n1', title: '3 contenuti richiedono approvazione', detail: 'La coda contiene varianti Instagram, Facebook e LinkedIn.', tone: 'info', time: 'Adesso', read: false },
  { id: 'n2', title: 'LinkedIn richiede riconnessione', detail: 'Il provider mock è in stato reauth_required e il publishing viene bloccato.', tone: 'warn', time: '3 giorni fa', read: false },
  { id: 'n3', title: 'Brand Profile al 92%', detail: 'Conferma tre campi inferiti per aumentare la qualità del contesto.', tone: 'good', time: 'Oggi', read: false },
];

const analytics: AnalyticsView = {
  impressions: 18_420,
  reach: 12_880,
  engagements: 1_742,
  clicks: 386,
  trend: [42, 55, 48, 70, 62, 84, 76],
};

const usage: UsageView = {
  weeklyPosts: { used: 2, limit: 3 },
  websitePages: { used: 18, limit: 50 },
  storageMb: { used: 126, limit: 1024 },
};

export class InMemorySaasRepository implements SaasRepository {
  private revision = 1;
  private posts = clone(initialPosts);
  private brandFields = clone(initialBrandFields);
  private connections = clone(initialConnections);
  private assets = clone(initialAssets);
  private notifications = clone(initialNotifications);
  private readonly listeners = new Set<() => void>();

  getSnapshot(): SaasSnapshot {
    return {
      revision: this.revision,
      posts: clone(this.posts),
      brandFields: clone(this.brandFields),
      connections: clone(this.connections),
      assets: clone(this.assets),
      notifications: clone(this.notifications),
      analytics: clone(analytics),
      usage: clone(usage),
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  approvePost(postId: string): void {
    this.updatePost(postId, 'Programmato');
  }

  rejectPost(postId: string): void {
    this.updatePost(postId, 'Da rivedere');
  }

  schedulePost(postId: string): void {
    this.updatePost(postId, 'Programmato');
  }

  setConnectionState(connectionId: string, status: ConnectionState): void {
    const connection = this.connections.find((item) => item.id === connectionId);
    if (!connection) throw new Error('frontend_connection_not_found');
    connection.status = status;
    connection.lastCheck = 'Adesso · mock';
    this.bump();
  }

  markNotificationRead(notificationId: string): void {
    const notification = this.notifications.find((item) => item.id === notificationId);
    if (!notification) throw new Error('frontend_notification_not_found');
    notification.read = true;
    this.bump();
  }

  markAllNotificationsRead(): void {
    for (const notification of this.notifications) notification.read = true;
    this.bump();
  }

  getDashboard() {
    return {
      pendingApprovals: this.posts.filter((post) => post.state === 'In approvazione' || post.state === 'Da rivedere' || post.state === 'Draft').length,
      scheduledPosts: this.posts.filter((post) => post.state === 'Programmato').length,
      connectedChannels: this.connections.filter((connection) => connection.status === 'Connesso').length,
      totalChannels: this.connections.length,
      brandCoverage: 92,
      posts: clone(this.posts.slice(0, 5)),
      usage: clone(usage),
    };
  }

  private updatePost(postId: string, state: EditorialPost['state']): void {
    const post = this.posts.find((item) => item.id === postId);
    if (!post) throw new Error('frontend_post_not_found');
    post.state = state;
    this.bump();
  }

  private bump(): void {
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }
}

export const createMockSaasRepository = (): SaasRepository => new InMemorySaasRepository();
