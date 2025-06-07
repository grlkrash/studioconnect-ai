# Developer Guide & System Architecture
## AI Agent Assistant for SMBs - Voice-Enabled Multi-Channel Platform

**Version:** 4.0  
**Last Updated:** December 2024  
**Purpose:** Technical implementation guide and architectural reference for the voice-enabled, plan-tier based AI agent platform

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [System Architecture](#2-system-architecture)
3. [Voice Agent System](#3-voice-agent-system)
4. [Plan Tier Architecture](#4-plan-tier-architecture)
5. [Enhanced Emergency System](#5-enhanced-emergency-system)
6. [Session Management & Analytics](#6-session-management--analytics)
7. [Data Flows & User Journeys](#7-data-flows--user-journeys)
8. [Project Structure](#8-project-structure)
9. [Core Components](#9-core-components)
10. [Database Schema](#10-database-schema)
11. [API Documentation](#11-api-documentation)
12. [Development Setup](#12-development-setup)
13. [Deployment Guide](#13-deployment-guide)
14. [Security Considerations](#14-security-considerations)
15. [Testing Strategy](#15-testing-strategy)
16. [Troubleshooting](#16-troubleshooting)

---

## 1. Project Overview

The AI Agent Assistant for SMBs has evolved into a comprehensive **Voice-Enabled Multi-Channel Platform** that provides intelligent conversation capabilities across chat and voice interactions. The system now includes sophisticated plan-based feature tiers, advanced emergency handling, and comprehensive analytics powered by Redis session management.

### Key Technologies

- **Runtime**: Node.js 20.x
- **Language**: TypeScript 5.x
- **Framework**: Express.js 4.x
- **Database**: PostgreSQL 15+ with pgvector
- **Session Store**: Redis with intelligent fallback and comprehensive session management
- **ORM**: Prisma 5.x
- **AI**: OpenAI API (GPT-4, Whisper, OpenAI TTS with voice models, text-embedding-3-small)
- **Voice**: Twilio Voice API with OpenAI TTS integration and SSML processing
- **Authentication**: JWT (jsonwebtoken) with plan-aware middleware
- **View Engine**: EJS with plan-based conditional rendering
- **Containerization**: Docker & Docker Compose
- **Email**: Nodemailer with enhanced templates

### Major System Features (V4.0)

1. **Enhanced Voice Agent System**: Complete Twilio integration with OpenAI TTS and advanced speech processing
2. **Plan Tier Architecture**: FREE/BASIC/PRO tiers with comprehensive feature gating
3. **Enhanced Emergency Handling**: Cross-channel emergency detection with priority voice notifications
4. **Advanced Session Management**: Redis-powered with VoiceSessionService, analytics, and intelligent fallback
5. **Multi-Channel Lead Capture**: Unified lead management across chat and voice with entity extraction
6. **Intelligent Admin Interface**: Plan-aware UI with advanced voice configuration and system monitoring

---

## 2. System Architecture

### High-Level Architecture (V4.0)

```
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│   SMB Website   │   │ Voice Callers   │   │ Admin Dashboard │   │   Email Client  │
│   (widget.js)   │   │ (Twilio PSTN)   │   │  (EJS Views)    │   │                 │
└────────┬────────┘   └────────┬────────┘   └────────┬────────┘   └────────▲────────┘
         │                     │                     │                     │
         │ HTTPS               │ SIP/WebRTC          │ HTTPS               │ SMTP
         │                     │                     │                     │
         ▼                     ▼                     ▼                     │
┌──────────────────────────────────────────────────────────────────────────┴────┐
│                        Backend API (Express.js)                                │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐ │
│  │   Chat API  │  │  Voice API  │  │  Admin API   │  │ Notification Service│ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬───────┘  └──────────┬──────────┘ │
│         │                │                │                       │           │
│  ┌──────┴──────────────────┴────────────────┴───────────────────▼──────────┐ │
│  │                    Business Logic Layer                                   │ │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │ │
│  │  │  AI Handler │  │  RAG Service │  │ Voice Session│  │ Plan Manager │ │ │
│  │  │   (Enhanced)│  │   (Enhanced) │  │   Service    │  │              │ │ │
│  │  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ │ │
│  └─────────┼────────────────┼──────────────────┼──────────────────┼─────────┘ │
│            │                │                  │                  │            │
│  ┌─────────▼────────────────▼──────────────────▼──────────────────▼────────┐  │
│  │                  Data Access Layer (Prisma)                             │  │
│  └─────────────────────────┬──────────────────────────────┬────────────────┘  │
└────────────────────────────┼──────────────────────────────┼───────────────────┘
                             │                              │
                    ┌────────▼────────┐            ┌────────▼────────┐
                    │   PostgreSQL    │            │      Redis      │
                    │    Database     │◄──────────►│ Session Storage │
                    │   + pgvector    │            └─────────────────┘
                    └─────────────────┘
                             │
                    ┌────────▼────────┐            ┌─────────────────┐
                    │   OpenAI API    │            │   Twilio Voice  │
                    │ GPT/Whisper/TTS │            │       API       │
                    └─────────────────┘            └─────────────────┘
```

### Component Interactions

1. **Chat Flow**: Widget → Chat API → AI Handler → OpenAI/RAG → Database/Redis → Response
2. **Voice Flow**: Caller → Twilio → Voice API → Voice Session Service → AI Handler → SSML Response
3. **Admin Flow**: Dashboard → Admin API → Plan Manager → Auth Middleware → Business Logic → Database
4. **Emergency Flow**: Detection → Priority Routing → Voice/Email Notifications → Session Analytics

---

## 3. Voice Agent System

### 3.1. Twilio Integration Architecture

```typescript
// Voice Routes Structure
POST /api/voice/incoming     // Handle incoming calls
POST /api/voice/gather       // Process user speech input
POST /api/voice/action       // Handle dynamic voice actions
GET  /api/voice/health       // Voice system health check
```

### 3.2. Speech Processing Pipeline

```
Incoming Call → Twilio Webhook → Voice Route Handler
       ↓
Voice Session Creation (Redis) → Initial Greeting (SSML)
       ↓
User Speech → Twilio Gather → OpenAI Whisper Transcription
       ↓
AI Processing (Enhanced for Voice) → Intent Classification
       ↓
Response Generation → SSML Enhancement → Speech Synthesis
       ↓
Voice Action Decision (CONTINUE/HANGUP/TRANSFER/VOICEMAIL)
```

### 3.3. SSML Processing

The system uses advanced SSML (Speech Synthesis Markup Language) for natural voice interactions:

```typescript
// SSML Enhancement Function
function enhancePromptForVoice(response: string, context: VoiceContext): string {
  // Add conversational interjections
  // Apply appropriate pauses and emphasis
  // Include natural speech patterns
  // Handle emergency urgency markers
}
```

**SSML Features:**
- Conversational interjections ("Got it," "Alright," "Perfect")
- Context-appropriate pauses and emphasis
- Emergency urgency markers with enhanced tone
- Natural speech flow with prosody adjustments

### 3.4. Voice Options & Languages

**Standard Voices (All Plans):**
- Alice, Man, Woman

**Premium Voices (PRO Only):**
- Amazon Polly Neural voices
- Enhanced quality and naturalness

**Generative Voices (PRO Only):**
- Google Chirp3-HD
- Amazon Polly Generative
- Custom voice characteristics

**Multi-Language Support:**
- English (en-US, en-GB, en-AU)
- Spanish (es-ES, es-MX)
- French (fr-FR)
- German (de-DE)
- Italian (it-IT)
- Portuguese (pt-BR)

### 3.5. Enhanced Voice Session Service

The VoiceSessionService provides comprehensive session management with advanced analytics:

```typescript
// Core Session Structure
interface VoiceSession {
  history: ConversationMessage[]          // Enhanced conversation history
  identifiedIntents: AIIntent[]          // Intent tracking with confidence
  extractedEntities: ExtractedEntities   // Real-time entity extraction
  currentFlow: string | null             // Legacy flow compatibility
  detailedFlow: DetailedFlowState        // Advanced flow management
  metadata: SessionMetadata              // Call and session metadata
}

// Enhanced Analytics
interface SessionAnalytics {
  conversationLength: number
  uniqueIntents: string[]
  mostConfidentIntent?: AIIntent
  extractedEntityCount: number
  flowProgression: string[]
  callDuration: number
}
```

**Key Features:**
- **Redis-First Storage**: Primary Redis storage with intelligent in-memory fallback
- **Real-Time Analytics**: Live conversation tracking with entity extraction
- **Memory Optimization**: Configurable session limits and automatic cleanup
- **Health Monitoring**: Continuous Redis health checks and status reporting
- **Entity Extraction**: Automatic extraction of emails, phones, names, dates, amounts
- **Intent Classification**: Real-time intent identification with confidence scoring

**Session Management:**
```typescript
// Session Creation and Updates
await voiceSessionService.addConversationMessage(callSid, 'user', content, {
  intent: 'booking_request',
  confidence: 0.9,
  entities: extractedEntities
})

// Flow State Management
await voiceSessionService.updateDetailedFlow(callSid, {
  primaryFlow: 'lead_capture',
  subFlow: 'asking_contact',
  completedSteps: ['greeting', 'problem_identification']
})

// Analytics Retrieval
const analytics = await voiceSessionService.getSessionAnalytics(callSid)
```

---

## 4. Plan Tier Architecture

### 4.1. Plan Tier Definitions

```typescript
enum PlanTier {
  FREE = 'FREE',
  BASIC = 'BASIC',
  PRO = 'PRO'
}
```

### 4.2. Feature Matrix

| Feature | FREE | BASIC | PRO |
|---------|------|-------|-----|
| Chat Widget | ✅ Basic | ✅ Enhanced | ✅ Full |
| Lead Capture Questions | 5 max | Unlimited | Unlimited |
| Voice Agent | ❌ | ❌ | ✅ Full |
| Premium Voices | ❌ | ❌ | ✅ |
| Emergency Voice Calls | ❌ | ❌ | ✅ |
| Advanced Analytics | ❌ | Basic | ✅ Full |
| Branding | Visible | Visible | Hidden |
| Voice Configuration | ❌ | ❌ | ✅ Full |

### 4.3. Plan-Aware Middleware

```typescript
// Plan validation middleware
export const requirePlan = (requiredPlan: PlanTier) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userPlan = req.user.business.planTier;
    if (!isPlanSufficient(userPlan, requiredPlan)) {
      return res.status(403).json({ error: 'Plan upgrade required' });
    }
    next();
  };
};
```

### 4.4. Plan-Based UI Rendering

The admin interface conditionally renders features based on plan tier:

```typescript
// Plan-aware view rendering
app.get('/admin/settings', authMiddleware, (req, res) => {
  const { planTier } = req.user.business;
  res.render('agent-settings', {
    showVoiceSettings: planTier === 'PRO',
    showAdvancedAnalytics: planTier === 'PRO',
    showUpgradePrompts: planTier !== 'PRO'
  });
});
```

---

## 5. Enhanced Emergency System

### 5.1. Cross-Channel Emergency Detection

```typescript
// Emergency detection across channels
interface EmergencyDetection {
  keywords: string[];
  urgencyLevel: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  channelType: 'CHAT' | 'VOICE';
  responseTime: number; // milliseconds
}
```

### 5.2. Emergency Response Flow

```
User Input (Chat/Voice) → Emergency Detection Engine
       ↓
Priority Classification (LOW/NORMAL/HIGH/URGENT)
       ↓
Essential Questions Only (isEssentialForEmergency: true)
       ↓
Lead Creation with Priority Flag
       ↓
Multi-Channel Notifications:
  - PRO: Immediate voice call to business owner (SSML-enhanced)
  - All: Priority email with emergency indicators
       ↓
Session Analytics with Emergency Metrics
```

### 5.3. Essential Question Flagging

The `isEssentialForEmergency` field on lead capture questions allows for streamlined emergency flows:

```sql
-- Database field
ALTER TABLE lead_capture_questions 
ADD COLUMN isEssentialForEmergency BOOLEAN DEFAULT false;
```

### 5.4. Emergency Voice Notifications (PRO Feature)

For PRO tier users, the system makes immediate voice calls to business owners when emergencies are detected:

```typescript
// Emergency voice notification
async function makeEmergencyCall(businessPhone: string, emergencyDetails: EmergencyLead) {
  const urgentMessage = createSSMLEmergencyMessage(emergencyDetails);
  await twilioClient.calls.create({
    to: businessPhone,
    from: TWILIO_BUSINESS_NUMBER,
    twiml: `<Response><Say voice="alice">${urgentMessage}</Say></Response>`
  });
}
```

---

## 6. Session Management & Analytics

### 6.1. Redis-Powered Session Architecture

```typescript
// Voice Session Service
class VoiceSessionService {
  private redis: Redis;
  private memoryStore: Map<string, VoiceSession>; // Fallback
  
  async createSession(sessionId: string, businessId: string): Promise<VoiceSession>
  async updateSession(sessionId: string, update: Partial<VoiceSession>): Promise<void>
  async getSession(sessionId: string): Promise<VoiceSession | null>
  async endSession(sessionId: string): Promise<SessionAnalytics>
  async cleanup(): Promise<void>
}
```

### 6.2. Session Analytics

The system tracks comprehensive analytics for each session:

```typescript
interface SessionAnalytics {
  sessionId: string;
  businessId: string;
  channel: 'CHAT' | 'VOICE';
  startTime: Date;
  endTime?: Date;
  duration?: number; // milliseconds
  messageCount: number;
  intents: Array<{
    intent: string;
    confidence: number;
    timestamp: Date;
  }>;
  entities: {
    emails: string[];
    phones: string[];
    names: string[];
    dates: string[];
    amounts: string[];
    locations: string[];
  };
  voiceMetrics?: {
    callDuration: number;
    voiceActions: string[];
    speechQuality: number;
  };
  emergencyDetected: boolean;
  leadCaptured: boolean;
  completionStatus: 'COMPLETED' | 'ABANDONED' | 'TRANSFERRED';
}
```

### 6.3. Health Monitoring

The system includes comprehensive health monitoring:

```typescript
// Health check endpoint
GET /health
// Returns:
{
  status: 'healthy' | 'degraded' | 'unhealthy',
  database: { connected: boolean, latency: number },
  redis: { connected: boolean, latency: number },
  openai: { accessible: boolean, latency: number },
  twilio: { accessible: boolean, webhook_status: string },
  sessions: { active: number, total: number },
  voice_calls: { active: number, total_today: number }
}
```

---

## 7. Data Flows & User Journeys

### 7.1. Voice Call Journey

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Voice Call Data Flow                                 │
└─────────────────────────────────────────────────────────────────────────────┘

Customer Dials Business Number ──────┐
                                     ▼
                             ┌──────────────┐
                             │ Twilio PSTN  │
                             └──────┬───────┘
                                    │ Webhook
                                    ▼
                             ┌──────────────┐    {callSid, from, to,
                             │  Voice API   │     direction, callStatus}
                             └──────┬───────┘              │
                                    │                      ▼
                                    │              ┌──────────────┐
                                    └─────────────►│Voice Session │◄─── Redis
                                                   │   Service    │
                                                   └──────┬───────┘
                                                          │
                          ┌─────────────────────────────────────────────┐
                          │                     │                       │
                          ▼                     ▼                       ▼
                  ┌──────────────┐    ┌──────────────┐      ┌──────────────┐
                  │ AI Handler   │    │ Emergency    │      │ Plan Manager │
                  │ (Voice Mode) │    │ Detection    │      │              │
                  └──────┬───────┘    └──────┬───────┘      └──────┬───────┘
                         │                   │                     │
                         └─────────────────────┼─────────────────────┘
                                               │
                         ┌─────────────────────▼─────────────────────┐
                         │                                           │
                         ▼                                           ▼
                 ┌──────────────┐                            ┌──────────────┐
                 │ SSML Response│                            │ Session      │
                 │ Generation   │                            │ Analytics    │
                 └──────┬───────┘                            └──────────────┘
                        │
                        ▼
                 ┌──────────────┐
                 │ Twilio TwiML │
                 │ Response     │
                 └──────────────┘
```

### 7.2. Cross-Channel Emergency Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Emergency Detection & Response                             │
└─────────────────────────────────────────────────────────────────────────────┘

Emergency Input (Chat/Voice) ──────┐
                                   ▼
                          ┌──────────────┐
                          │ Emergency    │ Keywords: "flooding", "burst pipe",
                          │ Detection    │ "no heat", "electrical fire", etc.
                          │ Engine       │
                          └──────┬───────┘
                                 │
                                 ▼
                          ┌──────────────┐
                          │ Priority     │ LOW → NORMAL → HIGH → URGENT
                          │ Classification│
                          └──────┬───────┘
                                 │
                                 ▼
                          ┌──────────────┐
                          │ Essential    │ isEssentialForEmergency: true
                          │ Questions    │ (Skip non-critical questions)
                          │ Filter       │
                          └──────┬───────┘
                                 │
                                 ▼
                          ┌──────────────┐
                          │ Lead Creation│ priority: URGENT
                          │ with Priority│ notes: Emergency details
                          └──────┬───────┘
                                 │
                     ┌───────────┴───────────┐
                     │                       │
                     ▼                       ▼
            ┌──────────────┐        ┌──────────────┐
            │ Voice Call   │        │ Priority     │
            │ to Owner     │        │ Email Alert  │
            │ (PRO Only)   │        │ (All Plans)  │
            └──────────────┘        └──────────────┘
```

---

## 8. Project Structure

### 8.1. Enhanced Directory Structure

```
leads-support-agent-smb/
├── prisma/
│   ├── schema.prisma              # Enhanced with voice & plan features
│   └── migrations/                # Database migration history
├── public/
│   ├── widget.js                  # Enhanced chat widget
│   └── admin-assets/              # Admin dashboard assets
├── src/
│   ├── api/
│   │   ├── admin.ts              # Admin API with plan-aware features
│   │   ├── authMiddleware.ts     # JWT auth with plan validation
│   │   ├── chatRoutes.ts         # Enhanced chat API
│   │   ├── voiceRoutes.ts        # NEW: Twilio voice integration
│   │   └── viewRoutes.ts         # Plan-aware view rendering
│   ├── core/
│   │   ├── aiHandler.ts          # Enhanced with voice optimization
│   │   └── ragService.ts         # Voice-context aware RAG
│   ├── services/
│   │   ├── voiceSessionService.ts # NEW: Redis session management
│   │   ├── notificationService.ts # Enhanced with voice notifications
│   │   ├── openai.ts             # Voice processing integration
│   │   └── db.ts                 # Database service
│   ├── utils/
│   │   ├── voiceHelpers.ts       # NEW: Voice processing utilities
│   │   ├── planUtils.ts          # NEW: Plan tier management
│   │   ├── ssmlHelpers.ts        # NEW: SSML processing utilities
│   │   └── emergencyDetection.ts # NEW: Emergency detection logic
│   ├── types/
│   │   ├── voice.ts              # NEW: Voice-related type definitions
│   │   ├── plans.ts              # NEW: Plan tier types
│   │   └── emergency.ts          # NEW: Emergency handling types
│   ├── middleware/
│   │   ├── planMiddleware.ts     # NEW: Plan-based access control
│   │   └── voiceMiddleware.ts    # NEW: Voice-specific middleware
│   └── views/                    # EJS templates with plan-aware rendering
│       ├── agent-settings.ejs   # Enhanced with voice configuration
│       ├── voice-settings.ejs   # NEW: PRO voice configuration
│       ├── dashboard.ejs         # Enhanced with analytics
│       └── analytics.ejs         # NEW: Session analytics dashboard
├── redis/
│   └── redis.conf                # Redis configuration
├── docker-compose.yml            # Enhanced with Redis service
├── Dockerfile                    # Updated with voice dependencies
└── package.json                  # Updated dependencies
```

### 8.2. Key New Components

**Voice Processing Stack:**
- `voiceRoutes.ts`: Twilio webhook handling and voice API endpoints
- `voiceSessionService.ts`: Redis-backed session management with analytics
- `voiceHelpers.ts`: SSML processing and voice optimization utilities

**Plan Management:**
- `planUtils.ts`: Plan tier validation and feature gating logic
- `planMiddleware.ts`: Request-level plan validation

**Emergency System:**
- `emergencyDetection.ts`: Cross-channel emergency detection engine
- Enhanced notification service with voice call capabilities

---

## 9. Core Components

### 9.1. Enhanced AI Handler

The AI Handler has been significantly enhanced for voice processing:

```typescript
class AIHandler {
  async processMessage(
    message: string,
    businessId: string,
    conversationHistory: ConversationMessage[],
    channel: 'CHAT' | 'VOICE' = 'CHAT',
    sessionId?: string
  ): Promise<ProcessedResponse> {
    
    // Voice-specific processing
    if (channel === 'VOICE') {
      const voiceOptimizedResponse = await this.processVoiceMessage(
        message, businessId, conversationHistory, sessionId
      );
      return this.enhanceForVoice(voiceOptimizedResponse);
    }
    
    // Standard chat processing with voice compatibility
    return this.processStandardMessage(message, businessId, conversationHistory);
  }

  private async enhanceForVoice(response: string): Promise<string> {
    // Add SSML markup for natural speech
    // Include conversational interjections
    // Apply appropriate pauses and emphasis
    return enhancePromptForVoice(response, this.voiceContext);
  }
}
```

### 9.2. Voice Session Service

Manages voice call sessions with Redis storage and comprehensive analytics:

```typescript
class VoiceSessionService {
  private redis: Redis;
  private memoryStore: Map<string, VoiceSession>;

  async createSession(sessionId: string, businessId: string): Promise<VoiceSession> {
    const session: VoiceSession = {
      sessionId,
      businessId,
      startTime: new Date(),
      messages: [],
      intents: [],
      entities: { emails: [], phones: [], names: [], dates: [], amounts: [], locations: [] },
      status: 'ACTIVE',
      channel: 'VOICE'
    };

    // Store in Redis with fallback to memory
    try {
      await this.redis.setex(`voice_session:${sessionId}`, 3600, JSON.stringify(session));
    } catch (error) {
      console.warn('Redis unavailable, using memory store');
      this.memoryStore.set(sessionId, session);
    }

    return session;
  }

  async updateSession(sessionId: string, update: Partial<VoiceSession>): Promise<void> {
    // Update session with new data and analytics
  }

  async getSessionAnalytics(sessionId: string): Promise<SessionAnalytics> {
    // Generate comprehensive analytics from session data
  }
}
```

### 9.3. Plan Manager

Handles plan tier validation and feature gating:

```typescript
class PlanManager {
  static isPlanSufficient(userPlan: PlanTier, requiredPlan: PlanTier): boolean {
    const planHierarchy = { FREE: 0, BASIC: 1, PRO: 2 };
    return planHierarchy[userPlan] >= planHierarchy[requiredPlan];
  }

  static getAvailableFeatures(planTier: PlanTier): string[] {
    switch (planTier) {
      case 'FREE':
        return ['chat_widget', 'basic_faq', 'limited_questions'];
      case 'BASIC':
        return ['chat_widget', 'advanced_faq', 'unlimited_questions', 'priority_email'];
      case 'PRO':
        return ['all_features', 'voice_agent', 'premium_voices', 'emergency_calls', 'analytics'];
      default:
        return [];
    }
  }
}
```

### 9.4. Emergency Detection Engine

Cross-channel emergency detection with sophisticated keyword analysis:

```typescript
class EmergencyDetectionEngine {
  private emergencyKeywords = {
    URGENT: ['flooding', 'burst pipe', 'electrical fire', 'gas leak', 'no heat'],
    HIGH: ['leak', 'clogged', 'sparking', 'strange smell'],
    NORMAL: ['maintenance', 'quote', 'estimate', 'schedule']
  };

  detectEmergency(message: string, channel: 'CHAT' | 'VOICE'): EmergencyLevel {
    const lowercaseMessage = message.toLowerCase();
    
    for (const [level, keywords] of Object.entries(this.emergencyKeywords)) {
      if (keywords.some(keyword => lowercaseMessage.includes(keyword))) {
        return level as EmergencyLevel;
      }
    }
    
    return 'NORMAL';
  }

  async handleEmergency(
    emergencyLevel: EmergencyLevel,
    leadData: any,
    businessId: string,
    channel: 'CHAT' | 'VOICE'
  ): Promise<void> {
    // Create priority lead
    // Send emergency notifications
    // Update session analytics
  }
}
```

---

## 10. Database Schema

### 10.1. Enhanced Schema (V4.0)

The database schema has been enhanced to support voice features, plan tiers, and emergency handling:

```sql
-- Enhanced Business model with plan tier and voice features
CREATE TABLE businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  business_type business_type DEFAULT 'OTHER',
  plan_tier plan_tier DEFAULT 'FREE',        -- NEW: Plan tier system
  twilio_phone_number TEXT UNIQUE,           -- NEW: Voice phone number
  notification_email TEXT,
  notification_phone_number TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Enhanced AgentConfig with voice settings
CREATE TABLE agent_configs (
  id TEXT PRIMARY KEY,
  business_id TEXT UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  agent_name TEXT DEFAULT 'AI Assistant',
  persona_prompt TEXT DEFAULT 'You are a helpful and friendly assistant.',
  welcome_message TEXT DEFAULT 'Hello! How can I help you today?',
  color_theme JSONB DEFAULT '{"primary": "#0ea5e9", "secondary": "#64748b"}',
  -- NEW: Voice-specific configuration fields
  voice_greeting_message TEXT,
  voice_completion_message TEXT,
  voice_emergency_message TEXT,
  voice_end_call_message TEXT,
  twilio_voice TEXT DEFAULT 'alice',
  twilio_language TEXT DEFAULT 'en-US',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Enhanced LeadCaptureQuestion with emergency flagging
CREATE TABLE lead_capture_questions (
  id TEXT PRIMARY KEY,
  config_id TEXT REFERENCES agent_configs(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  expected_format expected_format DEFAULT 'TEXT',
  "order" INTEGER NOT NULL,
  is_required BOOLEAN DEFAULT true,
  maps_to_lead_field TEXT,
  is_essential_for_emergency BOOLEAN DEFAULT false,  -- NEW: Emergency question flagging
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(config_id, "order")
);

-- Enhanced Lead model with priority and contact fields
CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  captured_data JSONB DEFAULT '{}',
  conversation_transcript TEXT NOT NULL,
  status lead_status DEFAULT 'NEW',
  priority lead_priority DEFAULT 'NORMAL',    -- Enhanced priority system
  contact_email TEXT,
  contact_phone TEXT,
  contact_name TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- NEW: Conversation sessions for analytics
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  session_id TEXT UNIQUE NOT NULL,
  messages JSONB DEFAULT '[]',
  started_at TIMESTAMP DEFAULT NOW(),
  ended_at TIMESTAMP,
  lead_id TEXT
);

-- Plan tier enum
CREATE TYPE plan_tier AS ENUM ('FREE', 'BASIC', 'PRO');

-- Enhanced priority enum
CREATE TYPE lead_priority AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
```

### 10.2. Voice Session Storage (Redis)

Voice sessions are stored in Redis with the following structure:

```typescript
interface VoiceSession {
  sessionId: string;
  businessId: string;
  callSid: string;
  fromNumber: string;
  toNumber: string;
  startTime: Date;
  endTime?: Date;
  status: 'ACTIVE' | 'COMPLETED' | 'ABANDONED';
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    transcriptionConfidence?: number;
  }>;
  intents: Array<{
    intent: string;
    confidence: number;
    timestamp: Date;
  }>;
  entities: {
    emails: string[];
    phones: string[];
    names: string[];
    dates: string[];
    amounts: string[];
    locations: string[];
  };
  emergencyDetected: boolean;
  voiceActions: string[];
  currentQuestion?: number;
  leadCaptured: boolean;
}
```

---

## 11. API Documentation

### 11.1. Voice API Endpoints

```typescript
// Voice Routes (/api/voice)
POST /api/voice/incoming
  - Handles incoming Twilio calls
  - Creates voice session
  - Returns initial TwiML greeting

POST /api/voice/gather
  - Processes user speech input
  - Updates session with transcription
  - Returns AI response as TwiML

POST /api/voice/action
  - Handles voice actions (HANGUP, TRANSFER, etc.)
  - Updates session analytics
  - Returns appropriate TwiML

GET /api/voice/health
  - Voice system health check
  - Returns Twilio connectivity status
  - Includes active call metrics
```

### 11.2. Enhanced Admin API

```typescript
// Plan-aware Admin Routes (/api/admin)
GET /api/admin/config
  - Returns agent configuration
  - Includes plan-based feature flags
  - Voice settings for PRO users only

POST /api/admin/config/voice
  - Updates voice configuration (PRO only)
  - Validates voice and language options
  - Returns updated configuration

GET /api/admin/analytics
  - Session analytics dashboard (PRO only)
  - Voice call metrics
  - Emergency detection statistics

GET /api/admin/sessions
  - Active session monitoring
  - Redis health status
  - Session cleanup controls
```

### 11.3. Enhanced Health Monitoring

```typescript
GET /health
Response: {
  status: 'healthy' | 'degraded' | 'unhealthy',
  timestamp: '2024-12-15T10:30:00Z',
  components: {
    database: {
      status: 'healthy',
      latency: 15,
      connection_pool: { active: 5, idle: 10 }
    },
    redis: {
      status: 'healthy',
      latency: 8,
      memory_usage: '45%',
      connected_clients: 12
    },
    openai: {
      status: 'healthy',
      latency: 120,
      rate_limit_remaining: 850
    },
    twilio: {
      status: 'healthy',
      webhook_status: 'active',
      phone_numbers: 5
    }
  },
  metrics: {
    active_sessions: 23,
    total_sessions_today: 145,
    active_voice_calls: 3,
    emergency_calls_today: 7
  }
}
```

---

## 12. Development Setup

### 12.1. Enhanced Environment Configuration

```bash
# Core Application
PORT=3000
NODE_ENV=development

# Database
DATABASE_URL="postgresql://db_user:db_password@localhost:5433/app_db?schema=public"
DIRECT_URL="postgresql://db_user:db_password@localhost:5433/app_db?schema=public"

# Redis Session Storage
REDIS_URL="redis://localhost:6379"
REDIS_PASSWORD=""
REDIS_DB=0

# OpenAI Integration
OPENAI_API_KEY="sk-your-key-here"

# Twilio Voice Integration
TWILIO_ACCOUNT_SID="AC_your_account_sid"
TWILIO_AUTH_TOKEN="your_auth_token"
TWILIO_WEBHOOK_BASE_URL="https://your-domain.com"

# JWT Configuration
JWT_SECRET="your-super-secret-jwt-key"

# CORS and Frontend URLs
APP_PRIMARY_URL=http://localhost:3000
ADMIN_CUSTOM_DOMAIN_URL=https://app.yourcompany.com
WIDGET_DEMO_URL=https://demo.yourcompany.com
WIDGET_TEST_URL=http://127.0.0.1:8080
```

### 12.2. Enhanced Docker Configuration

```yaml
# docker-compose.yml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://db_user:db_password@db:5432/app_db
      - REDIS_URL=redis://redis:6379
    depends_on:
      - db
      - redis
    volumes:
      - .:/app
      - /app/node_modules

  db:
    image: pgvector/pgvector:pg15
    environment:
      POSTGRES_DB: app_db
      POSTGRES_USER: db_user
      POSTGRES_PASSWORD: db_password
    ports:
      - "5433:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes

volumes:
  postgres_data:
  redis_data:
```

### 12.3. Development Commands

```bash
# Start all services
docker-compose up

# Voice-specific database migration
docker-compose exec app npx prisma migrate dev --name add_voice_features

# Redis session cleanup
docker-compose exec app yarn redis:cleanup

# Voice system testing
docker-compose exec app yarn test:voice

# Run with voice debugging
docker-compose exec app yarn dev:voice

# Analytics dashboard testing
docker-compose exec app yarn test:analytics
```

---

## 13. Deployment Guide

### 13.1. Production Environment Setup

For production deployment, ensure the following services are configured:

**Infrastructure Requirements:**
- Node.js 20.x runtime
- PostgreSQL 15+ with pgvector extension
- Redis 7.x for session storage
- SSL certificates for HTTPS/WSS
- Twilio account with phone numbers
- OpenAI API access

**Environment Variables:**
```bash
# Production configuration
NODE_ENV=production
PORT=3000

# Database (production URLs)
DATABASE_URL="postgresql://prod_user:prod_password@prod_host:5432/prod_db"
DIRECT_URL="postgresql://prod_user:prod_password@prod_host:5432/prod_db"

# Redis (production instance)
REDIS_URL="redis://prod_redis_host:6379"
REDIS_PASSWORD="prod_redis_password"

# Twilio (production webhook URLs)
TWILIO_WEBHOOK_BASE_URL="https://your-production-domain.com"

# Security
JWT_SECRET="production-strength-jwt-secret"
```

### 13.2. Production Deployment Checklist

- [ ] Database migrations applied
- [ ] Redis instance configured and accessible
- [ ] Twilio webhooks pointing to production URLs
- [ ] OpenAI API rate limits configured
- [ ] SSL certificates installed
- [ ] Environment variables secured
- [ ] Health monitoring endpoints configured
- [ ] Log aggregation setup
- [ ] Backup procedures in place
- [ ] Plan tier billing integration (if applicable)

---

## 14. Security Considerations

### 14.1. Voice Security

**Twilio Webhook Validation:**
```typescript
// Validate Twilio webhook signatures
const validateTwilioSignature = (req: Request): boolean => {
  const signature = req.headers['x-twilio-signature'];
  const url = `${process.env.TWILIO_WEBHOOK_BASE_URL}${req.originalUrl}`;
  const params = req.body;
  
  return twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    signature,
    url,
    params
  );
};
```

**Voice Data Protection:**
- All voice transcriptions encrypted in transit and at rest
- Session data in Redis with TTL for automatic expiration
- No permanent storage of voice recordings
- GDPR-compliant data handling

### 14.2. Plan Tier Security

**Plan-Based Access Control:**
- Middleware validation for all plan-restricted endpoints
- Frontend feature gating to prevent unauthorized access
- Server-side plan verification for all premium features
- Audit logging for plan tier changes

**Session Security:**
- Redis sessions with secure configuration
- Session invalidation on plan downgrades
- Encrypted session data storage
- Regular session cleanup

---

## 15. Testing Strategy

### 15.1. Voice Testing Framework

```typescript
// Voice interaction testing
describe('Voice Agent System', () => {
  it('should handle incoming calls correctly', async () => {
    const mockTwilioCall = createMockTwilioCall();
    const response = await request(app)
      .post('/api/voice/incoming')
      .send(mockTwilioCall)
      .expect(200);
    
    expect(response.text).toContain('<Response>');
    expect(response.text).toContain('<Say>');
  });

  it('should detect emergencies in voice calls', async () => {
    const emergencyTranscript = "My basement is flooding and water is everywhere";
    const session = await voiceSessionService.createSession('test-session', 'business-id');
    
    const result = await aiHandler.processMessage(
      emergencyTranscript, 
      'business-id', 
      [], 
      'VOICE', 
      'test-session'
    );
    
    expect(result.emergencyDetected).toBe(true);
    expect(result.priority).toBe('URGENT');
  });
});
```

### 15.2. Plan Tier Testing

```typescript
// Plan-based feature testing
describe('Plan Tier System', () => {
  it('should restrict voice features to PRO users', async () => {
    const freeUser = createMockUser('FREE');
    const response = await request(app)
      .get('/api/admin/config/voice')
      .set('Authorization', `Bearer ${freeUser.token}`)
      .expect(403);
    
    expect(response.body.error).toContain('Plan upgrade required');
  });

  it('should allow voice configuration for PRO users', async () => {
    const proUser = createMockUser('PRO');
    const voiceConfig = { twilioVoice: 'polly.Amy', twilioLanguage: 'en-GB' };
    
    const response = await request(app)
      .post('/api/admin/config/voice')
      .set('Authorization', `Bearer ${proUser.token}`)
      .send(voiceConfig)
      .expect(200);
    
    expect(response.body.twilioVoice).toBe('polly.Amy');
  });
});
```

### 15.3. Emergency System Testing

```typescript
// Emergency detection testing
describe('Emergency Detection System', () => {
  it('should detect various emergency keywords', async () => {
    const emergencyScenarios = [
      { input: "burst pipe flooding basement", expected: 'URGENT' },
      { input: "electrical fire in kitchen", expected: 'URGENT' },
      { input: "small water leak under sink", expected: 'HIGH' },
      { input: "schedule maintenance visit", expected: 'NORMAL' }
    ];

    for (const scenario of emergencyScenarios) {
      const result = emergencyEngine.detectEmergency(scenario.input, 'CHAT');
      expect(result).toBe(scenario.expected);
    }
  });
});
```

---

## 16. Troubleshooting

### 16.1. Voice System Issues

**Common Twilio Integration Problems:**
```bash
# Check Twilio webhook connectivity
curl -X POST https://your-domain.com/api/voice/incoming \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "CallSid=test&From=+1234567890&To=+1987654321"

# Verify Twilio credentials
docker-compose exec app yarn twilio:verify

# Test voice session creation
docker-compose exec app yarn test:voice-session
```

**Voice Quality Issues:**
- Verify SSML markup is valid
- Check OpenAI Whisper transcription accuracy
- Monitor network latency to Twilio
- Validate voice model availability

### 16.2. Redis Session Issues

**Session Storage Problems:**
```bash
# Check Redis connectivity
docker-compose exec redis redis-cli ping

# Monitor Redis memory usage
docker-compose exec redis redis-cli info memory

# Clear stuck sessions
docker-compose exec app yarn redis:cleanup

# Check session statistics
curl http://localhost:3000/health | jq '.metrics'
```

### 16.3. Plan Tier Issues

**Feature Access Problems:**
```bash
# Verify user plan tier
SELECT businesses.name, businesses.plan_tier 
FROM businesses 
JOIN users ON businesses.id = users.business_id 
WHERE users.email = 'user@example.com';

# Check plan middleware logs
docker-compose logs app | grep "Plan validation"

# Test plan-based endpoints
curl -H "Authorization: Bearer $JWT_TOKEN" \
     http://localhost:3000/api/admin/config/voice
```

### 16.4. Emergency Detection Issues

**Emergency Not Detected:**
- Review emergency keyword dictionary
- Check message preprocessing (lowercasing, stemming)
- Verify emergency detection logs
- Test with known emergency phrases

**False Emergency Detection:**
- Adjust emergency keyword weights
- Implement context-aware detection
- Add negative keywords to filter out false positives
- Review emergency classification logic

This enhanced developer guide now comprehensively covers the voice-enabled, plan-tier based AI agent platform with all its advanced features and capabilities. 