import { useEffect } from 'react';

interface SeoProps {
  title: string;
  description: string;
  path: string;
  image?: string;
  noIndex?: boolean;
  structuredData?: Record<string, unknown> | Array<Record<string, unknown>>;
}

const ensureMeta = (name: string, value: string, attribute: 'name' | 'property' = 'name') => {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${name}"]`);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, name);
    document.head.appendChild(element);
  }
  element.content = value;
};

const ensureLink = (rel: string, href: string) => {
  let element = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!element) {
    element = document.createElement('link');
    element.rel = rel;
    document.head.appendChild(element);
  }
  element.href = href;
};

export function Seo({ title, description, path, image, noIndex = false, structuredData }: SeoProps) {
  useEffect(() => {
    const configuredBase = import.meta.env.VITE_PUBLIC_SITE_URL?.trim().replace(/\/$/, '');
    const base = configuredBase || window.location.origin;
    const canonical = `${base}${path === '/' ? '' : path}`;
    const socialImage = image ? new URL(image, base).toString() : `${base}/og-product.svg`;

    document.title = title;
    ensureMeta('description', description);
    ensureMeta('robots', noIndex ? 'noindex,nofollow' : 'index,follow,max-image-preview:large');
    ensureMeta('og:title', title, 'property');
    ensureMeta('og:description', description, 'property');
    ensureMeta('og:type', 'website', 'property');
    ensureMeta('og:url', canonical, 'property');
    ensureMeta('og:image', socialImage, 'property');
    ensureMeta('twitter:card', 'summary_large_image');
    ensureMeta('twitter:title', title);
    ensureMeta('twitter:description', description);
    ensureMeta('twitter:image', socialImage);
    ensureLink('canonical', canonical);

    document.head.querySelectorAll('script[data-post-automatici-schema]').forEach((node) => node.remove());
    const schemas = structuredData ? (Array.isArray(structuredData) ? structuredData : [structuredData]) : [];
    schemas.forEach((schema) => {
      const script = document.createElement('script');
      script.type = 'application/ld+json';
      script.dataset.postAutomaticiSchema = 'true';
      script.textContent = JSON.stringify(schema);
      document.head.appendChild(script);
    });

    return () => {
      document.head.querySelectorAll('script[data-post-automatici-schema]').forEach((node) => node.remove());
    };
  }, [description, image, noIndex, path, structuredData, title]);

  return null;
}

export const softwareSchemas = (baseUrl: string) => ([
  {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Post Automatici',
    url: baseUrl,
  },
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Post Automatici',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    description: 'Piattaforma AI per profili attività indipendenti, analisi sito pagina per pagina, creazione contenuti, anteprima obbligatoria, approvazione umana, pubblicazione social e apprendimento da metriche reali.',
  },
]);
