# Developer Guide & System Architecture
## AI Agent Assistant for SMBs - Advanced Voice-Enabled Multi-Channel Platform

**Version:** 4.2  
**Last Updated:** December 2024  
**Purpose:** Technical implementation guide and architectural reference for the advanced voice-enabled, plan-tier based AI agent platform with OpenAI Realtime API integration and WebSocket architecture

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [System Architecture](#2-system-architecture)
3. [OpenAI Realtime API Integration](#3-openai-realtime-api-integration)
4. [WebSocket Infrastructure](#4-websocket-infrastructure)
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

The AI Agent Assistant for SMBs has evolved into a comprehensive **Advanced Voice-Enabled Multi-Channel Platform** that provides intelligent conversation capabilities across chat and voice interactions. The system now features **OpenAI Realtime API integration** with bidirectional audio streaming, enterprise-grade Redis session management, WebSocket architecture, and production-ready infrastructure.

### Key Technologies

- **Runtime**: Node.js 20.x
- **Language**: TypeScript 5.x
- **Framework**: Express.js 4.x with WebSocket Server
- **Database**: PostgreSQL 15+ with pgvector
- **Session Store**: Redis with intelligent fallback and comprehensive session management
- **ORM**: Prisma 5.x
- **AI**: **OpenAI Realtime API** (`gpt-4o-realtime-preview-2024-10-01`), Whisper transcription, text-embedding-3-small
- **Voice**: **Twilio Media Streams** with bidirectional WebSocket integration
- **Authentication**: JWT (jsonwebtoken) with plan-aware middleware
- **View Engine**: EJS with plan-based conditional rendering
- **Containerization**: Docker & Docker Compose
- **Email**: Nodemailer with enhanced templates

### Major System Features (V4.2)

1. **OpenAI Realtime API Integration**: Bidirectional audio streaming with real-time conversation capabilities
2. **WebSocket Architecture**: Low-latency audio bridge between Twilio Media Streams and OpenAI
3. **Voice Activity Detection**: Server-side VAD with intelligent interruption handling
4. **Enterprise Session Management**: Redis-powered with comprehensive analytics and health monitoring
5. **Production-Ready Infrastructure**: Advanced health monitoring, automated cleanup systems, and WebSocket connection management
6. **Enhanced Emergency Handling**: Cross-channel emergency detection with real-time voice notifications
7. **Multi-Channel Lead Capture**: Unified lead management across chat and voice with real-time entity extraction
8. **Intelligent Admin Interface**: Plan-aware UI with advanced voice configuration and comprehensive system monitoring

---

## 2. System Architecture

### High-Level Architecture (V4.2)

```
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│   SMB Website   │   │ Voice Callers   │   │ Admin Dashboard │   │   Email Client  │
│   (widget.js)   │   │(Twilio Media)   │   │  (EJS Views)    │   │                 │
└────────┬────────┘   └────────┬────────┘   └────────┬────────┘   └────────▲────────┘
         │                     │                     │                     │
         │ HTTPS               │ WebSocket (WSS)     │ HTTPS               │ SMTP
         │                     │                     │                     │
         ▼                     ▼                     ▼                     │
┌──────────────────────────────────────────────────────────────────────────┴────┐
│               Advanced Backend API (Express.js + WebSocket)                    │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐ │
│  │   Chat API  │  │Realtime     │  │  Admin API   │  │Advanced Notification│ │
│  │             │  │Voice API    │  │              │  │     Service         │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬───────┘  └──────────┬──────────┘ │
│         │                │                │                       │           │
│  ┌──────┴────────────────┴────────────────┴───────────────────▼──────────┐   │
│  │                Enhanced Business Logic Layer                            │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │   │
│  │  │Enhanced     │  │  RAG Service │  │Realtime Agent│  │ Plan Manager │ │   │
│  │  │AI Handler   │  │   (Enhanced) │  │   Service    │  │              │ │   │
│  │  │(Voice Opt.) │  │              │  │  (WebSocket) │  │              │ │   │
│  │  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ │   │
│  └─────────┼────────────────┼──────────────────┼──────────────────┼─────────┘   │
│            │                │                  │                  │             │
│  ┌─────────▼────────────────▼──────────────────▼──────────────────▼────────┐   │
│  │                Enhanced Data Access Layer (Prisma)                      │   │
│  └─────────────────────────┬──────────────────────────────┬────────────────┘   │
└────────────────────────────┼──────────────────────────────┼────────────────────┘
                             │                              │
                    ┌────────▼────────┐            ┌────────▼────────┐
                    │   PostgreSQL    │            │Enterprise Redis │
                    │    Database     │◄──────────►│Session Storage  │
                    │   + pgvector    │            │+ Health Monitor │
                    └─────────────────┘            └─────────────────┘
                             │
                    ┌────────▼────────┐            ┌─────────────────┐
                    │OpenAI Realtime  │◄──────────►│Twilio Media     │
                    │API (WebSocket)  │            │Streams (WS)     │
                    └─────────────────┘            └─────────────────┘
```

### Enhanced Component Interactions

1. **Enhanced Chat Flow**: Widget → Chat API → AI Handler → OpenAI/RAG → Database/Redis → Response
2. **Realtime Voice Flow**: Caller → Twilio Media Stream → WebSocket Server → Realtime Agent Service → OpenAI Realtime API → Response Audio
3. **Admin Flow**: Dashboard → Admin API → Plan Manager → Auth Middleware → Business Logic → Database
4. **Emergency Flow**: Detection → Priority Routing → Real-time Voice/Email Notifications → Comprehensive Analytics

---

## 3. OpenAI Realtime API Integration

### 3.1. Realtime API Architecture

```typescript
// Realtime Agent Service - Core Implementation
export class RealtimeAgentService {
  private openAiWs: WebSocket | null = null;
  private twilioWs: WebSocket | null = null;
  private callSid: string;
  private streamSid: string | null = null;
  private readonly openaiApiKey: string;

  constructor(callSid: string) {
    this.callSid = callSid;
    this.openaiApiKey = process.env.OPENAI_API_KEY || '';
    
    if (!this.openaiApiKey) {
      throw new Error('OPENAI_API_KEY is required for RealtimeAgentService');
    }
  }

  /**
   * Establishes bidirectional audio bridge between Twilio and OpenAI
   */
  public async connect(twilioWs: WebSocket): Promise<void> {
    try {
      this.twilioWs = twilioWs;
      this.setupTwilioListeners();
      
      // Connect to OpenAI Realtime API
      const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01';
      const headers = {
        'Authorization': `Bearer ${this.openaiApiKey}`,
        'OpenAI-Beta': 'realtime=v1'
      };

      this.openAiWs = new WebSocket(url, { headers });
      this.setupOpenAiListeners();

    } catch (error) {
      console.error(`[RealtimeAgent] Failed to connect for call ${this.callSid}:`, error);
      throw error;
    }
  }

  /**
   * Configures the OpenAI session for voice conversation
   */
  private configureOpenAiSession(): void {
    if (!this.openAiWs || this.openAiWs.readyState !== WebSocket.OPEN) return;

    const sessionConfig = {
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: 'You are a helpful AI assistant for a business. Respond naturally and helpfully to customer inquiries. Keep responses concise and conversational.',
        voice: 'alloy',
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        input_audio_transcription: {
          model: 'whisper-1'
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500
        }
      }
    };

    this.openAiWs.send(JSON.stringify(sessionConfig));
  }

  /**
   * Handles incoming messages from Twilio WebSocket
   */
  private handleTwilioMessage(message: WebSocket.Data): void {
    try {
      const msg = JSON.parse(message.toString());
      
      switch (msg.event) {
        case 'media':
          // Forward audio from Twilio to OpenAI
          if (this.openAiWs && this.openAiWs.readyState === WebSocket.OPEN) {
            const audioAppend = {
              type: 'input_audio_buffer.append',
              audio: msg.media.payload
            };
            this.openAiWs.send(JSON.stringify(audioAppend));
          }
          
          // Send mark message back to Twilio to keep audio stream alive
          if (this.twilioWs && this.twilioWs.readyState === WebSocket.OPEN && this.streamSid) {
            const markMessage = {
              event: 'mark',
              streamSid: this.streamSid,
              mark: { name: `audio_processed_${Date.now()}` }
            };
            this.twilioWs.send(JSON.stringify(markMessage));
          }
          break;
      }
    } catch (error) {
      console.error(`[RealtimeAgent] Error parsing Twilio message:`, error);
    }
  }

  /**
   * Handles incoming messages from OpenAI WebSocket
   */
  private handleOpenAiMessage(data: WebSocket.Data): void {
    try {
      const response = JSON.parse(data.toString());
      
      switch (response.type) {
        case 'response.audio.delta':
          // Forward audio from OpenAI back to Twilio
          if (this.twilioWs && this.twilioWs.readyState === WebSocket.OPEN && this.streamSid) {
            const twilioMessage = {
              event: 'media',
              streamSid: this.streamSid,
              media: { payload: response.delta }
            };
            this.twilioWs.send(JSON.stringify(twilioMessage));
          }
          break;
          
        case 'input_audio_buffer.speech_started':
          // User started speaking - optionally interrupt AI
          if (this.openAiWs && this.openAiWs.readyState === WebSocket.OPEN) {
            this.openAiWs.send(JSON.stringify({ type: 'response.cancel' }));
          }
          break;
          
        case 'input_audio_buffer.speech_stopped':
          // User stopped speaking - commit and respond
          if (this.openAiWs && this.openAiWs.readyState === WebSocket.OPEN) {
            this.openAiWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
            this.openAiWs.send(JSON.stringify({ type: 'response.create' }));
          }
          break;
      }
    } catch (error) {
      console.error(`[RealtimeAgent] Error parsing OpenAI message:`, error);
    }
  }
}
```

### 3.2. Bidirectional Audio Streaming

```
Twilio Media Stream → WebSocket → Realtime Agent Service
       ↓
Audio Buffer (G.711 μ-law) → OpenAI Realtime API
       ↓
Real-time AI Processing (Speech-to-Speech)
       ↓
Response Audio → Twilio Media Stream → WebSocket → Caller
```

### 3.3. Voice Activity Detection Configuration

```typescript
// Advanced VAD configuration
private configureOpenAiSession(): void {
  const sessionConfig = {
    type: 'session.update',
    session: {
      modalities: ['text', 'audio'],
      instructions: 'You are a helpful AI assistant for a business...',
      voice: 'alloy',
      input_audio_format: 'g711_ulaw',
      output_audio_format: 'g711_ulaw',
      input_audio_transcription: {
        model: 'whisper-1'
      },
      turn_detection: {
        type: 'server_vad',
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 500
      }
    }
  };

  this.openAiWs.send(JSON.stringify(sessionConfig));
}
```

---

## 4. WebSocket Infrastructure

### 4.1. WebSocket Server Implementation

```typescript
// WebSocket server for handling Twilio Media Streams
export class TwilioWebSocketServer {
  private wss: WebSocketServer;
  private activeConnections = new Map<string, RealtimeAgentService>();

  constructor(server: Server) {
    this.wss = new WebSocketServer({ 
      server,
      path: '/' // Root path for WebSocket connections
    });

    this.setupWebSocketServer();
  }

  private setupWebSocketServer(): void {
    this.wss.on('connection', (ws: WebSocket, request) => {
      // Validate Twilio connection
      const userAgent = request.headers['user-agent'] || '';
      const isFromTwilio = userAgent.includes('TwilioProxy') || userAgent.includes('Twilio');
      
      if (!isFromTwilio) {
        ws.close(1008, 'Only Twilio connections allowed');
        return;
      }

      let callSid: string | null = null;
      let realtimeAgent: RealtimeAgentService | null = null;

      ws.on('message', async (message: WebSocket.Data) => {
        const data = JSON.parse(message.toString());
        
        if (!callSid && data.start?.callSid) {
          callSid = data.start.callSid;
          realtimeAgent = new RealtimeAgentService(callSid);
          this.activeConnections.set(callSid, realtimeAgent);
          
          await realtimeAgent.connect(ws);
        }
      });
    });
  }
}
```

### 4.2. Audio Stream Processing

```typescript
// Handle audio data from Twilio
private handleTwilioMessage(message: WebSocket.Data): void {
  const msg = JSON.parse(message.toString());
  
  switch (msg.event) {
    case 'media':
      // Forward audio from Twilio to OpenAI
      if (this.openAiWs && this.openAiWs.readyState === WebSocket.OPEN) {
        const audioAppend = {
          type: 'input_audio_buffer.append',
          audio: msg.media.payload
        };
        this.openAiWs.send(JSON.stringify(audioAppend));
      }
      
      // Send mark message to keep stream alive
      if (this.twilioWs && this.streamSid) {
        const markMessage = {
          event: 'mark',
          streamSid: this.streamSid,
          mark: { name: `audio_processed_${Date.now()}` }
        };
        this.twilioWs.send(JSON.stringify(markMessage));
      }
      break;
  }
}

// Handle responses from OpenAI
private handleOpenAiMessage(data: WebSocket.Data): void {
  const response = JSON.parse(data.toString());
  
  switch (response.type) {
    case 'response.audio.delta':
      // Forward audio from OpenAI back to Twilio
      if (this.twilioWs && this.streamSid) {
        const twilioMessage = {
          event: 'media',
          streamSid: this.streamSid,
          media: { payload: response.delta }
        };
        this.twilioWs.send(JSON.stringify(twilioMessage));
      }
      break;
      
    case 'input_audio_buffer.speech_started':
      // User started speaking - interrupt AI if needed
      if (this.openAiWs) {
        this.openAiWs.send(JSON.stringify({ type: 'response.cancel' }));
      }
      break;
      
    case 'input_audio_buffer.speech_stopped':
      // User stopped speaking - process and respond
      if (this.openAiWs) {
        this.openAiWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
        this.openAiWs.send(JSON.stringify({ type: 'response.create' }));
      }
      break;
  }
}
```

### 4.3. Dynamic Business Greetings

```typescript
/**
 * Proactively triggers the agent's welcome message by fetching business config
 */
private async triggerGreeting(): Promise<void> {
  try {
    // Fetch call details from Twilio
    const callDetails = await twilioClient.calls(this.callSid).fetch();
    const toPhoneNumber = callDetails.to;
    
    // Find business by phone number
    const business = await prisma.business.findUnique({
      where: { twilioPhoneNumber: toPhoneNumber }
    });
    
    let welcomeMessage = 'Hello! Thank you for calling. How can I help you today?';
    
    if (business) {
      const agentConfig = await prisma.agentConfig.findUnique({
        where: { businessId: business.id }
      });
      
      if (agentConfig?.voiceGreetingMessage?.trim()) {
        welcomeMessage = agentConfig.voiceGreetingMessage;
      } else if (agentConfig?.welcomeMessage?.trim()) {
        welcomeMessage = agentConfig.welcomeMessage;
      }
    }
    
    // Send text event to OpenAI to trigger greeting
    if (this.openAiWs && this.openAiWs.readyState === WebSocket.OPEN) {
      const textEvent = {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{
            type: 'input_text',
            text: `Please say this exact welcome message to the caller: "${welcomeMessage}"`
          }]
        }
      };
      
      this.openAiWs.send(JSON.stringify(textEvent));
      
      // Trigger response
      setTimeout(() => {
        if (this.openAiWs && this.openAiWs.readyState === WebSocket.OPEN) {
          this.openAiWs.send(JSON.stringify({ type: 'response.create' }));
        }
      }, 100);
    }
    
  } catch (error) {
    console.error('Error triggering greeting:', error);
  }
}
```

---

## 5. Enterprise Session Management

### 5.1. Enhanced Session Service with WebSocket Support

```typescript
class VoiceSessionService {
  private static instance: VoiceSessionService;
  private redis: RedisClientType | undefined;
  private memoryStore: Map<string, VoiceSession>;
  private healthMetrics: HealthMetrics;

  // WebSocket session tracking
  async trackWebSocketConnection(callSid: string, connectionId: string): Promise<void> {
    const session = await this.getSession(callSid);
    if (session) {
      session.webSocketConnectionId = connectionId;
      session.connectionStatus = 'CONNECTED';
      await this.storeSession(session);
    }
  }

  // Real-time session analytics with WebSocket metrics
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
      completionStatus: session.status,
      webSocketMetrics: {
        connectionId: session.webSocketConnectionId,
        connectionStatus: session.connectionStatus,
        audioPacketsReceived: session.audioPacketsReceived || 0,
        audioPacketsSent: session.audioPacketsSent || 0
      }
    };
  }

  // Advanced health monitoring with WebSocket status
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
      webSocket: {
        activeConnections: this.getActiveWebSocketConnections(),
        totalMessages: await this.getTotalWebSocketMessages(),
        averageLatency: await this.getAverageWebSocketLatency()
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

## 6. Health Monitoring & Analytics

### 6.1. Enhanced Health Monitoring with WebSocket Metrics

```typescript
// Advanced Health Check Endpoint with WebSocket Support
router.get('/health', async (req, res) => {
  try {
    const memoryUsage = process.memoryUsage()
    const formatBytes = (bytes: number) => Math.round(bytes / 1024 / 1024 * 100) / 100
    
    const sessionStats = await voiceSessionService.getSessionStats()
    const activeVoiceSessions = voiceSessions.size
    const webSocketStats = await getWebSocketStats()
    
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
      webSocket: {
        activeConnections: webSocketStats.activeConnections,
        totalMessages: webSocketStats.totalMessages,
        averageLatency: webSocketStats.averageLatency,
        connectionsToday: webSocketStats.connectionsToday
      },
      openAI: {
        realtimeConnections: webSocketStats.openAIConnections,
        modelStatus: 'gpt-4o-realtime-preview-2024-10-01',
        averageResponseTime: webSocketStats.averageAIResponseTime
      },
      environment: {
        nodeEnv: process.env.NODE_ENV,
        verboseLogging: ENABLE_VERBOSE_LOGGING,
        realtimeAPIEnabled: !!process.env.OPENAI_API_KEY
      }
    }
    
    // Determine health status
    if (formatBytes(memoryUsage.heapUsed) > MAX_MEMORY_USAGE_MB) {
      healthData.status = 'warning'
    }
    
    if (webSocketStats.activeConnections === 0 && webSocketStats.connectionsToday > 0) {
      healthData.status = 'degraded'
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

### 6.2. WebSocket Connection Management

```typescript
// WebSocket Health Monitoring
function getWebSocketStats() {
  return {
    activeConnections: wss.clients.size,
    totalMessages: totalWebSocketMessages,
    averageLatency: calculateAverageLatency(),
    connectionsToday: dailyConnectionCount,
    openAIConnections: activeRealtimeConnections,
    averageAIResponseTime: calculateAverageAIResponseTime()
  };
}

// Connection cleanup and monitoring
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    } else {
      // Clean up dead connections
      cleanupDeadConnection(ws);
    }
  });
}, 30000); // Check every 30 seconds
```

---

## 7. Plan Tier Architecture

### 7.1. Plan Tier Definitions (Updated for Realtime API)

```typescript
export class PlanManager {
  static getAvailableFeatures(planTier: PlanTier): string[] {
    switch (planTier) {
      case 'FREE':
        return [
          'chat_widget',
          'basic_faq',
          'limited_questions', // Max 5 questions
          'email_notifications',
          'basic_analytics'
        ];
      
      case 'BASIC':
        return [
          'chat_widget',
          'advanced_faq',
          'unlimited_questions',
          'priority_email_notifications',
          'enhanced_analytics',
          'knowledge_base_management'
        ];
      
      case 'PRO':
        return [
          'all_basic_features',
          'realtime_voice_agent', // Updated for Realtime API
          'openai_realtime_api',  // New feature
          'voice_activity_detection',
          'emergency_voice_calls',
          'advanced_analytics',
          'websocket_monitoring',
          'session_management',
          'branding_removal',
          'voice_configuration',
          'priority_support'
        ];
      
      default:
        return [];
    }
  }

  static canAccessRealtimeFeatures(planTier: PlanTier): boolean {
    return planTier === 'PRO';
  }
}
```

---

## 8. Enhanced Emergency System

### 8.1. Real-time Emergency Processing

```typescript
// Emergency detection with real-time response
export class EmergencyDetectionEngine {
  static async handleEmergency(
    emergencyLevel: EmergencyLevel,
    leadData: any,
    businessId: string,
    channel: 'CHAT' | 'VOICE'
  ): Promise<void> {
    // Create priority lead
    const priorityLead = await createEmergencyLead(leadData, emergencyLevel, businessId);
    
    // Real-time notifications for urgent emergencies
    if (emergencyLevel === 'URGENT' && channel === 'VOICE') {
      await sendRealtimeEmergencyNotification(priorityLead);
    }
    
    // Update session analytics with emergency metrics
    await updateSessionAnalytics(priorityLead.sessionId, {
      emergencyDetected: true,
      emergencyLevel: emergencyLevel,
      emergencyChannel: channel,
      emergencyTimestamp: new Date()
    });
  }
}

// Real-time emergency notifications via WebSocket
async function sendRealtimeEmergencyNotification(lead: EmergencyLead): Promise<void> {
  const business = await prisma.business.findUnique({
    where: { id: lead.businessId }
  });
  
  if (business?.notificationPhoneNumber) {
    // Send immediate voice call using Twilio
    await twilioClient.calls.create({
      to: business.notificationPhoneNumber,
      from: TWILIO_BUSINESS_NUMBER,
      twiml: generateEmergencyTwiML(lead)
    });
  }
}
```

---

## 9. Data Flows & User Journeys

### 9.1. Realtime Voice Call Journey

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Realtime Voice Call Data Flow                            │
└─────────────────────────────────────────────────────────────────────────────┘

Customer Dials Business Number ──────┐
                                     ▼
                             ┌──────────────┐
                             │ Twilio PSTN  │
                             └──────┬───────┘
                                    │ Media Stream (WSS)
                                    ▼
                             ┌──────────────┐
                             │WebSocket     │ ◄─── Twilio Media Stream
                             │Server        │
                             └──────┬───────┘
                                    │
                                    ▼
                             ┌──────────────┐    {callSid, audio_stream,
                             │Realtime      │     businessRouting, session}
                             │Agent Service │              │
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
                  │OpenAI        │    │ Enhanced     │      │ Plan Manager │
                  │Realtime API  │    │ Emergency    │      │   + Health   │
                  │(WebSocket)   │    │ Detection    │      │  Monitor     │
                  └──────┬───────┘    └──────┬───────┘      └──────┬───────┘
                         │                   │                     │
                         └─────────────────────┼─────────────────────┘
                                               │
                         ┌─────────────────────▼─────────────────────┐
                         │                                           │
                         ▼                                           ▼
                 ┌──────────────┐                            ┌──────────────┐
                 │Bidirectional │                            │Comprehensive │
                 │Audio Stream  │                            │Session       │
                 │Processing +  │                            │Analytics +   │
                 │VAD + Response│                            │WebSocket     │
                 │Generation    │                            │Metrics       │
                 └──────┬───────┘                            └──────────────┘
                        │
                        ▼
                 ┌──────────────┐
                 │Audio Response│
                 │Back to       │
                 │Twilio Stream │
                 └──────────────┘
```

---

## 10. Project Structure

### 10.1. Enhanced Directory Structure (V4.2)

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
│   │   ├── voiceRoutes.ts        # ENHANCED: Twilio webhook endpoints
│   │   └── viewRoutes.ts         # Plan-aware view rendering
│   ├── core/
│   │   ├── aiHandler.ts          # ENHANCED: Voice optimization + response cleaning
│   │   └── ragService.ts         # Voice-context aware RAG
│   ├── services/
│   │   ├── realtimeAgentService.ts # NEW: OpenAI Realtime API integration
│   │   ├── websocketServer.ts     # NEW: WebSocket server for Twilio Media Streams
│   │   ├── voiceSessionService.ts # ENHANCED: Enterprise Redis session management
│   │   ├── notificationService.ts # Enhanced with voice notifications
│   │   ├── openai.ts             # ENHANCED: Realtime API integration
│   │   └── db.ts                 # Database service
│   ├── utils/
│   │   ├── voiceHelpers.ts       # ENHANCED: Realtime voice processing utilities
│   │   ├── planUtils.ts          # Plan tier management
│   │   ├── emergencyDetection.ts # Emergency detection logic
│   │   ├── memoryManagement.ts   # Memory monitoring and cleanup
│   │   ├── healthMonitoring.ts   # NEW: Comprehensive health monitoring
│   │   └── websocketUtils.ts     # NEW: WebSocket utilities and helpers
│   ├── types/
│   │   ├── voice.ts              # ENHANCED: Realtime voice type definitions
│   │   ├── plans.ts              # Plan tier types
│   │   ├── emergency.ts          # Emergency handling types
│   │   ├── session.ts            # Enhanced session management types
│   │   ├── websocket.ts          # NEW: WebSocket type definitions
│   │   └── health.ts             # Enhanced health monitoring types
│   ├── middleware/
│   │   ├── planMiddleware.ts     # Plan-based access control
│   │   ├── voiceMiddleware.ts    # ENHANCED: Voice-specific middleware
│   │   ├── websocketMiddleware.ts # NEW: WebSocket middleware
│   │   └── healthMiddleware.ts   # Health monitoring middleware
│   └── views/                    # EJS templates with plan-aware rendering
│       ├── agent-settings.ejs   # Enhanced with voice configuration
│       ├── voice-settings.ejs   # ENHANCED: Realtime voice configuration
│       ├── dashboard.ejs         # Enhanced with analytics
│       ├── analytics.ejs         # ENHANCED: Advanced session analytics
│       ├── websocket-monitor.ejs # NEW: WebSocket connection monitoring
│       └── health-monitor.ejs    # Enhanced health monitoring dashboard
├── redis/
│   └── redis.conf                # Production Redis configuration
├── docker-compose.yml            # ENHANCED: Advanced service configuration
├── Dockerfile                    # Updated with WebSocket dependencies
└── package.json                  # Updated dependencies
```

---

## 11. Core Components

### 11.1. Realtime Agent Service (Core Implementation)

```typescript
// Core Realtime Agent Service
export class RealtimeAgentService {
  private openAiWs: WebSocket | null = null;
  private twilioWs: WebSocket | null = null;
  private callSid: string;
  private streamSid: string | null = null;
  private readonly openaiApiKey: string;

  constructor(callSid: string) {
    this.callSid = callSid;
    this.openaiApiKey = process.env.OPENAI_API_KEY || '';
    
    if (!this.openaiApiKey) {
      throw new Error('OPENAI_API_KEY is required for RealtimeAgentService');
    }
  }

  /**
   * Establishes bidirectional audio bridge between Twilio and OpenAI
   */
  public async connect(twilioWs: WebSocket): Promise<void> {
    try {
      this.twilioWs = twilioWs;
      this.setupTwilioListeners();
      
      // Connect to OpenAI Realtime API
      const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01';
      const headers = {
        'Authorization': `Bearer ${this.openaiApiKey}`,
        'OpenAI-Beta': 'realtime=v1'
      };

      this.openAiWs = new WebSocket(url, { headers });
      this.setupOpenAiListeners();

    } catch (error) {
      console.error(`[RealtimeAgent] Failed to connect for call ${this.callSid}:`, error);
      throw error;
    }
  }

  /**
   * Configures the OpenAI session for voice conversation
   */
  private configureOpenAiSession(): void {
    if (!this.openAiWs || this.openAiWs.readyState !== WebSocket.OPEN) return;

    const sessionConfig = {
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: 'You are a helpful AI assistant for a business. Respond naturally and helpfully to customer inquiries. Keep responses concise and conversational.',
        voice: 'alloy',
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        input_audio_transcription: {
          model: 'whisper-1'
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500
        }
      }
    };

    this.openAiWs.send(JSON.stringify(sessionConfig));
  }

  /**
   * Handles incoming messages from Twilio WebSocket
   */
  private handleTwilioMessage(message: WebSocket.Data): void {
    try {
      const msg = JSON.parse(message.toString());
      
      switch (msg.event) {
        case 'media':
          // Forward audio from Twilio to OpenAI
          if (this.openAiWs && this.openAiWs.readyState === WebSocket.OPEN) {
            const audioAppend = {
              type: 'input_audio_buffer.append',
              audio: msg.media.payload
            };
            this.openAiWs.send(JSON.stringify(audioAppend));
          }
          
          // Send mark message back to Twilio to keep audio stream alive
          if (this.twilioWs && this.twilioWs.readyState === WebSocket.OPEN && this.streamSid) {
            const markMessage = {
              event: 'mark',
              streamSid: this.streamSid,
              mark: { name: `audio_processed_${Date.now()}` }
            };
            this.twilioWs.send(JSON.stringify(markMessage));
          }
          break;
      }
    } catch (error) {
      console.error(`[RealtimeAgent] Error parsing Twilio message:`, error);
    }
  }

  /**
   * Handles incoming messages from OpenAI WebSocket
   */
  private handleOpenAiMessage(data: WebSocket.Data): void {
    try {
      const response = JSON.parse(data.toString());
      
      switch (response.type) {
        case 'response.audio.delta':
          // Forward audio from OpenAI back to Twilio
          if (this.twilioWs && this.twilioWs.readyState === WebSocket.OPEN && this.streamSid) {
            const twilioMessage = {
              event: 'media',
              streamSid: this.streamSid,
              media: { payload: response.delta }
            };
            this.twilioWs.send(JSON.stringify(twilioMessage));
          }
          break;
          
        case 'input_audio_buffer.speech_started':
          // User started speaking - optionally interrupt AI
          if (this.openAiWs && this.openAiWs.readyState === WebSocket.OPEN) {
            this.openAiWs.send(JSON.stringify({ type: 'response.cancel' }));
          }
          break;
          
        case 'input_audio_buffer.speech_stopped':
          // User stopped speaking - commit and respond
          if (this.openAiWs && this.openAiWs.readyState === WebSocket.OPEN) {
            this.openAiWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
            this.openAiWs.send(JSON.stringify({ type: 'response.create' }));
          }
          break;
      }
    } catch (error) {
      console.error(`[RealtimeAgent] Error parsing OpenAI message:`, error);
    }
  }
}
```

---

## 12. Database Schema

### 12.1. Enhanced Schema for Realtime Voice Features

```sql
-- Enhanced Business model with Realtime voice features
CREATE TABLE businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  business_type business_type DEFAULT 'OTHER',
  plan_tier plan_tier DEFAULT 'FREE',
  twilio_phone_number TEXT UNIQUE,           -- For Realtime voice calls
  notification_email TEXT,
  notification_phone_number TEXT,
  realtime_api_enabled BOOLEAN DEFAULT false, -- New: Realtime API access
  websocket_enabled BOOLEAN DEFAULT false,    -- New: WebSocket support
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Enhanced AgentConfig with Realtime settings
CREATE TABLE agent_configs (
  id TEXT PRIMARY KEY,
  business_id TEXT UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  agent_name TEXT DEFAULT 'AI Assistant',
  persona_prompt TEXT DEFAULT 'You are a helpful and friendly assistant.',
  welcome_message TEXT DEFAULT 'Hello! How can I help you today?',
  color_theme JSONB DEFAULT '{"primary": "#0ea5e9", "secondary": "#64748b"}',
  -- Enhanced voice configuration for Realtime API
  voice_greeting_message TEXT,
  voice_completion_message TEXT,
  voice_emergency_message TEXT,
  voice_end_call_message TEXT,
  realtime_voice_model TEXT DEFAULT 'alloy',          -- New: OpenAI voice model
  realtime_instructions TEXT,                         -- New: Custom AI instructions
  vad_threshold DECIMAL DEFAULT 0.5,                  -- New: VAD configuration
  silence_duration_ms INTEGER DEFAULT 500,            -- New: Silence detection
  prefix_padding_ms INTEGER DEFAULT 300,              -- New: Audio padding
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Enhanced Voice Sessions for Realtime tracking
CREATE TABLE voice_sessions (
  id TEXT PRIMARY KEY,
  business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  call_sid TEXT UNIQUE NOT NULL,
  websocket_connection_id TEXT,                       -- New: WebSocket tracking
  from_number TEXT,
  to_number TEXT,
  session_data JSONB DEFAULT '{}',                    -- Enhanced session data
  realtime_metrics JSONB DEFAULT '{}',               -- New: Realtime API metrics
  audio_duration_seconds INTEGER DEFAULT 0,          -- New: Audio duration tracking
  interruption_count INTEGER DEFAULT 0,              -- New: Interruption tracking
  vad_events JSONB DEFAULT '[]',                     -- New: VAD event log
  started_at TIMESTAMP DEFAULT NOW(),
  ended_at TIMESTAMP,
  status voice_session_status DEFAULT 'ACTIVE'
);

-- New enums for Realtime features
CREATE TYPE voice_session_status AS ENUM ('ACTIVE', 'COMPLETED', 'FAILED', 'INTERRUPTED');
CREATE TYPE realtime_event_type AS ENUM ('SPEECH_STARTED', 'SPEECH_STOPPED', 'AUDIO_DELTA', 'SESSION_UPDATE');
```

---

## 13. API Documentation

### 13.1. Enhanced Voice Routes for Realtime API

```typescript
// Voice Routes for Twilio Integration
POST /api/voice/incoming
  - Handles incoming Twilio calls
  - Initiates WebSocket connection for Media Streams
  - Returns TwiML with Media Stream configuration

// WebSocket Endpoint
WS /
  - Twilio Media Stream WebSocket connection
  - Bidirectional audio streaming
  - Real-time session management

// Health and Monitoring
GET /api/voice/health
  - Voice system health with WebSocket metrics
  - Realtime API connection status
  - Active session monitoring

GET /api/voice/sessions
  - Active voice session monitoring
  - WebSocket connection status
  - Realtime API metrics
```

---

## 14. Development Setup

### 14.1. Enhanced Environment for Realtime API

```bash
# Core Application
PORT=3000
NODE_ENV=development

# Database
DATABASE_URL="postgresql://db_user:db_password@localhost:5433/app_db?schema=public"
DIRECT_URL="postgresql://db_user:db_password@localhost:5433/app_db?schema=public"

# Redis Session Storage
REDIS_URL="redis://localhost:6379"

# OpenAI Realtime API Integration
OPENAI_API_KEY="sk-your-key-here"
OPENAI_REALTIME_MODEL="gpt-4o-realtime-preview-2024-10-01"

# Twilio Media Streams Integration
TWILIO_ACCOUNT_SID="AC_your_account_sid"
TWILIO_AUTH_TOKEN="your_auth_token"
TWILIO_WEBHOOK_BASE_URL="https://your-domain.com"

# WebSocket Configuration
WEBSOCKET_PING_INTERVAL=30000
WEBSOCKET_PONG_TIMEOUT=5000
MAX_WEBSOCKET_CONNECTIONS=100

# JWT Configuration
JWT_SECRET="your-super-secret-jwt-key"
```

### 14.2. Development Commands for Realtime Features

```bash
# Start with Realtime API support
npm run dev:realtime

# Test Realtime API integration
npm run test:realtime

# Monitor WebSocket connections
npm run monitor:websockets

# Test voice session management
npm run test:voice-sessions

# WebSocket health check
npm run health:websockets
```

---

## 15. Deployment Guide

### 15.1. Production Environment for Realtime API

**Infrastructure Requirements:**
- Node.js 20.x runtime
- PostgreSQL 15+ with pgvector extension
- Redis 7.x for session storage
- **SSL certificates for HTTPS/WSS** (required for WebSocket)
- **Twilio account with Media Streams enabled**
- **OpenAI API access with Realtime API permissions**

### 15.2. WebSocket Configuration for Production

```nginx
# Nginx configuration for WebSocket support
server {
    listen 443 ssl;
    server_name your-domain.com;
    
    # WebSocket upgrade handling
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket specific timeouts
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
```

---

This comprehensive developer guide now accurately reflects the current OpenAI Realtime API implementation with WebSocket architecture, providing technical implementation details and architectural reference for the advanced voice-enabled platform. 