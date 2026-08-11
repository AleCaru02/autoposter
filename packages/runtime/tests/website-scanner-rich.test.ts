import { describe, expect, it } from 'vitest';
import { FixturePageFetcher, WebsiteScanner, assertPublicHttpUrl } from '../src/website-scanner.js';

describe('WebsiteScanner rich public knowledge',()=>{
  it('uses robots + sitemap index and extracts canonical metadata, assets and stylesheet colors',async()=>{
    const fetcher=new FixturePageFetcher({
      'https://brand.test/robots.txt':{status:200,contentType:'text/plain',body:'User-agent: *\nDisallow: /private\nSitemap: https://brand.test/sitemap.xml'},
      'https://brand.test/sitemap.xml':{status:200,contentType:'application/xml',body:'<sitemapindex><sitemap><loc>https://brand.test/pages.xml</loc></sitemap></sitemapindex>'},
      'https://brand.test/pages.xml':{status:200,contentType:'application/xml',body:'<urlset><url><loc>https://brand.test/from-map</loc></url><url><loc>https://brand.test/private</loc></url></urlset>'},
      'https://brand.test/':{status:200,contentType:'text/html',body:'<html><head><title>Brand</title><meta name="description" content="Descrizione reale"><link rel="canonical" href="https://brand.test/"><link rel="icon" href="/favicon.png"><link rel="stylesheet" href="/brand.css"></head><body><h1>Servizio principale</h1><h2>Per aziende</h2><img class="brand-logo" alt="Brand logo" src="/logo.png"><img src="/hero.jpg"><a href="/private">Privata</a></body></html>'},
      'https://brand.test/brand.css':{status:200,contentType:'text/css',body:':root{--brand:#1a2b3c}.cta{color:rgb(10, 20, 30)}'},
      'https://brand.test/from-map':{status:200,contentType:'text/html',body:'<html><head><title>Da sitemap</title></head><body><h1>Pagina scoperta</h1></body></html>'},
    });
    const result=await new WebsiteScanner(fetcher).scan({rootUrl:'https://brand.test/',maxPages:5});
    expect(result.pages.map((page)=>page.url)).toEqual(['https://brand.test/','https://brand.test/from-map']);
    expect(result.skippedRobotsCount).toBeGreaterThanOrEqual(1);
    expect(result.sitemapCount).toBe(2);
    const home=result.pages[0]!;
    expect(home.metaDescription).toBe('Descrizione reale');
    expect(home.canonicalUrl).toBe('https://brand.test/');
    expect(home.headings).toEqual([{level:1,text:'Servizio principale'},{level:2,text:'Per aziende'}]);
    expect(home.logoCandidates).toContain('https://brand.test/logo.png');
    expect(home.imageCandidates).toContain('https://brand.test/hero.jpg');
    expect(home.faviconUrls).toContain('https://brand.test/favicon.png');
    expect(home.colors).toEqual(expect.arrayContaining(['#1a2b3c','rgb(10, 20, 30)']));
    expect(result.resources.map((item)=>item.type)).toEqual(expect.arrayContaining(['robots','sitemap_index','sitemap','stylesheet','favicon','logo_candidate','raw_page']));
  });

  it('blocks loopback/private targets before a public HTTP request can be made',async()=>{
    await expect(assertPublicHttpUrl('http://127.0.0.1/internal')).rejects.toThrow('scanner_unsafe_target');
    await expect(assertPublicHttpUrl('http://localhost/internal')).rejects.toThrow('scanner_unsafe_target');
  });
});
