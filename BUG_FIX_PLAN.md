# StudioConnect AI - Bug Fix and Refactoring Plan

This document outlines the strategy for resolving critical bugs affecting the dashboard, integrations, and application stability.

---

## 1. Fix Dashboard, Interactions & Agent Settings Pages Loading Issues

**Problem:** Multiple key pages in the dashboard (`/dashboard`, `/interactions`, `/agent-settings`) are failing to load, showing a perpetual loading state. The browser console shows a `404 Not Found` error for a `/api/me` endpoint and a server-side `PrismaClientValidationError`.

**Analysis:**

1.  **404 Error on `/api/me`:** The consistent 404 error on a "me" endpoint across all failing pages suggests a core data-fetching or authentication middleware problem. The request for user data is failing, which prevents the pages from rendering. An inspection of the codebase reveals two potentially conflicting endpoints: `dashboard/app/api/me/route.ts` and `dashboard/app/api/auth/me/route.ts`. This ambiguity is likely causing routing failures.
2.  **Prisma Aggregation Error:** The server logs show a `PrismaClientValidationError` on `prisma.callLog.aggregate()`. The query is incorrectly attempting to use `_sum` on a `metadata` field, which is not a numeric type and cannot be aggregated this way. This specific error is breaking the main dashboard page's data-loading mechanism.

**Plan:**

1.  **Consolidate and Fix "Me" Endpoint:**
    *   **Action:** Determine the correct "me" endpoint. It appears `dashboard/app/api/auth/me/route.ts` is the intended one. Delete the unused or incorrect `dashboard/app/api/me/route.ts` to remove ambiguity.
    *   **Verification:** Ensure all frontend components that fetch user data are calling the correct, consolidated endpoint: `GET /api/auth/me`.
    *   **Middleware Check:** Review `dashboard/middleware.ts` to ensure it correctly handles authentication and allows requests to `/api/auth/me` to pass through for authenticated users.

2.  **Correct Prisma `callLog` Aggregation Query:**
    *   **Action:** Locate the failing query in `dashboard/lib/dashboard-stats.ts`.
    *   **Problem:** The code `_sum: { metadata: true }` is invalid. The goal is likely to sum call durations, which are not stored in a dedicated numeric field.
    *   **Solution:**
        1.  Fetch the `callLog` records without the invalid aggregation.
        2.  Iterate through the results in TypeScript.
        3.  For each record, safely access the duration from the `metadata` JSON object (e.g., `record.metadata?.durationInSeconds || 0`).
        4.  Sum these values manually to get the total duration.
    *   **Refactoring:** This approach fixes the immediate error and is more robust than a complex raw query, as it handles cases where the duration might be missing from the metadata.

---

## 2. Fix Project Management & OAuth Integrations

**Problem:** The project management integrations (Asana, Jira, Monday.com) and the underlying OAuth flows are not working reliably.

**Analysis:** The current implementation may have inconsistencies in handling the OAuth lifecycle (token acquisition, storage, refresh) for different providers. A robust, standardized approach is needed. The file `docs/oauth-migration.md` suggests a migration is or was planned, indicating known issues.

**Plan:**

1.  **Standardize the OAuth Flow:**
    *   **Action:** Refactor the integration logic to use a single, unified OAuth callback endpoint: `dashboard/app/api/integrations/[...slug]/route.ts`. The `slug` will determine the provider (e.g., `asana`, `jira`).
    *   **Implementation:** This route will handle the code-for-token exchange, fetch user identity from the provider, and securely store the `access_token`, `refresh_token`, and other relevant credentials in the `Integration` table.

2.  **Implement Secure Token Management:**
    *   **Action:** Ensure all tokens are stored securely in the database. While encryption-at-rest is handled by the DB, add an application-level encryption layer for the tokens before saving them to the `Integration` model.
    *   **Implementation:** Use a library like `crypto` in Node.js to encrypt tokens with a secret key stored in environment variables. Create utility functions `encryptToken()` and `decryptToken()` in `src/services/integrationService.ts`.

3.  **Create a Unified Provider Interface:**
    *   **Action:** Enforce the `PMProvider` interface defined in `src/services/pm-providers/pm.provider.interface.ts` across all provider implementations (`asana.provider.ts`, `jira.provider.ts`, etc.).
    *   **Implementation:** Each provider class must implement methods like `getProjectStatus(..)` and `createTicket(..)`. This abstraction will allow the voice agent and other services to interact with any PM tool through a consistent API provided by `integrationService.ts`.

4.  **Add Robust Error Handling and Token Refresh Logic:**
    *   **Action:** Implement a global error handler for API calls made by providers.
    *   **Implementation:** When an API call fails with a 401 Unauthorized error, the `integrationService` should automatically trigger the token refresh flow using the stored `refresh_token`. The refreshed tokens should be encrypted and saved, and the original API call should be retried.

---

## 3. Enable Editing of Notification Channel Settings

**Problem:** Users are unable to edit and save their notification channel preferences on the `/notifications` page.

**Analysis:** This is likely a client-side issue where the form's state is not correctly managed or the API call to update the settings is failing or not being triggered properly.

**Plan:**

1.  **Review Frontend Form Logic:**
    *   **Action:** Inspect the component at `dashboard/app/notifications/page.tsx`.
    *   **Implementation:** Trace the data flow from form input changes to the state. Ensure `react-hook-form` (or the chosen form library) is correctly configured. Verify that the `onSubmit` handler correctly formats the data and makes a `POST` or `PUT` request to the backend.

2.  **Verify Backend Endpoints:**
    *   **Action:** Examine the API routes `dashboard/app/api/business/notification-emails/route.ts` and `.../notification-phone/route.ts`.
    *   **Implementation:** Add comprehensive logging to these endpoints to see the incoming request body. Ensure the data is validated correctly and the `prisma.business.update()` call is successful. Return a clear success or error message to the client.

---

## 4. Resolve Redis Connection Errors

**Problem:** The application logs show Redis connection errors during local development.

**Analysis:** This typically stems from incorrect configuration in environment variables or issues with the Docker Compose setup for the Redis service.

**Plan:**

1.  **Verify Environment Configuration:**
    *   **Action:** Confirm that the `.env` file contains the correct `REDIS_URL` (or `REDIS_HOST` and `REDIS_PORT`).
    *   **Example:** `REDIS_URL=redis://localhost:6379`

2.  **Inspect Docker Compose Setup:**
    *   **Action:** Review `docker-compose.yml`.
    *   **Implementation:** Ensure a Redis service is defined and correctly configured. The application container must be on the same Docker network as the Redis container to communicate using the service name (e.g., `redis:6379`).

3.  **Add Graceful Connection Handling:**
    *   **Action:** Modify `src/config/redis.ts`.
    *   **Implementation:** Wrap the Redis client initialization in error handling to prevent crashes on startup if Redis is unavailable. Implement event listeners for `connect`, `error`, and `reconnecting` events to provide better logging and stability. 