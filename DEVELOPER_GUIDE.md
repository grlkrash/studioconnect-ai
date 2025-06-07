# Developer Guide & System Architecture
## AI Agent Assistant for SMBs - Advanced Voice-Enabled Multi-Channel Platform

**Version:** 4.1  
**Last Updated:** December 2024  
**Purpose:** Technical implementation guide and architectural reference for the advanced voice-enabled, plan-tier based AI agent platform with OpenAI TTS integration and sophisticated session management

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [System Architecture](#2-system-architecture)
3. [Advanced Voice Agent System](#3-advanced-voice-agent-system)
4. [OpenAI TTS Integration](#4-openai-tts-integration)
5. [Enterprise Session Management](#5-enterprise-session-management)
6. [Health Monitoring & Analytics](#6-health-monitoring--analytics)
7. [Plan Tier Architecture](#7-plan-tier-architecture)
8. [Enhanced Emergency System](#8-enhanced-emergency-system)
9. [Data Flows & User Journeys](#9-data-flows--user-journeys)
10. [Project Structure](#10-project-structure)
11. [Core Components](#11-core-components)
12. [Database Schema](#12-database-schema)
13. [API Documentation](#13-api-documentation)
14. [Development Setup](#14-development-setup)
15. [Deployment Guide](#15-deployment-guide)
16. [Security Considerations](#16-security-considerations)
17. [Testing Strategy](#17-testing-strategy)
18. [Troubleshooting](#18-troubleshooting)

---

## 1. Project Overview

The AI Agent Assistant for SMBs has evolved into a comprehensive **Advanced Voice-Enabled Multi-Channel Platform** that provides intelligent conversation capabilities across chat and voice interactions. The system now includes sophisticated OpenAI TTS integration, enterprise-grade Redis session management, advanced health monitoring, and production-ready memory management systems.

### Key Technologies

- **Runtime**: Node.js 20.x
- **Language**: TypeScript 5.x
- **Framework**: Express.js 4.x
- **Database**: PostgreSQL 15+ with pgvector
- **Session Store**: Redis with intelligent fallback and comprehensive session management
- **ORM**: Prisma 5.x
- **AI**: OpenAI API (GPT-4, Whisper, **OpenAI TTS with voice models**, text-embedding-3-small)
- **Voice**: Twilio Voice API with **OpenAI TTS primary integration** and SSML processing
- **Authentication**: JWT (jsonwebtoken) with plan-aware middleware
- **View Engine**: EJS with plan-based conditional rendering
- **Containerization**: Docker & Docker Compose
- **Email**: Nodemailer with enhanced templates

### Major System Features (V4.1)

1. **Advanced Voice Agent System**: OpenAI TTS primary integration with intelligent Twilio fallback and sophisticated SSML processing
2. **Enterprise Session Management**: Redis-powered with comprehensive analytics, health monitoring, and intelligent memory management
3. **Production-Ready Infrastructure**: Advanced health monitoring, automated cleanup systems, and configurable resource management
4. **Enhanced Emergency Handling**: Cross-channel emergency detection with priority voice notifications and advanced analytics
5. **Multi-Channel Lead Capture**: Unified lead management across chat and voice with real-time entity extraction
6. **Intelligent Admin Interface**: Plan-aware UI with advanced voice configuration and comprehensive system monitoring

---

## 2. System Architecture

### High-Level Architecture (V4.1)

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
│                   Advanced Backend API (Express.js)                            │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐ │
│  │   Chat API  │  │Enhanced     │  │  Admin API   │  │Advanced Notification│ │
│  │             │  │Voice API    │  │              │  │     Service         │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬───────┘  └──────────┬──────────┘ │
│         │                │                │                       │           │
│  ┌──────┴──────────────────┴────────────────┴───────────────────▼──────────┐ │
│  │                Enhanced Business Logic Layer                              │ │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │ │
│  │  │Enhanced     │  │  RAG Service │  │Enterprise    │  │ Plan Manager │ │ │
│  │  │AI Handler   │  │   (Enhanced) │  │Voice Session │  │              │ │ │
│  │  │(Voice Opt.) │  │              │  │   Service    │  │              │ │ │
│  │  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ │ │
│  └─────────┼────────────────┼──────────────────┼──────────────────┼─────────┘ │
│            │                │                  │                  │            │
│  ┌─────────▼────────────────▼──────────────────▼──────────────────▼────────┐  │
│  │                Enhanced Data Access Layer (Prisma)                      │  │
│  └─────────────────────────┬──────────────────────────────┬────────────────┘  │
└────────────────────────────┼──────────────────────────────┼───────────────────┘
                             │                              │
                    ┌────────▼────────┐            ┌────────▼────────┐
                    │   PostgreSQL    │            │Enterprise Redis │
                    │    Database     │◄──────────►│Session Storage  │
                    │   + pgvector    │            │+ Health Monitor │
                    └─────────────────┘            └─────────────────┘
                             │
                    ┌────────▼────────┐            ┌─────────────────┐
                    │Enhanced OpenAI  │            │Enhanced Twilio  │
                    │API (TTS Primary)│            │Voice (Fallback) │
                    └─────────────────┘            └─────────────────┘
```

### Advanced Component Interactions

1. **Enhanced Chat Flow**: Widget → Chat API → AI Handler → OpenAI/RAG → Database/Redis → Response
2. **Advanced Voice Flow**: Caller → Twilio → Voice API → OpenAI TTS Primary → Voice Session Service → Enhanced Analytics
3. **Admin Flow**: Dashboard → Admin API → Plan Manager → Auth Middleware → Business Logic → Database
4. **Emergency Flow**: Detection → Priority Routing → Advanced Voice/Email Notifications → Comprehensive Analytics

---

## 3. Advanced Voice Agent System

### 3.1. Enhanced Twilio Integration Architecture

```typescript
// Advanced Voice Routes Structure
POST /api/voice/incoming          // Handle incoming calls with business routing
POST /api/voice/handle-speech     // Process real-time speech with OpenAI TTS response
POST /api/voice/handle-voicemail-recording // Future voicemail processing
GET  /api/voice/play-audio/:fileName       // Serve OpenAI generated audio files
GET  /api/voice/health           // Comprehensive voice system health check
```

### 3.2. Advanced Speech Processing Pipeline

```
Incoming Call → Twilio Webhook → Enhanced Voice Route Handler
       ↓
Enterprise Session Creation (Redis+Fallback) → OpenAI TTS Greeting (SSML)
       ↓
User Speech → Twilio Gather → OpenAI Whisper Transcription
       ↓
Enhanced AI Processing (Voice-Optimized) → Intent + Entity Classification
       ↓
Response Generation → Advanced SSML Enhancement → OpenAI TTS Primary
       ↓
Audio File Generation → Temporary File Serving → Automatic Cleanup
       ↓
Voice Action Decision (CONTINUE/HANGUP/TRANSFER/VOICEMAIL) → Session Analytics
```

### 3.3. Advanced SSML Processing Implementation

```typescript
// Advanced SSML Enhancement Function
function createSSMLMessage(message: string, options: { 
  isGreeting?: boolean, 
  isQuestion?: boolean, 
  isUrgent?: boolean,
  addPause?: boolean, 
  addEmphasis?: boolean, 
  pauseDuration?: string,
  isConversational?: boolean
} = {}): string {
  let ssmlMessage = message
  
  // Add greeting-specific enhancements
  if (options.isGreeting) {
    ssmlMessage = ssmlMessage.replace(/(Hey!|Hello!?|Hi!?)/gi, 
      '<prosody rate="medium" pitch="+5%">$1</prosody>')
    ssmlMessage = ssmlMessage.replace(/(Hey!|Hello!?|Hi!?)(\s*)/, 
      '$1<break time="400ms"/>$2')
  }
  
  // Add conversational pauses and flow
  if (options.isConversational) {
    ssmlMessage = ssmlMessage.replace(/\b(Now|So|Alright|Okay|Perfect|Great|Got it|Thanks)\b,?/gi, 
      '<prosody rate="medium">$1</prosody><break time="300ms"/>')
    ssmlMessage = ssmlMessage.replace(/,\s+/g, ',<break time="200ms"/>')
    ssmlMessage = ssmlMessage.replace(/\b(please|thank you|thanks)\b/gi, 
      '<emphasis level="moderate">$1</emphasis>')
  }
  
  return ssmlMessage
}
```

---

## 4. OpenAI TTS Integration

### 4.1. Primary TTS Implementation

```typescript
// OpenAI TTS Service Implementation
export const generateSpeechFromText = async (
  textToSpeak: string,
  voice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' = 'nova'
): Promise<string | null> => {
  try {
    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice: voice,
      input: textToSpeak,
    });

    const tempFileName = `openai_speech_${Date.now()}.mp3`;
    const tempFilePath = path.join(os.tmpdir(), tempFileName);

    const buffer = Buffer.from(await mp3.arrayBuffer());
    await fs.promises.writeFile(tempFilePath, buffer);

    return tempFilePath;
  } catch (error) {
    console.error('[OpenAI TTS] Error generating speech:', error);
    return null;
  }
};
```

### 4.2. Intelligent Fallback System

```typescript
// Enhanced TTS with Intelligent Fallback
async function generateAndPlayTTS(
  text: string, 
  twimlResponse: typeof VoiceResponse.prototype, 
  openaiVoice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' = 'nova',
  fallbackTwilioVoice: any = 'alice',
  fallbackLanguage: any = 'en-US'
): Promise<void> {
  try {
    // Primary: OpenAI TTS
    const tempAudioPath = await generateSpeechFromText(text, openaiVoice);
    
    if (tempAudioPath) {
      const audioFileName = path.basename(tempAudioPath);
      const audioUrl = `${process.env.APP_PRIMARY_URL}/api/voice/play-audio/${audioFileName}`;
      twimlResponse.play(audioUrl);
    } else {
      // Fallback: Twilio TTS with SSML
      const fallbackMessage = createSSMLMessage(text, { isConversational: true });
      twimlResponse.say({ voice: fallbackTwilioVoice, language: fallbackLanguage }, fallbackMessage);
    }
  } catch (error) {
    // Enhanced Fallback: Twilio TTS
    const fallbackMessage = createSSMLMessage(text, { isConversational: true });
    twimlResponse.say({ voice: fallbackTwilioVoice, language: fallbackLanguage }, fallbackMessage);
  }
}
```

### 4.3. Audio File Management

```typescript
// Secure Audio File Serving with Automatic Cleanup
router.get('/play-audio/:fileName', (req, res) => {
  const { fileName } = req.params;

  // Security: Prevent path traversal
  if (fileName.includes('..') || fileName.includes('/')) {
    return res.status(400).send('Invalid filename.');
  }

  const filePath = path.join(os.tmpdir(), fileName);

  if (fs.existsSync(filePath)) {
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error(`[Play Audio] Error sending file:`, err);
        res.status(500).end();
      }
      
      // Automatic cleanup after serving
      fs.unlink(filePath, (unlinkErr) => {
        if (unlinkErr) {
          console.error(`[Play Audio] Error deleting temp file:`, unlinkErr);
        }
      });
    });
  } else {
    res.status(404).send('Audio not found.');
  }
});
```

---

## 5. Enterprise Session Management

### 5.1. Redis-Powered Session Architecture

```typescript
// Enhanced Voice Session Service
class VoiceSessionService {
  private static instance: VoiceSessionService;
  private redis: RedisClientType | undefined;
  private memoryStore: Map<string, VoiceSession>;
  private healthMetrics: HealthMetrics;

  // Comprehensive session analytics
  async getSessionAnalytics(sessionId: string): Promise<SessionAnalytics> {
    const session = await this.getSession(sessionId);
    if (!session) return null;

    return {
      sessionId,
      duration: session.endTime ? 
        session.endTime.getTime() - session.startTime.getTime() : 
        Date.now() - session.startTime.getTime(),
      messageCount: session.messages.length,
      intents: session.intents,
      entities: session.entities,
      emergencyDetected: session.emergencyDetected,
      voiceActions: session.voiceActions,
      completionStatus: session.status
    };
  }

  // Advanced health monitoring
  async getHealthMetrics(): Promise<HealthMetrics> {
    return {
      redis: {
        connected: this.isRedisReady(),
        latency: await this.measureRedisLatency(),
        memoryUsage: await this.getRedisMemoryUsage()
      },
      sessions: {
        active: this.memoryStore.size,
        total: await this.getTotalSessionCount(),
        averageDuration: await this.getAverageSessionDuration()
      },
      memory: {
        heapUsed: process.memoryUsage().heapUsed,
        heapTotal: process.memoryUsage().heapTotal,
        rss: process.memoryUsage().rss
      }
    };
  }
}
```

### 5.2. Advanced Memory Management

```typescript
// Enhanced Memory Monitoring and Cleanup
const MEMORY_CHECK_INTERVAL = parseInt(process.env.MEMORY_CHECK_INTERVAL || '300000') // 5 minutes
const MAX_MEMORY_USAGE_MB = 1536; // Alert threshold for 2GB RAM instance
const MAX_IN_MEMORY_SESSIONS = 100; // Max sessions in memory
const IN_MEMORY_SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

function logMemoryUsage(context: string = ''): void {
  if (!ENABLE_MEMORY_MONITORING) return
  
  const usage = process.memoryUsage();
  const formatBytes = (bytes: number) => Math.round(bytes / 1024 / 1024 * 100) / 100;
  
  const memoryInfo = {
    context,
    rss: formatBytes(usage.rss),
    heapUsed: formatBytes(usage.heapUsed),
    heapTotal: formatBytes(usage.heapTotal),
    external: formatBytes(usage.external)
  }
  
  // Alert on high memory usage
  if (memoryInfo.heapUsed > MAX_MEMORY_USAGE_MB) {
    console.warn(`[Memory Alert] High memory usage: ${memoryInfo.heapUsed}MB > ${MAX_MEMORY_USAGE_MB}MB`);
  }
}

function cleanupOldInMemorySessions(): void {
  const now = Date.now();
  let cleanedCount = 0;
  
  // Remove sessions that exceed timeout
  for (const [callSid, session] of voiceSessions.entries()) {
    if (now - session.lastAccessed > IN_MEMORY_SESSION_TIMEOUT_MS) {
      voiceSessions.delete(callSid);
      cleanedCount++;
    }
  }
  
  // Enforce hard limit on session count
  if (voiceSessions.size > MAX_IN_MEMORY_SESSIONS) {
    const sessionsArray = Array.from(voiceSessions.entries());
    sessionsArray.sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
    
    while (voiceSessions.size > MAX_IN_MEMORY_SESSIONS && sessionsArray.length > 0) {
      const oldestSession = sessionsArray.shift();
      if (oldestSession) {
        voiceSessions.delete(oldestSession[0]);
      }
    }
  }
}
```

---

## 6. Health Monitoring & Analytics

### 6.1. Comprehensive Health Monitoring

```typescript
// Advanced Health Check Endpoint
router.get('/health', async (req, res) => {
  try {
    const memoryUsage = process.memoryUsage()
    const formatBytes = (bytes: number) => Math.round(bytes / 1024 / 1024 * 100) / 100
    
    const sessionStats = await voiceSessionService.getSessionStats()
    const activeVoiceSessions = voiceSessions.size
    
    const healthData = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      memory: {
        rss: formatBytes(memoryUsage.rss),
        heapUsed: formatBytes(memoryUsage.heapUsed),
        heapTotal: formatBytes(memoryUsage.heapTotal),
        external: formatBytes(memoryUsage.external),
        heapUsedPercent: Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100)
      },
      redis: {
        connected: isRedisClientReady(),
        reconnectAttempts: redisReconnectAttempts,
        maxReconnectAttempts: maxRedisReconnectAttempts,
        consecutiveFailures
      },
      sessions: {
        activeVoiceSessions,
        ...sessionStats
      },
      timers: {
        memoryMonitoringEnabled: ENABLE_MEMORY_MONITORING,
        memoryCheckInterval: MEMORY_CHECK_INTERVAL,
        sessionCleanupInterval: SESSION_CLEANUP_INTERVAL,
        redisHealthCheckInterval: REDIS_HEALTH_CHECK_INTERVAL
      },
      environment: {
        nodeEnv: process.env.NODE_ENV,
        verboseLogging: ENABLE_VERBOSE_LOGGING,
        redisConfigured: !!process.env.REDIS_URL
      }
    }
    
    // Determine health status
    if (formatBytes(memoryUsage.heapUsed) > MAX_MEMORY_USAGE_MB) {
      healthData.status = 'warning'
    }
    
    res.json(healthData)
    
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    })
  }
})
```

### 6.2. Redis Connection Management

```typescript
// Advanced Redis Connection with Health Monitoring
async function initializeRedis() {
  if (redisReconnectAttempts >= maxRedisReconnectAttempts) {
    console.warn(`[Redis] Max reconnection attempts reached. Stopping reconnection.`);
    return;
  }

  try {
    const client = createClient({ 
      url: process.env.REDIS_URL,
      socket: {
        connectTimeout: 5000,
        reconnectStrategy: (retries) => {
          if (retries > 3) return false;
          return Math.min(retries * 50, 500);
        }
      }
    });

    // Enhanced event handling
    client.on('error', (err) => {
      console.error('[Redis Error]:', err);
      redisClient = undefined;
      redisReconnectAttempts++;
    });

    client.on('ready', () => {
      console.log('[Redis Ready] Client is ready.');
      redisClient = client as RedisClientType;
      redisReconnectAttempts = 0;
    });

    await client.connect();

  } catch (err) {
    console.error('[Redis] Connection failed:', err);
    redisReconnectAttempts++;
  }
}

// Periodic health check with smart backoff
function startRedisHealthCheck() {
  healthCheckInterval = setInterval(() => {
    if (isRedisClientReady()) {
      consecutiveFailures = 0;
      return;
    }
    
    if (redisReconnectAttempts >= maxRedisReconnectAttempts) return;
    
    // Exponential backoff for failures
    const backoffDelay = Math.min(1000 * Math.pow(2, consecutiveFailures), 60000);
    if (consecutiveFailures > 0 && Date.now() - lastRedisCheckTime < backoffDelay) {
      return;
    }
    
    initializeRedis().catch(err => consecutiveFailures++);
  }, REDIS_HEALTH_CHECK_INTERVAL);
}
```

---

## 7. Plan Tier Architecture

### 7.1. Plan Tier Definitions

```typescript
enum PlanTier {
  FREE = 'FREE',
  BASIC = 'BASIC',
  PRO = 'PRO'
}
```

### 7.2. Feature Matrix

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

### 7.3. Plan-Aware Middleware

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

### 7.4. Plan-Based UI Rendering

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

## 8. Enhanced Emergency System

### 8.1. Cross-Channel Emergency Detection

```typescript
// Emergency detection across channels
interface EmergencyDetection {
  keywords: string[];
  urgencyLevel: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  channelType: 'CHAT' | 'VOICE';
  responseTime: number; // milliseconds
}
```

### 8.2. Emergency Response Flow

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

### 8.3. Essential Question Flagging

The `isEssentialForEmergency` field on lead capture questions allows for streamlined emergency flows:

```sql
-- Database field
ALTER TABLE lead_capture_questions 
ADD COLUMN isEssentialForEmergency BOOLEAN DEFAULT false;
```

### 8.4. Emergency Voice Notifications (PRO Feature)

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

## 9. Data Flows & User Journeys

### 9.1. Advanced Voice Call Journey

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Advanced Voice Call Data Flow                            │
└─────────────────────────────────────────────────────────────────────────────┘

Customer Dials Business Number ──────┐
                                     ▼
                             ┌──────────────┐
                             │ Twilio PSTN  │
                             └──────┬───────┘
                                    │ Enhanced Webhook
                                    ▼
                             ┌──────────────┐    {callSid, from, to, direction,
                             │Enhanced Voice│     callStatus, businessRouting}
                             │     API      │              │
                             └──────┬───────┘              ▼
                                    │              ┌──────────────┐
                                    └─────────────►│Enterprise    │◄─── Redis Primary
                                                   │Voice Session │     + Memory Fallback
                                                   │   Service    │
                                                   └──────┬───────┘
                                                          │
                          ┌─────────────────────────────────────────────┐
                          │                     │                       │
                          ▼                     ▼                       ▼
                  ┌──────────────┐    ┌──────────────┐      ┌──────────────┐
                  │Enhanced AI   │    │ Advanced     │      │ Plan Manager │
                  │Handler       │    │ Emergency    │      │   + Health   │
                  │(Voice Opt.)  │    │ Detection    │      │  Monitor     │
                  └──────┬───────┘    └──────┬───────┘      └──────┬───────┘
                         │                   │                     │
                         └─────────────────────┼─────────────────────┘
                                               │
                         ┌─────────────────────▼─────────────────────┐
                         │                                           │
                         ▼                                           ▼
                 ┌──────────────┐                            ┌──────────────┐
                 │OpenAI TTS    │                            │Comprehensive │
                 │Primary +     │                            │Session       │
                 │SSML Enhanced │                            │Analytics +   │
                 │Twilio Fallback│                           │Health Metrics│
                 └──────┬───────┘                            └──────────────┘
                        │
                        ▼
                 ┌──────────────┐
                 │Audio File    │
                 │Generation +  │
                 │Auto Cleanup  │
                 └──────────────┘
```

### 9.2. Cross-Channel Emergency Flow

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

## 10. Project Structure

### 10.1. Enhanced Directory Structure

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
│   │   ├── voiceRoutes.ts        # ENHANCED: Advanced Twilio + OpenAI TTS integration
│   │   └── viewRoutes.ts         # Plan-aware view rendering
│   ├── core/
│   │   ├── aiHandler.ts          # ENHANCED: Voice optimization + response cleaning
│   │   └── ragService.ts         # Voice-context aware RAG
│   ├── services/
│   │   ├── voiceSessionService.ts # ENHANCED: Enterprise Redis session management
│   │   ├── notificationService.ts # Enhanced with voice notifications
│   │   ├── openai.ts             # ENHANCED: OpenAI TTS + voice processing
│   │   └── db.ts                 # Database service
│   ├── utils/
│   │   ├── voiceHelpers.ts       # ENHANCED: Advanced voice processing utilities
│   │   ├── planUtils.ts          # Plan tier management
│   │   ├── ssmlHelpers.ts        # ENHANCED: Advanced SSML processing
│   │   ├── emergencyDetection.ts # Emergency detection logic
│   │   ├── memoryManagement.ts   # NEW: Memory monitoring and cleanup
│   │   └── healthMonitoring.ts   # NEW: Comprehensive health monitoring
│   ├── types/
│   │   ├── voice.ts              # ENHANCED: Advanced voice type definitions
│   │   ├── plans.ts              # Plan tier types
│   │   ├── emergency.ts          # Emergency handling types
│   │   ├── session.ts            # NEW: Session management types
│   │   └── health.ts             # NEW: Health monitoring types
│   ├── middleware/
│   │   ├── planMiddleware.ts     # Plan-based access control
│   │   ├── voiceMiddleware.ts    # ENHANCED: Voice-specific middleware
│   │   └── healthMiddleware.ts   # NEW: Health monitoring middleware
│   └── views/                    # EJS templates with plan-aware rendering
│       ├── agent-settings.ejs   # Enhanced with voice configuration
│       ├── voice-settings.ejs   # ENHANCED: Advanced voice configuration
│       ├── dashboard.ejs         # Enhanced with analytics
│       ├── analytics.ejs         # ENHANCED: Advanced session analytics
│       └── health-monitor.ejs    # NEW: Health monitoring dashboard
├── redis/
│   └── redis.conf                # ENHANCED: Production Redis configuration
├── docker-compose.yml            # ENHANCED: Advanced service configuration
├── Dockerfile                    # Updated with voice dependencies
└── package.json                  # Updated dependencies
```

### 10.2. Key Enhanced Components

**Advanced Voice Processing Stack:**
- `voiceRoutes.ts`: Advanced Twilio webhook handling with OpenAI TTS primary integration
- `voiceSessionService.ts`: Enterprise Redis session management with comprehensive analytics
- `openai.ts`: Enhanced OpenAI service with TTS integration and voice processing
- `ssmlHelpers.ts`: Advanced SSML processing utilities for natural conversation

**Enterprise Infrastructure:**
- `memoryManagement.ts`: Advanced memory monitoring and cleanup systems
- `healthMonitoring.ts`: Comprehensive health monitoring with detailed metrics
- `healthMiddleware.ts`: Health monitoring middleware for API endpoints

**Production-Ready Systems:**
- Enhanced error handling and graceful degradation
- Automated cleanup systems with configurable resource limits
- Advanced health monitoring with component status tracking

---

## 11. Core Components

### 11.1. Enhanced AI Handler with Voice Optimization

```typescript
class AIHandler {
  // Voice-optimized system prompt creation
  private createVoiceSystemPrompt(businessName?: string): string {
    return `You are a highly articulate, empathetic, and professional voice assistant${businessName ? ` for ${businessName}` : ''}. You are engaged in a REAL-TIME PHONE CONVERSATION with a human caller.

**ABSOLUTE REQUIREMENTS - NO EXCEPTIONS:**

1. **DIALOGUE-ONLY OUTPUT:** Your response IS the exact words to be spoken. NEVER include:
   ❌ Prefixes: "Say:", "Response:", "AI:", "Assistant:"
   ❌ Meta-commentary: "[speaking naturally]", "(pause here)"
   ❌ Explanations: "I should say...", "Let me respond with..."

2. **VOICE-FIRST SPEECH PATTERNS:**
   - Use CONVERSATIONAL sentences (8-12 words per sentence maximum)
   - Employ natural speech rhythm with pauses and breath points
   - Use contractions authentically ("I'll", "we're", "that's")
   - Include natural transitions: "Well,", "Actually,", "You know,", "So,"

3. **STRATEGIC SSML FOR NATURAL FLOW:**
   * **Natural Pauses:** \`<break time="300ms"/>\` between distinct thoughts
   * **Gentle Emphasis:** \`<emphasis level="moderate">key information</emphasis>\``;
  }

  // Advanced response cleaning for voice output
  private cleanVoiceResponse(response: string): string {
    let cleanedResponse = response.trim()
    
    // Ultra-aggressive prefix removal
    const prefixPatterns = [
      /^(Say|Response|Assistant|AI|Voice|Agent):\s*/gi,
      /^(I should say|Let me say|I'll say|I will say):\s*/gi,
      /^(Here's what I would say|Here's my response):\s*/gi,
      // ... comprehensive prefix patterns
    ]
    
    // Apply patterns iteratively
    for (const pattern of prefixPatterns) {
      cleanedResponse = cleanedResponse.replace(pattern, '').trim()
    }
    
    // Remove meta-commentary and formatting
    cleanedResponse = cleanedResponse.replace(/^\[.*?\]\s*/g, '').trim()
    cleanedResponse = cleanedResponse.replace(/^\(.*?\)\s*/g, '').trim()
    
    return cleanedResponse
  }

  async processMessage(
    message: string,
    conversationHistory: ConversationMessage[],
    businessId: string,
    currentActiveFlow?: string | null
  ): Promise<EnhancedAIResponse> {
    // Enhanced processing with voice optimization, emergency detection,
    // and comprehensive session management
  }
}
```

### 11.2. Enterprise Voice Session Service

```typescript
class VoiceSessionService {
  private static instance: VoiceSessionService;
  private redis: RedisClientType | undefined;
  private memoryStore: Map<string, VoiceSession>;
  private healthMetrics: HealthMetrics;

  // Comprehensive session analytics
  async getSessionAnalytics(sessionId: string): Promise<SessionAnalytics> {
    const session = await this.getSession(sessionId);
    if (!session) return null;

    return {
      sessionId,
      duration: session.endTime ? 
        session.endTime.getTime() - session.startTime.getTime() : 
        Date.now() - session.startTime.getTime(),
      messageCount: session.messages.length,
      intents: session.intents,
      entities: session.entities,
      emergencyDetected: session.emergencyDetected,
      voiceActions: session.voiceActions,
      completionStatus: session.status
    };
  }

  // Advanced health monitoring
  async getHealthMetrics(): Promise<HealthMetrics> {
    return {
      redis: {
        connected: this.isRedisReady(),
        latency: await this.measureRedisLatency(),
        memoryUsage: await this.getRedisMemoryUsage()
      },
      sessions: {
        active: this.memoryStore.size,
        total: await this.getTotalSessionCount(),
        averageDuration: await this.getAverageSessionDuration()
      },
      memory: {
        heapUsed: process.memoryUsage().heapUsed,
        heapTotal: process.memoryUsage().heapTotal,
        rss: process.memoryUsage().rss
      }
    };
  }
}
```

---

## 12. Database Schema

### 12.1. Enhanced Schema (V4.0)

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

### 12.2. Voice Session Storage (Redis)

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

## 13. API Documentation

### 13.1. Voice API Endpoints

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

### 13.2. Enhanced Admin API

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

### 13.3. Enhanced Health Monitoring

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

## 14. Development Setup

### 14.1. Enhanced Environment Configuration

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

### 14.2. Enhanced Docker Configuration

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

### 14.3. Development Commands

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

## 15. Deployment Guide

### 15.1. Production Environment Setup

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

### 15.2. Production Deployment Checklist

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

## 16. Security Considerations

### 16.1. Voice Security

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

### 16.2. Plan Tier Security

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

## 17. Testing Strategy

### 17.1. Voice Testing Framework

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

### 17.2. Plan Tier Testing

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

### 17.3. Emergency System Testing

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

## 18. Troubleshooting

### 18.1. Voice System Issues

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

### 18.2. Redis Session Issues

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

### 18.3. Plan Tier Issues

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

### 18.4. Emergency Detection Issues

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

This comprehensive developer guide now accurately reflects the advanced voice-enabled platform with OpenAI TTS integration, sophisticated session management, and enterprise-grade health monitoring capabilities. 