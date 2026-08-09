import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { App } from './App';

const renderRoute = (route: string): string => renderToString(
  <MemoryRouter initialEntries={[route]}>
    <App />
  </MemoryRouter>,
);

describe('SaaS web routes', () => {
  it('renders the public landing without tenant data', () => {
    const html = renderRoute('/');
    expect(html).toContain('Strategia, contenuti, approvazioni');
    expect(html).toContain('Chatbot pubblico');
    expect(html).toContain('Non posso accedere ai dati tenant');
  });

  it('renders the authenticated demo dashboard shell', () => {
    const html = renderRoute('/app');
    expect(html).toContain('Demo Studio');
    expect(html).toContain('Modalità mock');
    expect(html).toContain('Approvazioni');
    expect(html).toContain('Canali sani');
  });

  it('renders channel-aware post editor with quality and publishing safety', () => {
    const html = renderRoute('/app/posts/p3');
    expect(html).toContain('Post editor · mock');
    expect(html).toContain('separate_concept');
    expect(html).toContain('Quality gate');
    expect(html).toContain('Anti-duplicate');
    expect(html).toContain('SOCIAL_PUBLISHING_ENABLED=false');
  });

  it('renders Google Business Profile connection in the social connection screen', () => {
    const html = renderRoute('/app/connections');
    expect(html).toContain('Google Business Profile');
    expect(html).toContain('Milano Centro');
    expect(html).toContain('I pulsanti sono mock');
  });

  it('renders the admin console with remote infrastructure explicitly deferred', () => {
    const html = renderRoute('/admin');
    expect(html).toContain('Console amministrativa');
    expect(html).toContain('Database locale');
    expect(html).toContain('Supabase remoto');
    expect(html).toContain('Posticipato');
  });
});
