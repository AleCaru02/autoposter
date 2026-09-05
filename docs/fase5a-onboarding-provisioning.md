# FASE 5A — onboarding provisioning

## Scope

The first onboarding block closes the gap introduced intentionally by fail-closed
plan packaging: a new profile must receive its package through a privileged,
authenticated server boundary before `website.scan` or `brand.analyze` can run.

## Contract

1. The client sends a stable operation UUID to `POST /api/onboarding-provision`.
2. The server verifies the bearer token through the production Data API identity
   RPC and rejects missing, invalid, or banned identities.
3. `provision_onboarding_profile` serializes the owner/operation pair and creates
   the profile, derived OWNER membership, package assignment, entitlements and
   audit entry in one database transaction.
4. Repeating the same operation and request returns the original profile.
   Reusing an operation with a different fingerprint fails closed.
5. The idempotency table and function are inaccessible to `authenticated`.

The assigned package is the versioned entitlement mapping
`commercial_guarded:v1`; endpoints continue to authorize capability keys, never
plan names. Stripe and pricing decisions remain outside this block.
