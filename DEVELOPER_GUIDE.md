# Developer Guide & System Architecture
## StudioConnect AI - Enterprise Voice Platform

**Version:** 6.0  
**Last Updated:** June 2025
**Purpose:** Technical implementation guide and architectural reference for the ElevenLabs Conversational AI integrated platform.

---

## Table of Contents

1. [ElevenLabs Integration Architecture](#1-elevenlabs-integration-architecture)
2. [Project Overview](#2-project-overview)
3. [System Architecture](#3-system-architecture)
4. [Core Services & Components](#4-core-services--components)
5. [Multi-Tenant Voice Configuration](#5-multi-tenant-voice-configuration)
6. [Project Management Integrations](#6-project-management-integrations)
7. [Development Setup](#7-development-setup)
8. [API Documentation](#8-api-documentation)
9. [Database Schema](#9-database-schema)
10. [Deployment Guide](#10-deployment-guide)
11. [Security Considerations](#11-security-considerations)
12. [Testing Strategy](#12-testing-strategy)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. ElevenLabs Integration Architecture

Our system has evolved from a custom voice pipeline to leverage **ElevenLabs Conversational AI platform** as the primary voice infrastructure. This provides enterprise-grade reliability, natural conversation capabilities, and significant cost savings.

### Key Benefits:
- **Enterprise Reliability**: Built-in support for thousands of concurrent calls with 99.9% uptime
- **Natural Conversations**: Advanced turn-taking models eliminate complex custom audio processing
- **Multi-Tenant Support**: Dynamic agent personalization via webhook integration
- **Reduced Infrastructure**: Eliminates need for custom VAD, STT, TTS, and turn-taking logic
- **Premium Voice Quality**: Access to 5k+ voices across 31 languages
- **Cost Efficiency**: $0.08/minute on business plan vs. custom infrastructure maintenance

### Core Architecture Principles:
- **Webhook-Driven Personalization**: Each business gets custom voice agents configured via real-time webhooks
- **Configuration over Code**: Business settings drive conversation behavior without code changes
- **Database Integration**: ElevenLabs conversations logged to StudioConnect database for analytics
- **Seamless Fallbacks**: Integration with existing OpenAI services for complex queries

---

## 2. Project Overview

The StudioConnect AI platform is an **enterprise-grade, voice-first AI communications system** designed for high-stakes business interactions. It leverages ElevenLabs Conversational AI platform to provide professional, reliable, and intelligent voice agents that integrate deeply into business workflows.

### Key Technologies:

- **Runtime**: Node.js 20.x
- **Language**: TypeScript 5.x
- **Framework**: Express.js 4.x with webhook integrations
- **Database**: PostgreSQL 15+ with `pgvector`
- **Session Store / Caching**: Redis
- **ORM**: Prisma 5.x
- **Primary Voice Platform**: ElevenLabs Conversational AI
- **AI Language Models**: OpenAI GPT-4, Claude, Gemini (via ElevenLabs)
- **Voice Infrastructure**: Twilio + ElevenLabs native integration
- **Authentication**: JWT
- **Frontend Dashboard**: Next.js 14 App Router
- **Containerization**: Docker & Docker Compose

### Major System Features:
1. **ElevenLabs Conversational AI Integration**: Native voice platform with webhook personalization
2. **Multi-Tenant Voice Configuration**: Dynamic agent settings per business
3. **Intelligent Client Recognition**: Existing clients receive personalized greetings
4. **Deep Project Management Integrations**: OAuth 2.0-based synchronization with Jira, Asana, Monday.com
5. **Professional Call Transfer**: Seamless escalation to human team members

---

## 3. System Architecture

The architecture leverages ElevenLabs as the primary voice platform with webhook-driven personalization.

```
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│   SMB Website   │   │ Voice Callers   │   │ Admin Dashboard │
│   (widget.js)   │   │(Twilio->11Labs) │   │  (Next.js App)  │
└────────┬────────┘   └────────┬────────┘   └────────┬────────┘
         │                     │                     │
         │ HTTPS               │ ElevenLabs Agent    │ HTTPS
         │                     │                     │
         ▼                     ▼                     ▼
┌──────────────────────────────────────────────────────────────────┐
│           StudioConnect AI Backend (Express.js)                  │
│ ┌──────────────────┐ ┌──────────────────┐ ┌─────────────────────┐ │
│ │   REST API /     │ │ Webhook Handlers │ │      Admin API      │ │
│ │  Chat Widget     │ │(ElevenLabs Call  │ │ (for Next.js dash)  │ │
│ │                  │ │ Personalization) │ │                     │ │
│ └────────┬─────────┘ └────────┬─────────┘ └──────────┬──────────┘ │
│          │                    │                      │            │
│ ┌────────▼────────────────────▼──────────────────────▼───────────┐ │
│ │              Business Logic & Configuration                    │ │
│ │ ┌────────────────┐ ┌────────────────┐ ┌───────────────────────┐ │ │
│ │ │ElevenLabs Agent│ │ Lead Qualifier │ │ PM Integration Service│ │ │
│ │ │   Manager      │ │   (Dynamic)    │ │(Asana, Jira, Monday)  │ │ │
│ │ └───────┬────────┘ └───────┬────────┘ └───────────┬───────────┘ │ │
│ └─────────│──────────────────│───────────────────────│───────────┘ │
└───────────│──────────────────│───────────────────────│─────────────┘
            │                  │                       │
      ┌─────▼─────┐      ┌─────▼─────┐           ┌─────▼─────┐
┌─────┴─────┐┌────┴───────────┐┌─────┴─────┐┌─────┴─────┐┌─────┴─────┐
│ PostgreSQL││     Redis      ││ElevenLabs ││   OpenAI  ││   Twilio  │
│(Business  ││(Cache/Session) ││Conversational││(Analysis) ││(Phone #s) │
│ Config)   ││                ││    AI     ││           ││           │
└───────────┘└────────────────┘└───────────┘└───────────┘└───────────┘
```

### ElevenLabs Integration Flow
1. **Client calls Twilio number** → Twilio routes to configured ElevenLabs agent
2. **ElevenLabs agent initiated** → Webhook calls `/api/voice/elevenlabs-personalization`
3. **Webhook returns configuration** → Business-specific welcome message, voice, system prompt
4. **Personalized conversation** → ElevenLabs handles all voice processing
5. **Call completion** → Conversation events logged to StudioConnect database

---

## 4. Core Services & Components

This section outlines the key services that support the ElevenLabs integration.

### `ElevenLabsConversationalAgent`
- **Location**: `src/services/elevenlabsConversationalAgent.ts`
- **Description**: Manages ElevenLabs agent creation, configuration, and webhook handling
- **Key Responsibilities**:
  - Creating and configuring ElevenLabs agents via API
  - Handling webhook personalization requests
  - Loading business-specific configuration from database
  - Managing conversation logging and call summaries

### Multi-Tenant Webhook Handler
- **Location**: `src/api/voiceRoutes.ts` → `/elevenlabs-personalization`
- **Description**: Provides dynamic agent configuration based on business settings
- **Key Responsibilities**:
  - Identifying business by called phone number
  - Loading custom welcome messages and system prompts
  - Selecting appropriate voice based on client type
  - Returning ElevenLabs-compatible configuration object

### `AgentConfig` Database Integration
- **Location**: Prisma schema + business configuration
- **Description**: Stores business-specific voice agent settings
- **Key Fields**:
  - `elevenlabsAgentId`: Links to ElevenLabs agent
  - `elevenlabsVoice`: Custom voice selection
  - `personaPrompt`: Business-specific conversation style
  - `welcomeMessage`: Custom greeting per business

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

## 5. Multi-Tenant Voice Configuration

The platform supports complete customization of voice agents per business through ElevenLabs webhook personalization.

### Configuration Flow
1. **Business Setup**: Admin creates ElevenLabs agent via dashboard
2. **Webhook Configuration**: ElevenLabs agent configured with personalization webhook
3. **Real-time Personalization**: Each call triggers webhook to load business settings
4. **Dynamic Response**: Agent uses custom welcome message, voice, and conversation style

### Database Schema
```typescript
model AgentConfig {
  id                    String   @id @default(cuid())
  businessId            String   @unique
  elevenlabsAgentId     String?  // Links to ElevenLabs agent
  elevenlabsVoice       String?  // Custom voice selection
  personaPrompt         String   @default("Professional AI assistant...")
  welcomeMessage        String   @default("Hello! How can I help you today?")
  // ... other fields
}
```

### Webhook Personalization Response
```typescript
interface ElevenLabsPersonalizationResponse {
  first_message: string           // Custom welcome message
  system_prompt: string          // Business-specific conversation style  
  voice_id?: string              // Custom voice selection
  voice_settings?: VoiceSettings // Voice quality parameters
}
```

### Voice Selection Logic
- **New callers**: Bright, uplifting Hope voice for lead generation
- **Existing clients**: Empathetic Jessica voice for relationship management
- **Custom override**: Business can specify preferred voice in dashboard

---

## 6. Project Management Integrations

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

## 7. Development Setup

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
FROM_EMAIL="noreply@studioconnect.ai"
SENDGRID_API_KEY="" # For email notifications

#-- Twilio (Phone Numbers) --#
TWILIO_ACCOUNT_SID=""
TWILIO_AUTH_TOKEN=""
TWILIO_PHONE_NUMBER="" # The Twilio number clients will call

#-- ElevenLabs Conversational AI (Primary Voice Platform) --#
ELEVENLABS_API_KEY=""
ELEVENLABS_AGENT_ID="" # Default agent ID for new businesses

#-- OpenAI (Analysis & Complex Queries) --#
OPENAI_API_KEY=""

#-- Project Management Integrations --#
ASANA_CLIENT_ID=""
ASANA_CLIENT_SECRET=""
JIRA_CLIENT_ID=""
JIRA_CLIENT_SECRET=""
MONDAY_CLIENT_ID=""
MONDAY_CLIENT_SECRET=""
```

### Setup Steps

1. **Clone and Install**:
   ```bash
   git clone <repository-url>
   cd studioconnect-ai
   npm install
   ```

2. **Database Setup**:
   ```bash
   # Start local PostgreSQL and Redis
   docker-compose up -d db redis
   
   # Run migrations
   npx prisma migrate dev
   
   # Generate Prisma client
   npx prisma generate
   ```

3. **ElevenLabs Agent Setup**:
   ```bash
   # Create your first ElevenLabs agent
   npx ts-node src/scripts/setupElevenLabsAgent.ts <business-id>
   ```

4. **Dashboard Setup**:
```bash
   cd dashboard
npm install
   npm run build
   cd ..
   ```

5. **Start Development Server**:
   ```bash
npm run dev
```

### Development Workflow

1. **Voice Agent Testing**: Use ElevenLabs platform directly to test agent behavior
2. **Webhook Testing**: Use ngrok to expose local webhook endpoints
3. **Database Changes**: Always create Prisma migrations for schema updates
4. **Multi-Tenant Testing**: Create multiple businesses to test personalization

---

## 8. API Documentation

### ElevenLabs Integration Endpoints

#### POST `/api/voice/elevenlabs-personalization`
**Purpose**: Webhook endpoint for ElevenLabs agent personalization

**Request Body** (from ElevenLabs):
```json
{
  "caller_id": "+15551234567",
  "called_number": "+15559876543", 
  "agent_id": "conv_agent_123",
  "call_sid": "CA123..."
}
```

**Response**:
```json
{
  "first_message": "Hello! Thank you for calling Aurora Branding...",
  "system_prompt": "You are a professional AI assistant for Aurora Branding...",
  "voice_id": "kdmDKE6EkgrWrrykO9Qt",
  "voice_settings": {
    "stability": 0.45,
    "similarity_boost": 0.85,
    "style": 0.30
  }
}
```

#### POST `/api/voice/elevenlabs-events`
**Purpose**: Receive conversation events from ElevenLabs

**Request Body**:
```json
{
  "event_type": "conversation.completed",
  "conversation_id": "conv_123",
  "call_sid": "CA123...",
  "transcript": "...",
  "duration": 120
}
```

### Business Configuration Endpoints

#### GET `/api/businesses/:id/agent-config`
**Purpose**: Get current agent configuration for business

#### PUT `/api/businesses/:id/agent-config`
**Purpose**: Update agent configuration

**Request Body**:
```json
{
  "elevenlabsVoice": "kdmDKE6EkgrWrrykO9Qt",
  "welcomeMessage": "Hello! Welcome to our agency...",
  "personaPrompt": "You are a professional assistant..."
}
```

---

## 9. Database Schema

### Core Tables for ElevenLabs Integration

```sql
-- Agent configuration per business
CREATE TABLE "AgentConfig" (
  "id" TEXT PRIMARY KEY,
  "businessId" TEXT UNIQUE NOT NULL,
  "elevenlabsAgentId" TEXT, -- ElevenLabs agent ID
  "elevenlabsVoice" TEXT,   -- Custom voice selection
  "personaPrompt" TEXT DEFAULT 'Professional AI assistant',
  "welcomeMessage" TEXT DEFAULT 'Hello! How can I help you today?',
  -- ... other fields
);

-- Conversation logging for ElevenLabs calls
CREATE TABLE "Conversation" (
  "id" TEXT PRIMARY KEY,
  "businessId" TEXT NOT NULL,
  "sessionId" TEXT,
  "messages" JSONB,
  "clientId" TEXT,
  "phoneNumber" TEXT,
  "endedAt" TIMESTAMP,
  -- ... other fields
);

-- Call logs for analytics
CREATE TABLE "CallLog" (
  "callSid" TEXT PRIMARY KEY,
  "businessId" TEXT NOT NULL,
  "conversationId" TEXT,
  "from" TEXT NOT NULL,
  "to" TEXT NOT NULL,
  "source" TEXT DEFAULT 'elevenlabs',
  "type" TEXT DEFAULT 'VOICE',
  "direction" TEXT DEFAULT 'INBOUND',
  "status" TEXT,
  "content" TEXT,
  "metadata" JSONB
);
```

---

## 10. Deployment Guide

### Production Deployment with ElevenLabs

1. **ElevenLabs Agent Configuration**:
   - Create production ElevenLabs agents for each business
   - Configure webhook URLs to point to production endpoints
   - Set up agent authentication and override permissions

2. **Environment Configuration**:
   ```bash
   # Production .env
   NODE_ENV=production
   HOST="https://your-domain.com"
   ELEVENLABS_API_KEY="your-production-key"
   ```

3. **Webhook Security**:
   - Implement webhook signature verification
   - Use HTTPS for all webhook endpoints
   - Rate limit webhook endpoints

4. **Monitoring**:
   - Monitor ElevenLabs agent performance
   - Track webhook response times
   - Set up alerts for failed personalization requests

### Docker Deployment
```dockerfile
# Updated Dockerfile for ElevenLabs integration
FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npx prisma generate
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
```

---

## 11. Security Considerations

### ElevenLabs Integration Security

1. **API Key Management**:
   - Store ElevenLabs API keys in secure environment variables
   - Rotate keys regularly
   - Use separate keys for development and production

2. **Webhook Security**:
   - Implement request signature verification
   - Validate webhook source IP addresses
   - Rate limit webhook endpoints

3. **Agent Access Control**:
   - Enable authentication on ElevenLabs agents
   - Implement proper agent ID management
   - Monitor agent usage and costs

4. **Data Privacy**:
   - Log conversation data according to privacy policies
   - Implement data retention policies
   - Provide data deletion capabilities

---

## 12. Testing Strategy

### ElevenLabs Integration Testing

1. **Webhook Testing**:
   ```bash
   # Test personalization webhook
   curl -X POST http://localhost:3000/api/voice/elevenlabs-personalization \
     -H "Content-Type: application/json" \
     -d '{"caller_id":"+15551234567","called_number":"+15559876543"}'
   ```

2. **Agent Configuration Testing**:
   - Test agent creation via API
   - Verify webhook configuration
   - Test multi-tenant personalization

3. **Integration Testing**:
   - Test complete call flow end-to-end
   - Verify conversation logging
   - Test call analytics and reporting

### Testing Tools
- **Postman**: For API endpoint testing
- **ngrok**: For local webhook testing
- **ElevenLabs Dashboard**: For agent testing and monitoring

---

## 13. Troubleshooting

### Common ElevenLabs Integration Issues

1. **Webhook Not Called**:
   - Verify ElevenLabs agent webhook configuration
   - Check webhook URL accessibility
   - Validate webhook endpoint authentication

2. **Personalization Not Applied**:
   - Check webhook response format
   - Verify business configuration in database
   - Test webhook endpoint manually

3. **Voice Quality Issues**:
   - Verify voice ID validity
   - Check voice settings parameters
   - Test with different premium voices

4. **Call Logging Failures**:
   - Check database connection
   - Verify Prisma schema is up to date
   - Monitor conversation event webhook

### Debug Commands
```bash
# Check ElevenLabs agent status
curl -H "xi-api-key: $ELEVENLABS_API_KEY" \
  "https://api.elevenlabs.io/v1/conversational-ai/agents"

# Test webhook personalization
npm run test:webhook

# Monitor conversation logs
npx prisma studio
```

### Performance Monitoring
- **ElevenLabs Dashboard**: Monitor agent performance and usage
- **Application Logs**: Track webhook response times and errors
- **Database Metrics**: Monitor conversation logging performance
- **Cost Tracking**: Monitor ElevenLabs usage and costs per business