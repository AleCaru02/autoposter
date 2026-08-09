import { brandSections, connectionRows, demoPosts, type DemoPost } from '../app/demo-data';

export interface DashboardSnapshot {
  pendingApprovals: number;
  scheduledPosts: number;
  connectedChannels: number;
  weeklyQuotaUsed: number;
  weeklyQuotaLimit: number;
}

export interface SocialSaasService {
  getDashboard(): Promise<DashboardSnapshot>;
  getPosts(): Promise<DemoPost[]>;
  getBrandSections(): Promise<readonly (readonly [string, string, string])[]>;
  getConnections(): Promise<readonly (readonly [string, string, string, string])[]>;
}

const delay = async <T>(value: T): Promise<T> => Promise.resolve(structuredClone(value));

export const mockSocialSaasService: SocialSaasService = {
  getDashboard: () => delay({ pendingApprovals: 3, scheduledPosts: 6, connectedChannels: 3, weeklyQuotaUsed: 2, weeklyQuotaLimit: 3 }),
  getPosts: () => delay(demoPosts),
  getBrandSections: () => delay(brandSections),
  getConnections: () => delay(connectionRows),
};

// Production adapters will implement the same interface. Components must not
// import Supabase or provider SDKs directly.
