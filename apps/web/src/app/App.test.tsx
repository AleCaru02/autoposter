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

  it('fails closed on the personal dashboard when backend is not configured', () => {
    const html = renderRoute('/app');
    expect(html).toContain('Post Automatici');
    expect(html).toContain('Backend non collegato');
    expect(html).toContain('Provider: NON COLLEGATO');
    expect(html).not.toContain('Demo Studio');
    expect(html).not.toContain('Canali sani');
  });

  it('fails closed on the post editor when no real/local backend is configured', () => {
    const html = renderRoute('/app/posts/p3');
    expect(html).toContain('REAL DATA MODE');
    expect(html).toContain('Backend non collegato');
    expect(html).toContain('Provider: NON COLLEGATO');
    expect(html).not.toContain('Post editor · mock');
  });

  it('fails closed on social connections without pretending OAuth is live', () => {
    const html = renderRoute('/app/connections');
    expect(html).toContain('Post Automatici');
    expect(html).toContain('Backend non collegato');
    expect(html).toContain('Provider: NON COLLEGATO');
    expect(html).not.toContain('Connetti mock');
  });

  it('fails closed on the provider test console without a configured backend', () => {
    const html = renderRoute('/admin/providers');
    expect(html).toContain('REAL DATA MODE');
    expect(html).toContain('Backend non collegato');
    expect(html).toContain('Provider: NON COLLEGATO');
  });

  it('exposes approvals on both canonical routes', () => {
    expect(renderRoute('/app/approvals')).toContain('Approvazioni');
    expect(renderRoute('/approvals')).toContain('Approvazioni');
  });

  it('keeps admin route present but fail-closed without granting local admin implicitly', () => {
    const html = renderRoute('/admin');
    expect(html).toContain('REAL DATA MODE');
    expect(html).toContain('Backend non collegato');
    expect(html).not.toContain('Console amministrativa');
  });
});
