# OAuth Migration Guide (Jira Cloud, Asana, Monday.com)

> Goal: replace PAT/API-key authentication with secure OAuth 2.0 (+ PKCE) for all project-management integrations.

## 0. Prerequisites
- `APP_BASE_URL` env set (e.g. `https://app.studioconnect.ai`)
- Redis enabled for temporary state storage
- Prisma >= v6.9 generated

---

## 1. Provider Application Setup

| Provider | Console URL | Key Steps |
|----------|-------------|-----------|
| **Jira Cloud** | <https://developer.atlassian.com/console> | 1. Create **OAuth 2.0 (3LO)** app.<br>2. Add redirect URI: `APP_BASE_URL/api/integrations/jira/oauth-callback`.<br>3. Copy **Client ID** & **Secret**. |
| **Asana** | <https://app.asana.com/0/my-apps> | 1. Create new app, OAuth tab.<br>2. Redirect URI: `APP_BASE_URL/api/integrations/asana/oauth-callback`.<br>3. Copy **Client ID** & **Secret**. |
| **Monday.com** | <https://auth.monday.com/apps> | 1. Create app, OAuth 2.0 section.<br>2. Redirect URI: `APP_BASE_URL/api/integrations/monday/oauth-callback`.<br>3. Copy **Client ID** & **Secret**. |

Store secrets in `.env`:
```bash
JIRA_CLIENT_ID=...
JIRA_CLIENT_SECRET=...
ASANA_CLIENT_ID=...
ASANA_CLIENT_SECRET=...
MONDAY_CLIENT_ID=...
MONDAY_CLIENT_SECRET=...
```

---

## 2. Backend Implementation

### 2.1 Route structure
```text
/api/integrations/:provider/oauth-start     → redirects user → providerAuthURL
/api/integrations/:provider/oauth-callback  → exchanges `code` → access/refresh tokens
```

### 2.2 oauth-start (GET)
1. `provider` param validation (`JIRA|ASANA|MONDAY`).
2. Generate `state = crypto.randomUUID()`.
3. `challenge,verifier = pkceChallenge()` (PKCE helper).
4. Store `{state,verifier,businessId}` in Redis (TTL = 10 min).
5. Redirect to provider auth URL with:
   - `client_id`
   - `redirect_uri`
   - `response_type=code`
   - `scope=...` (minimal read scopes)
   - `state`
   - `code_challenge`
   - `code_challenge_method=S256`

### 2.3 oauth-callback (GET)
1. Validate `state` against Redis; fetch `verifier`.
2. POST provider *token endpoint* with `{code,client_id,client_secret,code_verifier,redirect_uri}`.
3. Parse `{access_token,refresh_token,expires_in}`.
4. `integrationService.upsertToken(businessId, provider, tokens)`:
   ```ts
   prisma.integration.upsert({
     where: { businessId_provider: { businessId, provider } },
     create: { businessId, provider, accessToken, refreshToken, expiresAt, syncStatus: 'CONNECTED', isEnabled: true },
     update: { accessToken, refreshToken, expiresAt, syncStatus: 'CONNECTED', isEnabled: true, updatedAt: new Date() }
   })
   ```
5. Trigger `provider.syncProjects(businessId)` (initial import).
6. Redirect dashboard → `/integrations?connected=provider`.

### 2.4 Token refresh helper
- Add `refreshAccessToken(providerKey,businessId)` to `integrationService`.
- Cron job every 10 min selects tokens expiring < 5 min and refreshes.

---

## 3. Prisma Schema Patch
```prisma
model Integration {
  businessId   String
  provider     String
  accessToken  String?
  refreshToken String?
  expiresAt    DateTime?
  ...
}
```
Run: `npx prisma migrate dev -n add_oauth_tokens_to_integration`.

---

## 4. Provider Adapters (pm-providers/*)
- `connect()` now accepts `{ accessToken, refreshToken, expiresAt, businessId }` (no PATs).
- Implement refresh logic if SDKs available; else reuse IntegrationService helper.

---

## 5. Dashboard UI Updates
1. Replace manual key dialogs with **Connect via OAuth** button:
   ```tsx
   <Button asChild>
     <a href={`/api/integrations/${prov.toLowerCase()}/oauth-start`}>Connect via OAuth</a>
   </Button>
   ```
2. Handle `?connected=PROVIDER` query to show success toast.

---

## 6. Security Considerations
- PKCE for all flows (even confidential clients) to mitigate intercepted codes.
- HTTPS enforced on callback routes.
- Store tokens encrypted at rest (field-level encryption key via env `INTEGRATION_KMS_KEY`).
- Redis state TTL ≤ 10 min + single-use deletion.
- Rate-limit auth routes (express-rate-limit).

---

## 7. Testing Matrix
| Scenario | Tool | Notes |
|----------|------|-------|
| Happy-path auth | Cypress | Verify redirect & DB insert |
| State mismatch | Supertest | Expect 400 |
| Token refresh | Jest + nock | Mock 401 then refresh |
| Permission revocation | Cypress | SyncStatus → `ERROR` |

---

## 8. Roll-out Checklist
1. Merge schema & deploy DB migration.
2. Deploy backend with new routes.
3. Update dashboard code & release.
4. Prepare migration script to mark legacy PAT integrations `isEnabled=false` & prompt reconnect.
5. Email agencies about OAuth upgrade & deprecation timeline.

---

**Done — StudioConnect AI integrations will now use modern OAuth 2.0 for secure, revocable access.** 