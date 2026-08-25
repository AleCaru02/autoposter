import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { App } from './App';

const renderRoute = (route: string): string => renderToString(<MemoryRouter initialEntries={[route]}><App /></MemoryRouter>);

describe('Post Automatici web routes', () => {
  it('renders public product with mandatory approval', () => {
    const html = renderRoute('/');
    expect(html).toContain('Post Automatici');
    expect(html).toContain('Il tuo Social Media Manager AI.');
    expect(html).toContain('Crea, pubblica e migliora.');
    expect(html).toContain('Chiedi al prodotto');
    expect(html).toContain('Non è cross-posting');
    expect(html).toContain('Google Business Profile');
    expect(html).toContain('Anteprima sempre obbligatoria');
    expect(html).toContain('Nessuna pubblicazione senza approvazione');
    expect(html).toContain('L’assistente pubblico non viene simulato');
  });

  it('renders public SEO information architecture', () => {
    expect(renderRoute('/come-funziona')).toContain('Un workflow leggibile');
    expect(renderRoute('/funzionalita')).toContain('Una control room per il lavoro social');
    expect(renderRoute('/prezzi')).toContain('Prezzo da definire');
    expect(renderRoute('/faq')).toContain('Domande prima di affidare il workflow');
    expect(renderRoute('/social-media-manager-ai')).toContain('Generare una caption è facile');
    expect(renderRoute('/gestione-social-automatica')).toContain('Automazione non significa perdere il controllo');
  });

  it('fails closed on dashboard without backend', () => {
    const html = renderRoute('/app');
    expect(html).toContain('Backend non collegato');
    expect(html).toContain('OpenAI: DA CONFIGURARE');
    expect(html).toContain('Social: DA CONFIGURARE');
    expect(html).not.toContain('REAL DATA MODE');
    expect(html).not.toContain('Demo Studio');
  });

  it('fails closed on post editor without product modes', () => {
    const html = renderRoute('/app/posts/p3');
    expect(html).toContain('Backend non collegato');
    expect(html).toContain('OpenAI: DA CONFIGURARE');
    expect(html).not.toContain('REAL DATA MODE');
    expect(html).not.toContain('Post editor · mock');
  });

  it('fails closed on social connections without fake OAuth', () => {
    const html = renderRoute('/app/connections');
    expect(html).toContain('Backend non collegato');
    expect(html).toContain('Social: DA CONFIGURARE');
    expect(html).not.toContain('Connetti mock');
    expect(html).not.toContain('REAL DATA MODE');
  });

  it('fails closed on provider console without backend', () => {
    const html = renderRoute('/admin/providers');
    expect(html).toContain('Backend non collegato');
    expect(html).toContain('Social: DA CONFIGURARE');
    expect(html).not.toContain('REAL DATA MODE');
  });

  it('exposes approvals on both canonical routes', () => {
    expect(renderRoute('/app/approvals')).toContain('Approvazioni');
    expect(renderRoute('/approvals')).toContain('Approvazioni');
  });

  it('keeps admin route fail-closed without implicit admin', () => {
    const html = renderRoute('/admin');
    expect(html).toContain('Backend non collegato');
    expect(html).not.toContain('REAL DATA MODE');
    expect(html).not.toContain('Console amministrativa');
  });
});
