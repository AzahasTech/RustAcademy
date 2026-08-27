# Rate Limiting & Audit Trails for Sensitive Mutations

Issue #551 — operator guidance for the throttling and audit-logging controls
that protect admin, auth, and payment-sensitive mutation endpoints.

## Summary

Every request is throttled per a resolved **group**: `public`, `authenticated`,
`webhooks`, or `sensitive`. Group resolution (see
[`custom-throttler.guard.ts`](../src/auth/guards/custom-throttler.guard.ts)):

1. An explicit `@RateLimitGroupTag(...)` decorator on the route, if present.
2. `/webhooks/*` paths → `webhooks`.
3. A resolvable user id or API key → `authenticated`.
4. Everything else → `public`.

**`sensitive` is never inferred — routes opt in explicitly.** Use it for
anything that changes privileged state or moves money: role/admin changes,
fee/config mutations, marketplace listings/bids/transfers, payout-adjacent
reads, retention/deletion of the audit trail itself, etc.

## Applying it to a route

Use the composed decorator — it bundles both the rate limit and the audit
trail in one place, matching the issue's intent ("combining request
throttling, contextual audit logs, and explicit anomaly handling"):

```ts
import { SensitiveMutation } from "../auth/decorators/sensitive-mutation.decorator";

@Post(":listingId/accept-bid/:bidId")
@SensitiveMutation("marketplace.bid.accept")
acceptBid(...) { ... }
```

This:

- Tags the route for the `sensitive` throttling group.
- Applies `AuditInterceptor`, which records an audit log entry on **every**
  call (success or failure) with actor identity, route context, and request
  metadata — see [`audit.interceptor.ts`](../src/audit/audit.interceptor.ts).
- Names the audit action (`marketplace.bid.accept`) so entries are filterable
  and alertable; without an explicit name it falls back to `METHOD /path`.

The consuming module must import `AuditModule` for `AuditInterceptor`'s
dependencies to resolve (see `MarketplaceModule`/`PaymentsModule` for
examples).

## Why "sensitive" needs two limits, not one

`public`/`authenticated`/`webhooks` are each tracked by a single identity —
whichever of `user_id` → `api_key` → `ip` resolves first (`RATE_LIMIT_KEY_ORDER`).
That's not enough for sensitive mutations, which face two different abuse
shapes:

- **One identity hammering the endpoint** (a compromised or malicious
  account/API key) — bounded by the identity-keyed limit
  (`RATE_LIMIT_SENSITIVE_*`).
- **One IP cycling through many identities** (credential stuffing, account
  enumeration, bot farms rotating stolen sessions) — the identity-keyed limit
  alone never trips here, because each identity only sends a few requests.
  Bounded by the independent, always-IP-keyed limit
  (`RATE_LIMIT_SENSITIVE_IP_*`).

Both are enforced on every `sensitive`-tagged request; either one tripping
returns `429` with a `Retry-After` header.

## Explicit anomaly handling

A tripped `sensitive` limit is treated as a security-relevant event, not just
a metric:

- `MetricsService.recordRateLimitedRequest(...)` — as with every other group.
- `AuditService.log(..., "rate_limit.sensitive_exceeded", ...)` — records the
  identity/IP, route, and window that tripped, into the same audit trail as
  successful mutations. This call is fire-and-forget and can never block or
  fail the throttling decision itself.

Query these via `GET /admin/audit?action=rate_limit.sensitive_exceeded` to
build alerting on abuse patterns.

## Configuration (all optional — safe defaults applied)

See [`.env.example`](../.env.example) for the full annotated list and
[`rate-limit.config.ts`](../src/config/rate-limit.config.ts) /
[`env.schema.ts`](../src/config/env.schema.ts) for validation. Defaults:

| Group | Window | Limit | TTL |
|---|---|---|---|
| `public` | burst / sustained | 10 / 20 | 10s / 60s |
| `authenticated` | burst / sustained | 40 / 120 | 10s / 60s |
| `webhooks` | burst / sustained | 20 / 60 | 10s / 60s |
| `sensitive` (per identity) | burst / sustained | 5 / 20 | 10s / 60s |
| `sensitive` (per IP, always) | burst / sustained | 15 / 50 | 10s / 60s |

**Tuning for production:** start from these defaults. If a legitimate
integration brushes against the `sensitive` per-identity limit, prefer
raising `RATE_LIMIT_SENSITIVE_SUSTAINED_LIMIT` over the burst limit — burst
protects against tight retry loops/scripted abuse, sustained protects against
steady-state hammering. Do not raise the per-IP limits
(`RATE_LIMIT_SENSITIVE_IP_*`) to work around a single noisy identity; that
weakens the exact protection meant to catch credential stuffing.

## The audit trail

- `AuditService.log(actor, action, target, metadata, requestId)` — appends an
  entry. There is no update path; entries are immutable once written (an
  in-memory copy is always kept, with best-effort persistence to the
  `admin_audit_logs` Supabase table).
- Read/export: `GET /admin/audit`, `GET /admin/audit/export` (CSV).
- Retention: `DELETE /admin/audit/retention` permanently deletes entries
  older than 90 days. This is the only delete path, is itself
  `@SensitiveMutation`-tagged (rate-limited + audited), and requires the
  `admin` API key scope.

**All three `/admin/audit/*` routes require an API key with the `admin`
scope** (`@RequireScopes('admin')` + `ApiKeyGuard`), the same pattern used by
`JobAdminController` and other admin surfaces in this codebase.

### Known limitation — read before relying on this in production

`ApiKeyGuard` treats a request with **no API key header at all** as public
and lets it through (see `api-key.guard.unit.spec.ts`,
`"should allow public access when no API key is provided"`). This is a
pre-existing, intentional-but-permissive design used across every
`@RequireScopes(...)`-protected route in this codebase, not something
introduced here — `@RequireScopes('admin')` only rejects requests that
present an *invalid or insufficiently-scoped* key; it does not require a key
to be present.

For production deployments where the audit trail (or any other admin route)
must not be reachable at all without credentials, put these routes behind
network-level access control (VPN, IP allowlist, or an API gateway that
requires the key) in addition to the application-level scope check. Fixing
`ApiKeyGuard` itself to require a key whenever scopes are declared would be a
larger, cross-cutting change affecting every admin route in the app — file a
follow-up if you want that tightened.

## Testing

`test/rbac.e2e-spec.ts` covers: per-user throttling on `sensitive` routes,
the independent per-IP throttling (one IP cycling through many identities),
the anomaly audit log on a tripped limit, and admin-scope enforcement on the
audit endpoints. `src/auth/guards/custom-throttler.guard.unit.spec.ts` covers
the guard's group/window resolution in isolation.
