# Developer Guide & System Architecture
## StudioConnect AI - Enterprise Voice Platform

**Version:** 5.0  
**Last Updated:** [Current Date]
**Purpose:** Technical implementation guide and architectural reference for the enterprise-grade, "bulletproof" AI voice platform.

---

## Table of Contents

1. [The Bulletproof Philosophy](#1-the-bulletproof-philosophy)
2. [Project Overview](#2-project-overview)
3. [System Architecture](#3-system-architecture)
4. [Core Services & Components](#4-core-services--components)
5. [Project Management Integrations](#5-project-management-integrations)
6. [Development Setup](#6-development-setup)
7. [API Documentation](#7-api-documentation)
8. [Database Schema](#8-database-schema)
9. [Deployment Guide](#9-deployment-guide)
10. [Security Considerations](#10-security-considerations)
11. [Testing Strategy](#11-testing-strategy)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. The Bulletproof Philosophy

Our system has evolved to meet enterprise demands, adopting a "bulletproof" engineering philosophy. This approach prioritizes reliability, resilience, and professional-grade quality in every component. All new development should adhere to these principles.

### Core Tenets:
- **Design for Failure**: Assume external services can and will fail. Implement robust fallback mechanisms for all critical dependencies. The prime example is our **multi-provider TTS engine** (`ElevenLabs` -> `OpenAI` -> `Polly`), ensuring we can always generate voice responses.
- **Configuration over Code**: Abstract key logic and settings into a centralized configuration file (`src/config/enterpriseDefaults.ts`). This allows for rapid tuning of system behavior (e.g., VAD thresholds, TTS provider settings, retry logic) without changing code. Functions like `getEnterpriseVADSettings()` should be used to retrieve these settings.
- **Build Resilient Clients**: When interacting with external APIs, build clients that can handle failure gracefully. The `BulletproofElevenLabsClient` is our standard, featuring:
    - **Circuit Breakers**: To stop sending requests to a failing service.
    - **Exponential Backoff**: To intelligently retry failed requests.
    - **Health & Quality Monitoring**: To proactively detect service degradation.
- **Guard the User Experience**: The user experience must be professional at all times. This means aggressively filtering out "phantom speech" from noisy audio feeds using our `getEnterprisePhantomFilter` settings to prevent the AI from responding to non-speech sounds.
- **Enterprise-Grade Logging**: Use descriptive and structured logs (e.g., `[🎯 BULLETPROOF VAD] Calibrated...`) to provide clear insight into system behavior, especially in production environments.

---

## 2. Project Overview

The StudioConnect AI platform is an **enterprise-grade, voice-first AI communications system** designed for high-stakes business interactions. It provides a highly reliable, intelligent, and conversational AI agent that integrates deeply into business workflows.

### Key Technologies:

- **Runtime**: Node.js 20.x
- **Language**: TypeScript 5.x
- **Framework**: Express.js 4.x with `ws` for WebSockets
- **Database**: PostgreSQL 15+ with `pgvector`
- **Session Store / Caching**: Redis
- **ORM**: Prisma 5.x
- **AI**: OpenAI (GPT-4 for language, Whisper for transcription), Multi-provider TTS
- **Primary TTS**: ElevenLabs (via `BulletproofElevenLabsClient`)
- **Voice**: Twilio Media Streams
- **Authentication**: JWT
- **Frontend Dashboard**: Next.js 14 App Router
- **Containerization**: Docker & Docker Compose

### Major System Features:
1.  **Bulletproof Voice Agent**: A highly resilient voice agent with multi-provider fallbacks, advanced VAD, and enterprise-grade error recovery.
2.  **Intelligent Lead Qualification**: A dynamic, configuration-driven engine for qualifying new leads over the phone, including urgency detection and automated escalation.
3.  **Deep Project Management Integrations**: Secure, OAuth 2.0-based, bi-directional synchronization with Jira, Asana, and Monday.com.
4.  **Configuration-Driven Behavior**: Centralized management of system settings for performance, reliability, and voice characteristics.

---

## 3. System Architecture

The architecture is designed for scalability and resilience, with clear separation of concerns.

```
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│   SMB Website   │   │ Voice Callers   │   │ Admin Dashboard │
│   (widget.js)   │   │(Twilio Media)   │   │  (Next.js App)  │
└────────┬────────┘   └────────┬────────┘   └────────┬────────┘
         │                     │                     │
         │ HTTPS               │ WebSocket (WSS)     │ HTTPS
         │                     │                     │
         ▼                     ▼                     ▼
┌──────────────────────────────────────────────────────────────────┐
│             StudioConnect AI Backend (Express.js)                │
│ ┌──────────────────┐ ┌──────────────────┐ ┌─────────────────────┐ │
│ │   REST API /     │ │ WebSocket Server │ │      Admin API      │ │
│ │  Webhook Handler │ │(ws) for Twilio   │ │ (for Next.js dash)  │ │
│ └────────┬─────────┘ └────────┬─────────┘ └──────────┬──────────┘ │
│          │                    │                      │            │
│ ┌────────▼────────────────────▼──────────────────────▼───────────┐ │
│ │                Core Services & Business Logic                  │ │
│ │ ┌────────────────┐ ┌────────────────┐ ┌───────────────────────┐ │ │
│ │ │ Realtime Agent │ │ Lead Qualifier │ │ PM Integration Service│ │ │
│ │ │ Service (Voice)│ │   (Dynamic)    │ │(Asana, Jira, Monday)  │ │ │
│ │ └───────┬────────┘ └───────┬────────┘ └───────────┬───────────┘ │ │
│ └─────────│──────────────────│───────────────────────│───────────┘ │
└───────────│──────────────────│───────────────────────│─────────────┘
      ┌─────▼─────┐      ┌─────▼─────┐           ┌─────▼─────┐
┌─────┴─────┐┌────┴───────────┐┌─────┴─────┐┌─────┴─────┐┌─────┴─────┐
│ PostgreSQL││     Redis      ││  OpenAI   ││ ElevenLabs││   Twilio  │
│(pgvector) ││(Cache/Session) ││(GPT/Whisper)││ (TTS)     ││(PSTN/Voice)│
└───────────┘└────────────────┘└───────────┘└───────────┘└───────────┘
```
---

## 4. Core Services & Components

This section outlines the key services that form the backbone of the application.

### `RealtimeAgentService`
-   **Location**: `src/services/realtimeAgentService.ts`
-   **Description**: This is the master orchestrator for all voice calls. It manages the WebSocket connection from Twilio, interfaces with all other services to handle the call logic, and implements the "bulletproof" philosophy.
-   **Key Responsibilities**:
    -   Handling the Twilio media stream (`start`, `media`, `stop` events).
    -   Applying enterprise VAD and phantom speech filtering.
    -   Invoking the `LeadQualifier` for new callers.
    -   Managing the conversation history and passing it to the AI handler.
    -   Orchestrating the multi-provider TTS engine to generate and stream audio responses.
    -   Handling barge-in detection and recovery.

### `LeadQualifier`
-   **Location**: `src/core/leadQualifier.ts`
-   **Description**: A state machine that guides new callers through a dynamic set of qualification questions.
-   **Key Responsibilities**:
    -   Loading an ordered set of questions from the database for a business.
    -   Generating professional, conversational prompts for each question.
    -   Validating user answers against expected formats.
    -   Detecting urgency in responses to flag leads for immediate escalation.
    -   Returning a structured set of answers upon completion.

### `ProjectManagementProvider` Interface
-   **Location**: `src/services/pm-providers/pm.provider.interface.ts`
-   **Description**: Defines the contract for all project management tool integrations. This abstraction allows for easy extension to new platforms.
-   **Key Methods**: `connect`, `syncProjects`, `setupWebhooks`, `handleWebhook`, `normalizeData`.
-   **Implementations**: `jira.provider.ts`, `asana.provider.ts`, `monday.provider.ts`.

### `BulletproofElevenLabsClient`
-   **Location**: `src/services/elevenlabsStreamingClient.ts`
-   **Description**: Our enterprise-grade client for interacting with the ElevenLabs streaming TTS API. This is a reference implementation for how to build resilient clients.
-   **Key Features**:
    -   Manages the WebSocket lifecycle.
    -   Implements a circuit breaker to avoid hitting a failing service repeatedly.
    -   Uses exponential backoff with jitter for intelligent retries.
    -   Includes continuous health and quality monitoring.

---

## 5. Project Management Integrations

The platform uses a provider-based architecture to integrate with PM tools. This ensures modularity and maintainability.

### Architecture
-   **Interface**: All providers implement `ProjectManagementProvider`.
-   **Authentication**: We use a per-business **OAuth 2.0** flow for all providers, which is more secure and robust than API tokens. The system handles the entire token lifecycle, including refresh tokens.
-   **Data Flow**:
    1.  **Connect**: Admin initiates OAuth flow from the dashboard.
    2.  **Sync**: `syncProjects` is called to perform an initial one-way sync of all projects/tasks into our local database. This provides a fast cache for the AI.
    3.  **Real-time Updates**: `setupWebhooks` is called to register a webhook, enabling real-time updates from the PM tool. `handleWebhook` processes these events.
-   **Normalization**: Each provider's `normalizeData` function is crucial. It translates the provider's unique data structure into our unified `Project` model.

### Adding a New Provider
1.  Create `<new_provider>.provider.ts` in `src/services/pm-providers/`.
2.  Implement all methods from the `ProjectManagementProvider` interface.
3.  Add the necessary environment variables to `src/config/providerEnv.ts` and the main `.env.example`.
4.  Register the new provider in the integration service to make it available in the dashboard.

---

## 6. Development Setup

### Environment Variables
Create a `.env` file from `.env.example` and fill in the required values.

```bash
# .env.example

#-- Core Application --#
PORT=3000
NODE_ENV=development
HOST="localhost:3000" # Your public-facing host for webhooks

#-- Database & Cache --#
DATABASE_URL="postgresql://user:password@localhost:5433/database_name?schema=public"
REDIS_URL="redis://localhost:6379"

#-- Core Services --#
JWT_SECRET="a-very-strong-secret-key"
FROM_EMAIL="noreply@studioconnect.ai" # For sending lead notifications
SENDGRID_API_KEY="" # Optional, if using SendGrid for email

#-- Twilio (Voice) --#
TWILIO_ACCOUNT_SID=""
TWILIO_AUTH_TOKEN=""
TWILIO_PHONE_NUMBER="" # The Twilio number clients will call

#-- OpenAI (AI Language Model & Transcription) --#
OPENAI_API_KEY=""

#-- ElevenLabs (Primary TTS Provider) --#
ELEVENLABS_API_KEY=""
ELEVENLABS_VOICE_ID="pNInz6obpgDQGcFmaJgB" # Default: Rachel (professional female)
ELEVENLABS_MODEL_ID="eleven_turbo_v2_5"

#-- Project Management Integrations (OAuth Credentials) --#
# Asana
ASANA_CLIENT_ID=""
ASANA_CLIENT_SECRET=""

# Jira
JIRA_CLIENT_ID=""
JIRA_CLIENT_SECRET=""

# Monday.com
MONDAY_CLIENT_ID=""
MONDAY_CLIENT_SECRET=""

#-- Development Flags --#
# Set to true to seed the database with mock project data on startup
SEED_MOCK_PROJECTS=false
```

### Database Setup
1.  Ensure you have Docker and Docker Compose installed.
2.  Run `docker-compose up -d` to start the PostgreSQL and Redis containers.
3.  Run `npx prisma migrate dev` to apply database migrations and create the schema.
4.  (Optional) Run `npx prisma db seed` to run the seed script if one is configured.

### Running the Application
```bash
# Install dependencies
npm install

# Run the development server
npm run dev
```

### Development Scripts
-   `npm run dev`: Starts the server with `nodemon` for auto-reloading.
-   `npm run build`: Compiles the TypeScript code to JavaScript.
-   `npm start`: Starts the compiled application (for production).
-   `npm test`: Runs the Jest test suite.
-   `npx ts-node scripts/seedAdmin.ts`: Creates a default admin user and business.
-   `npx ts-node scripts/seedMockProjects.ts`: Seeds the database with mock project data for a business (requires a business ID).
-   `npx ts-node scripts/stressTest.ts`: Runs a load test against the voice endpoints.

---
## 7. API Documentation
The REST API is the primary interface for the frontend dashboard. All endpoints are protected by JWT-based authentication. Refer to the route definitions in `src/api/` for a complete list of endpoints and their functionality. Key route files include:
// ... existing code ...
-   `src/api/voiceRoutes.ts`.
-   `src/api/integrationRoutes.ts`: For managing PM tool connections.

---

## 8. Core Services
// ... existing code ...
This section describes the key services that implement the core business logic of the platform.

### 14.1 Real-time Agent Service (`realtimeAgentService.ts`)

This is the heart of the voice integration. It manages the real-time, bidirectional communication between Twilio and the OpenAI Real-time API. It handles setting up the WebSocket connections, managing the session, and streaming audio data.

### 14.2 Voice Session Service (`voiceSessionService.ts`)
// ... existing code ...
This service manages the lifecycle of a voice call session. It tracks the state of the call, stores the transcript, and logs events related to the call.

### 14.3 Notification Service (`notificationService.ts`)

Handles all outbound notifications, including emails for lead summaries and alerts. It uses Nodemailer and can be configured with different transport options like SendGrid.

### 14.4 OpenAI Service (`openai.ts`)
// ... existing code ...
A wrapper around the OpenAI client library. It provides convenient methods for interacting with OpenAI's APIs, including chat completions and other AI functionalities.

### 14.5 WebSocket Server (`websocketServer.ts`)

This service sets up and manages the WebSocket server that listens for connections from Twilio Media Streams. It's the entry point for all real-time voice communication.

### 14.6 Database Service (`db.ts`)

Provides a singleton instance of the Prisma client for database interactions.

## 15. Development Setup
// ... existing code ...
## Emergency Handling System

### Emergency Detection and Response Flow

1. **Initial Detection**
// ... existing code ...
   - Keywords and context analysis, powered by `LeadQualifier`.

2. **Customer Experience**
   ```
// ... existing code ...
   Emergency Detection
   ↓
   Severity Assessment
// ... existing code ...
   ↓
   High Severity (URGENT flag):
     → Offer Options:
       1. Immediate Connection (30s)
// ... existing code ...
       2. Quick Info Gathering
   ↓
   Based on Choice:
// ... existing code ...
     A. Immediate Connection
        → Emergency Team Transfer
        → Confirmation Message
     
// ... existing code ...
     B. Info Gathering
        → Essential Questions:
// ... existing code ...
           - Address/Location
           - Name
           - Phone
// ... existing code ...
           - Emergency Details
        → Lead Processing
        → Business Notification
   ```
// ... existing code ...
# Project Management Integrations

**Version:** 2.0  
**Status:** Implemented  
**Last Updated:** [Current Date]

## 1. Overview
// ... existing code ...
This section documents the one-way data sync from client PM tools (Asana, Jira, Monday.com) into StudioConnect AI, giving the agent real-time project context.  The design is modular and easily extensible for new providers.

## 2. Core Architecture
// ... existing code ...
All provider logic lives behind a common interface, keeping the core application agnostic of third-party specifics.

### 2.1 Directory Structure
```text
// ... existing code ...
src/
└── services/
    └── pm-providers/
        ├── pm.provider.interface.ts  // Contract for providers
// ... existing code ...
        ├── asana.provider.ts         // Asana implementation
        ├── jira.provider.ts          // Jira implementation
        └── monday.provider.ts        // Monday.com implementation
```

### 2.2 `ProjectManagementProvider` Interface
```typescript
// src/services/pm-providers/pm.provider.interface.ts
export interface ProjectManagementProvider {
  /** Validate credentials & establish a connection using OAuth 2.0 */
  connect(credentials: Record<string, any>): Promise<boolean>

  /** One-way initial sync of all projects/tasks */
// ... existing code ...
  syncProjects(businessId: string): Promise<{ projectCount: number; taskCount: number }>

  /** Create provider-specific webhooks */
// ... existing code ...
  setupWebhooks(businessId: string): Promise<{ webhookId: string }>

  /** Handle incoming webhook payloads */
  handleWebhook(payload: any, businessId: string): Promise<void>

  /** Translate provider data to internal Project model */
  normalizeData(providerData: any, businessId: string): Partial<Project>
}
```

### 2.3 Data Normalisation & Storage
// ... existing code ...
Each provider maps external structures to our `Project` schema (Prisma).  Primary key mapping is `pmToolId`; status fields map to `status`.

### 2.4 Webhook Handling
// ... existing code ...
All PM webhooks post to `POST /api/webhooks/pm/:provider`.
1. Controller identifies provider and loads implementation.
2. Request authenticity validated (signatures, tokens, etc.).
3. Delegates to `handleWebhook` for upserts.

---

## 3. Provider Implementations

### 3.1 AsanaProvider (`asana.provider.ts`)
• Auth: OAuth 2.0
• Initial sync via `searchTasksInWorkspace`.  Pagination handled via `offset`.
• Webhooks created with `POST /api/1.0/webhooks`, handshake via `X-Hook-Secret`.
• Payload validation using `X-Hook-Signature`.

### 3.2 JiraProvider (`jira.provider.ts`)
• Auth: OAuth 2.0 (with automatic token refresh)
• Initial sync via `GET /rest/api/3/search` with JQL.
• Webhooks via `POST /rest/api/3/webhook` subscribing to `jira:issue_*` events.
• Optional URL token for authenticity.

### 3.3 MondayProvider (`monday.provider.ts`)
• Auth: OAuth 2.0
• Initial sync uses GraphQL `boards` & `items_page` queries with cursor pagination.
• Webhooks via `create_webhook` mutation and challenge-response handshake.

---

## 4. Future Providers
// ... existing code ...
Implementing a new provider involves:
1. Creating `<tool>.provider.ts` in `pm-providers`.
2. Implementing all methods from the interface.
3. Registering the provider in the factory used by the webhook controller.