import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { App } from './App';

const renderRoute = (route: string): string => renderToString(
  <MemoryRouter initialEntries={[route]}>
    <App />
  </MemoryRouter>,
);

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

  it('renders auth controls inside explicit labels and declares autocomplete intent', () => {
    const html = renderRoute('/login');
    expect(html).toContain('autoComplete="email"');
    expect(html).toContain('autoComplete="current-password"');
    expect((html.match(/<label/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(html).toContain('nessuna credenziale viene inviata');
  });

  it('exposes post platform selection as tabs with selected state', () => {
    const html = renderRoute('/app/posts/p3');
    expect(html).toContain('role="tablist"');
    expect((html.match(/role="tab"/g) ?? []).length).toBe(4);
    expect(html).toContain('aria-selected="true"');
  });

  it('keeps settings checkboxes associated with descriptive labels', () => {
    const html = renderRoute('/app/settings');
    expect((html.match(/<label class="toggle-row"/g) ?? []).length).toBe(2);
    expect(html).toContain('Social publishing reale');
    expect(html).toContain('Safety flag');
  });
});
