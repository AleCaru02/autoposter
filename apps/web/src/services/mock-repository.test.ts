import { describe, expect, it, vi } from 'vitest';
import { InMemorySaasRepository } from './mock-repository';

describe('InMemorySaasRepository', () => {
  it('keeps post state changes consistent across snapshot and dashboard selectors', () => {
    const repository = new InMemorySaasRepository();
    const before = repository.getDashboard();
    expect(before.pendingApprovals).toBeGreaterThan(0);

    repository.approvePost('p2');
    const snapshot = repository.getSnapshot();
    const dashboard = repository.getDashboard();

    expect(snapshot.posts.find((post) => post.id === 'p2')?.state).toBe('Programmato');
    expect(dashboard.scheduledPosts).toBe(before.scheduledPosts + 1);
    expect(dashboard.pendingApprovals).toBe(before.pendingApprovals - 1);
  });

  it('publishes repository changes through subscriptions', () => {
    const repository = new InMemorySaasRepository();
    const listener = vi.fn();
    const unsubscribe = repository.subscribe(listener);

    repository.setConnectionState('li', 'Connesso');
    repository.markNotificationRead('n1');
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    repository.markAllNotificationsRead();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('updates connection health and dashboard health count from one source of truth', () => {
    const repository = new InMemorySaasRepository();
    expect(repository.getDashboard().connectedChannels).toBe(3);

    repository.setConnectionState('li', 'Connesso');
    expect(repository.getSnapshot().connections.find((item) => item.id === 'li')?.status).toBe('Connesso');
    expect(repository.getDashboard().connectedChannels).toBe(4);
  });

  it('returns defensive snapshots that cannot mutate repository state', () => {
    const repository = new InMemorySaasRepository();
    const snapshot = repository.getSnapshot();
    snapshot.posts[0]!.title = 'Tampered outside repository';
    snapshot.connections[0]!.status = 'Disabilitata';

    const next = repository.getSnapshot();
    expect(next.posts[0]?.title).not.toBe('Tampered outside repository');
    expect(next.connections[0]?.status).toBe('Connesso');
  });

  it('rejects mutations against unknown entities', () => {
    const repository = new InMemorySaasRepository();
    expect(() => repository.approvePost('missing')).toThrow('frontend_post_not_found');
    expect(() => repository.setConnectionState('missing', 'Connesso')).toThrow('frontend_connection_not_found');
    expect(() => repository.markNotificationRead('missing')).toThrow('frontend_notification_not_found');
  });
});
