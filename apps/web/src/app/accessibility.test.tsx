import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { App } from './App';

const renderRoute = (route: string): string => renderToString(<MemoryRouter initialEntries={[route]}><App /></MemoryRouter>);

describe('accessibility smoke', () => {
  it('provides public navigation, main landmarks and a named chatbot disclosure', () => {
    const html = renderRoute('/');
    expect(html).toContain('<header');
    expect(html).toContain('<nav');
    expect(html).toContain('<main');
    expect(html).toContain('class="sales-chat-launcher"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Chiedi al prodotto');
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
    expect(html).toContain('nessun collegamento live');
  });

  it('keeps the fail-closed private data gate keyboard reachable', () => {
    const html = renderRoute('/app/posts/p3');
    expect(html).toContain('REAL DATA MODE');
    expect(html).toContain('Backend non collegato');
    expect(html).toContain('href="/onboarding"');
    expect(html).toContain('href="/"');
    expect(html).toContain('Provider: NON COLLEGATO');
  });

  it('keeps the onboarding fallback explicit when local API is absent', () => {
    const html = renderRoute('/onboarding');
    expect(html).toContain('VITE_LOCAL_API_URL');
    expect(html).toContain('Nessun dato viene scritto a servizi remoti');
  });
});
