export type Platform = 'Instagram' | 'Facebook' | 'LinkedIn' | 'Google Business Profile';
export type PostState = 'Idea' | 'Draft' | 'In approvazione' | 'Programmato' | 'Pubblicato' | 'Da rivedere';
export type PlatformDecision = 'native_variant' | 'separate_concept' | 'skip';
export type ConnectionState = 'Connesso' | 'Da riconnettere' | 'Scaduta' | 'Disabilitata';

export interface EditorialPost {
  id: string;
  date: string;
  title: string;
  platform: Platform;
  state: PostState;
  decision: PlatformDecision;
}

export interface BrandFieldView {
  key: string;
  label: string;
  value: string;
  status: 'Confermato' | 'Inferito' | 'Bloccato';
  locked: boolean;
}

export interface SocialConnectionView {
  id: string;
  platform: Platform;
  status: ConnectionState;
  account: string;
  lastCheck: string;
  localLocation?: string;
}

export interface AssetView {
  id: string;
  name: string;
  kind: 'image' | 'document';
  tag: 'brand' | 'content';
  previewVariant: 0 | 1 | 2;
  usageCount: number;
}

export interface NotificationView {
  id: string;
  title: string;
  detail: string;
  tone: 'info' | 'warn' | 'good';
  time: string;
  read: boolean;
}

export interface AnalyticsView {
  impressions: number;
  reach: number;
  engagements: number;
  clicks: number;
  trend: number[];
}

export interface UsageView {
  weeklyPosts: { used: number; limit: number };
  websitePages: { used: number; limit: number };
  storageMb: { used: number; limit: number };
}

export interface DashboardView {
  pendingApprovals: number;
  scheduledPosts: number;
  connectedChannels: number;
  totalChannels: number;
  brandCoverage: number;
  posts: EditorialPost[];
  usage: UsageView;
}

export interface SaasSnapshot {
  revision: number;
  posts: EditorialPost[];
  brandFields: BrandFieldView[];
  connections: SocialConnectionView[];
  assets: AssetView[];
  notifications: NotificationView[];
  analytics: AnalyticsView;
  usage: UsageView;
}

export interface SaasRepository {
  getSnapshot(): SaasSnapshot;
  subscribe(listener: () => void): () => void;
  approvePost(postId: string): void;
  rejectPost(postId: string): void;
  schedulePost(postId: string): void;
  setConnectionState(connectionId: string, status: ConnectionState): void;
  markNotificationRead(notificationId: string): void;
  markAllNotificationsRead(): void;
  getDashboard(): DashboardView;
}
