import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { App } from './App';

const renderRoute = (route: string): string => renderToString(<MemoryRouter initialEntries={[route]}><App /></MemoryRouter>);

describe('accessibility smoke', () => {
  it('provides public navigation, main landmarks and a named assistant disclosure', () => {
    const html = renderRoute('/');
    expect(html).toContain('<header');
    expect(html).toContain('<nav');
    expect(html).toContain('<main');
    expect(html).toContain('class="sales-chat-launcher"');
    expect(html).toContain('aria-label="Informazioni prodotto"');
    expect(html).toContain('Chiedi al prodotto');
    expect(html).toContain('L’assistente pubblico non viene simulato');
  });

  it('provides a named primary application navigation', () => {
    const html = renderRoute('/app');
    expect(html).toContain('aria-label="Navigazione principale"');
    expect(html).toContain('<main');
  });

  it('renders auth controls inside labels and declares autocomplete intent', () => {
    const html = renderRoute('/login').toLowerCase();
    expect(html).toContain('autocomplete="email"');
    expect(html).toContain('autocomplete="current-password"');
    expect((html.match(/<label/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(html).toContain('backend di produzione: da collegare');
    expect(html).toContain('le funzioni non collegate restano esplicitamente non disponibili');
  });

  it('keeps the fail-closed private data gate keyboard reachable', () => {
    const html = renderRoute('/app/posts/p3');
    expect(html).toContain('Backend non collegato');
    expect(html).toContain('href="/onboarding"');
    expect(html).toContain('href="/"');
    expect(html).toContain('OpenAI: DA CONFIGURARE');
    expect(html).toContain('Social: DA CONFIGURARE');
    expect(html).not.toContain('REAL DATA MODE');
  });

  it('keeps the onboarding fallback explicit when production backend is absent', () => {
    const html = renderRoute('/onboarding');
    expect(html).toContain('Backend da configurare');
    expect(html).toContain('backend persistente');
    expect(html).toContain('Nessun dato viene simulato');
    expect(html).not.toContain('VITE_LOCAL_API_URL');
  });
});
