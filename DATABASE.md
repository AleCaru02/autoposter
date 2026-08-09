# Database

## ERD iniziale

```mermaid
erDiagram
  profiles ||--o{ tenant_members : joins
  tenants ||--o{ tenant_members : has
  plans ||--o{ subscriptions : assigned
  tenants ||--o{ subscriptions : owns
  tenants ||--o{ websites : owns
  websites ||--o{ website_scans : scanned
  website_scans ||--o{ website_pages : contains
  tenants ||--o{ brand_profiles : owns
  brand_profiles ||--o{ brand_profile_locks : locks
  tenants ||--o{ brand_assets : owns
  tenants ||--o{ social_connections : owns
  social_connections ||--o{ social_accounts : exposes
  tenants ||--o{ content_strategies : owns
  content_strategies ||--o{ content_pillars : contains
  tenants ||--o{ posts : owns
  posts ||--o{ post_variants : has
  posts ||--o{ publication_jobs : publishes
  publication_jobs ||--o{ publication_attempts : attempts
  posts ||--o{ published_posts : results
  tenants ||--o{ analytics_snapshots : measures
  tenants ||--o{ ai_usage_events : costs
  tenants ||--o{ editorial_memory : remembers
  tenants ||--o{ content_fingerprints : deduplicates
  tenants ||--o{ audit_logs : audits
```

## Sicurezza dati

- Tutte le tabelle tenant-scoped usano RLS.
- `service_role` non viene mai usata nel frontend.
- Credenziali social sono conservate in schema privato non esposto via PostgREST e solo come ciphertext; la cifratura applicativa/server-side viene implementata prima di attivare OAuth reale.
- `platform_admins` è nello schema privato e non modificabile da utenti applicativi.
- Audit log append-only lato applicativo privilegiato.

## Knowledge

Due livelli:
1. RAW: `website_pages`, asset, documenti e snapshot.
2. COMPACT: `brand_context_versions`, usato nella maggior parte delle generazioni.

## Publishing

`publication_jobs.idempotency_key` è unico per tenant. `published_posts` conserva ID esterno; il worker controlla entrambi prima di pubblicare.