import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { App } from './App';

const renderRoute = (route: string): string => renderToString(<MemoryRouter initialEntries={[route]}><App /></MemoryRouter>);

describe('SaaS web routes', () => {
  it('renders public product and isolated public chatbot shell', () => {
    const html = renderRoute('/');
    expect(html).toContain('Strategia, contenuti, approvazioni');
    expect(html).toContain('Chatbot pubblico');
    expect(html).toContain('Non riceve tenantId né token tenant');
    expect(html).toContain('Google Business Profile');
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

  it('renders the social connection screen with all provider contracts', () => {
    const html = renderRoute('/app/connections');
    expect(html).toContain('Google Business Profile');
    expect(html).toContain('Instagram');
    expect(html).toContain('LinkedIn');
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
