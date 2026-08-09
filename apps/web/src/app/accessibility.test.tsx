import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { App } from './App';

const renderRoute = (route: string): string => renderToString(<MemoryRouter initialEntries={[route]}><App /></MemoryRouter>);

describe('accessibility smoke', () => {
  it('provides public navigation and main landmarks', () => {
    const html = renderRoute('/');
    expect(html).toContain('<header');
    expect(html).toContain('<nav');
    expect(html).toContain('<main');
    expect(html).toContain('aria-label="Domanda al chatbot"');
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
    expect(html).toContain('nessuna credenziale');
  });

  it('keeps the local post editor fallback keyboard reachable', () => {
    const html = renderRoute('/app/posts/p3');
    expect((html.match(/<button/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(html).toContain('Instagram');
    expect(html).toContain('Google Business Profile');
  });

  it('keeps the onboarding fallback explicit when local API is absent', () => {
    const html = renderRoute('/onboarding');
    expect(html).toContain('VITE_LOCAL_API_URL');
    expect(html).toContain('Nessun dato viene scritto a servizi remoti');
  });
});
