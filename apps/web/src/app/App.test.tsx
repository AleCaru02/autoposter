import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { App } from './App';

const renderRoute = (route: string): string => renderToString(<MemoryRouter initialEntries={[route]}><App /></MemoryRouter>);

describe('SaaS web routes', () => {
  it('renders redesigned public product and isolated public chatbot shell', () => {
    const html = renderRoute('/');
    expect(html).toContain('Il tuo Social Media Manager AI.');
    expect(html).toContain('Crea, pubblica e migliora.');
    expect(html).toContain('Chiedi al prodotto');
    expect(html).toContain('Non è cross-posting');
    expect(html).toContain('Google Business Profile');
  });

  it('renders public SEO information architecture without thin route fallbacks', () => {
    expect(renderRoute('/come-funziona')).toContain('Un workflow leggibile');
    expect(renderRoute('/funzionalita')).toContain('Una control room per il lavoro social');
    expect(renderRoute('/prezzi')).toContain('Prezzo da definire');
    expect(renderRoute('/faq')).toContain('Domande prima di affidare il workflow');
    expect(renderRoute('/social-media-manager-ai')).toContain('Generare una caption è facile');
    expect(renderRoute('/gestione-social-automatica')).toContain('Automazione non significa perdere il controllo');
  });

  it('renders dashboard fallback safely when local API is not configured', () => {
    const html = renderRoute('/app');
    expect(html).toContain('Demo Studio');
    expect(html).toContain('Approvazioni');
    expect(html).toContain('Canali sani');
  });

  it('renders post editor fallback without enabling real publishing', () => {
    const html = renderRoute('/app/posts/p3');
    expect(html).toContain('Post editor · mock');
    expect(html).toContain('VITE_LOCAL_API_URL');
    expect(html).toContain('Instagram');
    expect(html).toContain('Google Business Profile');
  });

  it('renders the provider-ready connection route without enabling OAuth live', () => {
    const html = renderRoute('/app/connections');
    expect(html).toContain('Social Connections');
    expect(html).toContain('Local E2E richiesto');
  });

  it('renders the dev/admin provider test console route', () => {
    const html = renderRoute('/admin/providers');
    expect(html).toContain('Provider Test Console');
    expect(html).toContain('Local E2E richiesto');
  });

  it('exposes approvals on both canonical routes', () => {
    expect(renderRoute('/app/approvals')).toContain('Approvazioni');
    expect(renderRoute('/approvals')).toContain('Approvazioni');
  });

  it('keeps admin route present without granting local admin implicitly', () => {
    const html = renderRoute('/admin');
    expect(html).toContain('Console amministrativa');
    expect(html).toContain('Platform admin');
  });
});
