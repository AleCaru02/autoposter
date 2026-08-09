import { createContext, useContext, useMemo, useSyncExternalStore, type PropsWithChildren } from 'react';
import type { SaasRepository, SaasSnapshot } from './domain';
import { createMockSaasRepository } from './mock-repository';

const SaasRepositoryContext = createContext<SaasRepository | null>(null);

export function SaasServicesProvider({ children, repository }: PropsWithChildren<{ repository?: SaasRepository }>) {
  const resolved = useMemo(() => repository ?? createMockSaasRepository(), [repository]);
  return <SaasRepositoryContext.Provider value={resolved}>{children}</SaasRepositoryContext.Provider>;
}

export function useSaasRepository(): SaasRepository {
  const repository = useContext(SaasRepositoryContext);
  if (!repository) throw new Error('SaasServicesProvider is required');
  return repository;
}

export function useSaasSnapshot(): SaasSnapshot {
  const repository = useSaasRepository();
  useSyncExternalStore(
    (listener) => repository.subscribe(listener),
    () => repository.getSnapshot().revision,
    () => repository.getSnapshot().revision,
  );
  return repository.getSnapshot();
}
