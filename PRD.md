# Product Requirements Document: Leads Support AI Agent
**Version:** 4.2 (OpenAI Realtime API & WebSocket Implementation)
**Date:** December 2024
**Project Owner:** Sonia
**Author:** AI Assistant (in collaboration with Sonia)

## 1. Introduction

### 1.1. Purpose of this Document
This document defines the product requirements, features, and strategic vision for the "Leads Support AI Agent" (hereinafter "the Agent"). It details the **Advanced Voice-Enabled Multi-Channel Platform** that has evolved from the original MVP to include comprehensive voice calling capabilities with **OpenAI Realtime API integration**, bidirectional audio streaming via WebSocket architecture, sophisticated Redis-powered session management, advanced health monitoring, and enhanced emergency handling. The system is currently deployed and operational with both chat and voice functionalities.

### 1.2. Project Vision
To empower Small to Medium-Sized Businesses (SMBs) with an intelligent, **multi-channel AI platform** that seamlessly handles both chat and voice interactions. The Agent provides 24/7 availability across communication channels, sophisticated emergency detection and response, plan-based access to advanced features that scale with business needs, and comprehensive analytics powered by advanced session management and health monitoring systems.

### 1.3. Product Goals

#### Current Implementation (V4.2 - Fully Deployed with Realtime API Features)
* **OpenAI Realtime API Platform:** Complete integration with bidirectional audio streaming, real-time speech-to-speech processing, and WebSocket architecture
* **WebSocket Infrastructure:** Low-latency audio bridge between Twilio Media Streams and OpenAI Realtime API with intelligent connection management
* **Voice Activity Detection:** Server-side VAD with configurable thresholds, interruption handling, and natural conversation flow
* **Sophisticated Session Management:** Redis-powered session storage with WebSocket tracking, intelligent in-memory fallback, and comprehensive analytics
* **Enhanced Health Monitoring:** Real-time system health tracking with WebSocket metrics, Redis connectivity monitoring, and automated cleanup systems
* **Intelligent Memory Management:** Automated session cleanup, WebSocket connection monitoring, and configurable resource limits with production-ready monitoring

#### Achieved Advanced Features
* **Realtime Voice Processing:**
  - **Bidirectional Audio Streaming**: Real-time speech-to-speech processing via OpenAI Realtime API
  - **Voice Activity Detection**: Server-side VAD with intelligent interruption handling and natural turn-taking
  - **WebSocket Architecture**: Low-latency audio bridge between Twilio Media Streams and OpenAI
  - **Dynamic Business Greetings**: Context-aware greeting generation based on business configuration and automatic AI delivery
* **Enterprise-Grade Session Management:**
  - **Redis-First Architecture**: Primary Redis storage with WebSocket connection tracking and comprehensive session management
  - **Intelligent Fallback System**: Seamless failover to in-memory storage with advanced cleanup and memory optimization
  - **Advanced Analytics**: Real-time session tracking with WebSocket metrics, entity extraction, intent classification, and conversation analytics
  - **Health Monitoring**: Continuous Redis health checks with WebSocket status monitoring and detailed status reporting
* **Production-Ready Infrastructure:**
  - **Memory Monitoring**: Optional verbose logging and memory usage tracking for production debugging
  - **Automated Cleanup**: Configurable session limits, WebSocket connection cleanup, automatic expiration, and resource management
  - **Health Endpoints**: Comprehensive system status dashboards with WebSocket metrics, detailed component health, and connection monitoring
  - **Performance Optimization**: Memory-efficient session management with WebSocket connection pooling and intelligent cleanup

#### Achieved Core Features
* **Sophisticated Realtime Voice Agent:**
  - Twilio Media Streams integration with WebSocket handling for bidirectional audio
  - OpenAI Realtime API with real-time speech-to-speech processing
  - Voice Activity Detection with configurable thresholds and intelligent interruption handling
  - G.711 μ-law audio format support with Whisper transcription integration
  - Dynamic business greeting delivery with context-aware messaging
* **Advanced Analytics Platform:**
  - Session-based conversation tracking with Redis and WebSocket connection monitoring
  - Entity extraction and intent classification with real-time processing
  - Voice call duration, audio streaming metrics, and WebSocket interaction tracking
  - Health monitoring with system status dashboards and connection analytics
* **Plan-Based Feature Gating:**
  - FREE tier with basic chat functionality
  - BASIC tier with enhanced lead capture
  - PRO tier with full voice agent access and advanced features

#### Long-Term Goals (V5.0 and Beyond)
* **Advanced AI Capabilities:** Contextual memory across sessions, proactive engagement triggers
* **CRM Integrations:** Direct sync with HubSpot, Salesforce, and industry-specific CRMs
* **Advanced Voice Features:** Voice cloning, multi-party conference calls, voicemail-to-text
* **Self-Service SaaS:** Complete subscription management with automated billing and onboarding
* **Mobile App:** Native mobile applications for business owners to manage interactions on-the-go

### 1.4. Target Audience
Primary users are Small to Medium-Sized Businesses (SMBs) in service-oriented industries that require immediate response capabilities and sophisticated lead management across multiple communication channels.

**Current Customer Profiles (Validated ICPs):**
* **Home Service Professionals (HSPs):** Plumbers, electricians, HVAC technicians requiring emergency response capabilities
* **Medical Practices:** Clinics and med spas needing appointment scheduling and non-PHI inquiry handling
* **Real Estate Agencies:** Agents requiring 24/7 lead capture and immediate response to urgent inquiries
* **Legal Practices:** Law offices needing initial consultation scheduling and information gathering
* **Service Contractors:** Landscapers, roofers, contractors requiring multi-channel communication

### 1.5. Scope
* **In Scope (Current V4.2 Implementation):** OpenAI Realtime API integration, WebSocket architecture, plan tier system, enhanced emergency handling, Redis session management with WebSocket tracking, advanced analytics
* **Phase 1 Future Development:** CRM integrations, enhanced Realtime API features, mobile applications
* **Phase 2 Future Development:** Self-service SaaS platform, automated billing, advanced AI capabilities

## 2. Product Overview

### 2.1. Core Problem & Solution
SMBs lose significant business opportunities due to inability to handle immediate customer needs, especially emergency situations, across multiple communication channels. The Voice-Enabled AI Agent provides comprehensive coverage with intelligent routing, sophisticated emergency detection, and plan-based access to advanced features that scale with business needs.

### 2.2. Key Differentiators (Implemented & Validated)
* **True Multi-Channel Platform:** Seamless integration between chat and voice with unified session management and WebSocket architecture
* **Advanced Emergency Response:** Cross-channel emergency detection with real-time voice notifications to business owners
* **Plan-Based Value Proposition:** Clear feature progression from FREE to BASIC to PRO tiers with Realtime API access
* **Realtime Voice-First Design:** Bidirectional audio streaming with OpenAI Realtime API optimized for natural business conversations
* **Sophisticated Analytics:** Real-time session tracking with WebSocket metrics, entity extraction, and intent analysis
* **Service SMB Focus:** Built specifically for emergency-responsive service businesses with low-latency voice processing

## 3. User Personas & Stories (Current Implementation)

### 3.1. Helen the HSP (Plumber) - PRO Tier User
* **As Helen,** I receive voice calls directly to my business number when customers have plumbing emergencies, and the AI handles initial triage with natural, real-time conversation
* **As Helen,** I get immediate voice calls to my mobile when the AI detects flooding or burst pipe emergencies, with real-time voice notifications for urgency
* **As Helen,** I can customize voice greetings and messages for my specific business needs in my PRO admin dashboard with Realtime API configuration
* **As Helen,** I access detailed analytics showing call duration, WebSocket connection metrics, intent analysis, and peak emergency times to optimize my response strategy
* **As Helen,** I benefit from low-latency voice processing with natural interruption handling that feels like talking to a real person

### 3.2. Sarah the Small Business Owner - BASIC Tier User
* **As Sarah,** I have access to enhanced chat functionality and advanced lead capture without voice features
* **As Sarah,** I can set up unlimited lead capture questions for my consultation scheduling service
* **As Sarah,** I receive priority email notifications for new leads with basic analytics
* **As Sarah,** I can upgrade to PRO tier when my business grows and needs voice capabilities

### 3.3. Mike the Startup Owner - FREE Tier User
* **As Mike,** I get basic chat widget functionality with up to 5 lead capture questions to validate my business concept
* **As Mike,** I see system branding to understand what platform powers my agent
* **As Mike,** I can upgrade to BASIC or PRO tiers as my business scales

### 3.4. Charlie the Emergency Customer
* **As Charlie,** when I call about a burst pipe emergency, I speak naturally to an AI that understands urgency and routes me appropriately
* **As Charlie,** I get immediate confirmation through voice that my emergency request is being treated as priority
* **As Charlie,** I can continue the conversation across channels (start with chat, escalate to voice call) with full context preservation

## 4. Detailed Feature Specifications (V4.1 Current Implementation)

### 4.1. Advanced Voice Agent System (Premium Implementation)

#### Premium Voice Infrastructure
* **OpenAI TTS Primary Integration:** 
  - **High-Quality Voice Models**: nova (default), alloy (professional), onyx (male), shimmer (energetic), echo (balanced), fable (expressive)
  - **Dynamic Audio Generation**: Real-time MP3 generation with temporary file management and automatic cleanup
  - **Intelligent Quality Selection**: Voice model selection based on plan tier and business configuration
  - **Fallback Architecture**: Seamless fallback to Twilio TTS with SSML enhancement when OpenAI services are unavailable
* **Advanced SSML Processing Pipeline:**
  - **Natural Conversation Flow**: Conversational interjections ("Got it," "Alright," "Perfect"), context-appropriate pauses
  - **Intelligent Emphasis**: Dynamic emphasis for important information and emergency situations
  - **Voice-Optimized Prompts**: Specialized system prompts designed specifically for voice interactions
  - **Response Cleaning**: Aggressive post-processing to ensure clean speech output with comprehensive prefix removal

#### Enterprise Session Management
* **Redis-Powered Architecture:**
  - **Primary Storage**: Redis with robust connection management, automatic reconnection, and health monitoring
  - **Intelligent Fallback**: In-memory session storage with automatic failover and advanced cleanup
  - **Connection Resilience**: Comprehensive error handling with exponential backoff and connection status tracking
  - **Performance Optimization**: Configurable session limits, memory monitoring, and automated resource management
* **Advanced Session Analytics:**
  - **Real-Time Tracking**: Live conversation monitoring with intent classification and entity extraction
  - **Comprehensive Metrics**: Call duration, message count, entity extraction, and conversation analytics
  - **Health Monitoring**: Continuous system health checks with detailed component status reporting
  - **Memory Management**: Optional verbose logging, memory usage tracking, and automated cleanup systems

#### Production-Ready Health Monitoring
* **System Health Dashboard:**
  ```json
  {
    "status": "healthy",
    "memory": {
      "heapUsed": 156.7,
      "heapTotal": 234.5,
      "heapUsedPercent": 67
    },
    "redis": {
      "connected": true,
      "reconnectAttempts": 0,
      "consecutiveFailures": 0
    },
    "sessions": {
      "activeVoiceSessions": 12,
      "totalActiveSessions": 45,
      "averageSessionDuration": 180
    },
    "environment": {
      "nodeEnv": "production",
      "memoryMonitoringEnabled": true,
      "redisConfigured": true
    }
  }
  ```
* **Advanced Monitoring Features:**
  - **Memory Alerts**: Configurable thresholds with automatic alerting for high memory usage
  - **Redis Health Checks**: Continuous connectivity monitoring with smart reconnection strategies
  - **Session Analytics**: Active session tracking, cleanup statistics, and performance metrics
  - **Component Status**: Detailed health status for all system components with latency monitoring

### 4.2. Plan Tier System (Fully Implemented)

#### FREE Tier Features
* **Chat Widget:** Basic functionality with system branding visible
* **Lead Capture:** Up to 5 questions maximum
* **FAQ System:** Standard RAG-based knowledge base querying
* **Email Notifications:** Basic lead alerts
* **Analytics:** Basic conversation logging

#### BASIC Tier Features
* **Enhanced Chat:** Advanced conversation flows with system branding
* **Unlimited Lead Capture:** No question limits with advanced mapping
* **Priority Notifications:** Enhanced email alerts with better formatting
* **Basic Analytics:** Conversation history and basic metrics
* **Knowledge Base:** Enhanced management interface

#### PRO Tier Features (Premium)
* **Full Voice Agent:** Complete Twilio integration with custom phone numbers
* **Advanced Voice Configuration:**
  - Custom voice greetings and completion messages
  - Emergency-specific messaging
  - End-call message customization
  - Voice and language selection interface
* **Premium Voice Options:** Access to Neural and Generative voices
* **Emergency Voice Calls:** Immediate voice notifications to business owners
* **Advanced Analytics:** Session tracking, entity extraction, intent analysis
* **Branding Removal:** Clean, professional interface without system branding
* **Priority Support:** Enhanced customer service level

### 4.3. Enhanced Emergency Handling (Cross-Channel)

#### Emergency Detection Engine
* **Multi-Channel Recognition:** Works across both chat and voice interactions
* **Intent Classification:** Advanced emergency keyword detection with context analysis
* **Priority Scoring:** Automatic priority assignment (LOW, NORMAL, HIGH, URGENT)
* **Essential Question Flagging:** `isEssentialForEmergency` database field for streamlined flows

#### Emergency Response System
* **Immediate Voice Alerts (PRO):** SSML-enhanced phone calls to business owners
* **Priority Email Notifications:** Enhanced formatting with emergency indicators
* **Context Preservation:** Full conversation context maintained across channels
* **Emergency Notes:** Dedicated field for emergency-specific information capture

### 4.4. Advanced Session Management & Analytics

#### Redis-Powered Architecture
* **Primary Session Storage:** Redis with comprehensive connection management and automatic reconnection
* **Intelligent Fallback:** In-memory session storage with automatic failover and cleanup
* **Health Monitoring:** Continuous Redis health checks with exponential backoff and connection status tracking
* **Session Cleanup:** Automatic session expiration, memory optimization, and resource management
* **Memory Monitoring:** Optional verbose logging and memory usage tracking for production debugging

#### Enhanced Voice Session Service
* **Comprehensive Session Tracking:** Advanced conversation history with timestamp precision and metadata
* **Entity Extraction & Storage:** Automatic extraction and storage of emails, phones, names, dates, amounts, locations
* **Intent Classification:** Real-time intent identification with confidence scoring and context preservation
* **Flow State Management:** Detailed flow tracking with primary/sub-flow states and completion tracking
* **Session Analytics:** Call duration, message count, entity extraction, and conversation analytics
* **Performance Optimization:** Memory-efficient session management with configurable limits and cleanup

#### Analytics Dashboard (PRO Feature)
* **Real-Time Metrics:** Live session tracking with Redis connection status and health monitoring  
* **Voice Call Analytics:** Call duration, transcription accuracy, and voice action usage statistics
* **Intent Analysis:** Classification accuracy, confidence scoring, and conversation flow analysis
* **Entity Extraction Dashboard:** Contact information capture rates and entity recognition performance
* **System Health Monitoring:** Memory usage, Redis status, session counts, and performance metrics

### 4.5. Enhanced Admin Interface (Plan-Aware)

#### Plan-Based UI Rendering
* **Conditional Features:** UI elements show/hide based on user's plan tier
* **Upgrade Prompts:** Clear calls-to-action for tier upgrades
* **Feature Previews:** Visual indicators of PRO-only features

#### Voice Configuration Interface (PRO Only)
* **Message Customization:**
  - Voice greeting message
  - Lead completion message
  - Emergency-specific messaging
  - End-call message
* **Voice Selection:** Dropdown interface with categorized voice options
* **Language Configuration:** Multi-language support with voice matching
* **SSML Preview:** Live testing of voice messages with SSML markup

### 4.6. Enhanced Chat Widget (Multi-Channel Integration)

#### Core Chat Features
* **Dynamic Configuration:** Plan-aware feature loading
* **Voice Integration Hooks:** Seamless transition capabilities to voice calls
* **Emergency Awareness:** Priority handling for urgent chat interactions
* **Session Continuity:** Context preservation across channel switches

#### Plan-Based Widget Behavior
* **Branding Display:** Conditional system branding based on plan tier
* **Feature Availability:** Access to advanced features based on subscription
* **Upgrade Integration:** In-widget upgrade prompts for premium features

### 4.7. Advanced System Architecture (Production-Ready)

#### Memory Management & Optimization
* **Intelligent Resource Management:**
  - **Configurable Limits**: MAX_IN_MEMORY_SESSIONS (100), SESSION_TIMEOUT (30 minutes), MAX_MEMORY_USAGE (1536MB)
  - **Automated Cleanup**: Regular session cleanup with configurable intervals and memory optimization
  - **Memory Monitoring**: Optional detailed memory tracking with configurable logging levels
  - **Performance Optimization**: Conversation history limits, session bounds enforcement, and efficient cleanup algorithms

#### Enhanced Error Handling & Resilience
* **Redis Connection Management:**
  - **Smart Reconnection**: Exponential backoff with maximum retry limits and connection state tracking
  - **Graceful Degradation**: Seamless fallback to in-memory storage with full feature preservation
  - **Health Monitoring**: Continuous connectivity checks with intelligent backoff and status reporting
  - **Resource Cleanup**: Proper connection cleanup and graceful shutdown handling

#### Advanced Audio Processing
* **OpenAI TTS Integration:**
  - **Voice Model Selection**: Dynamic selection based on business configuration and plan tier
  - **Audio File Management**: Temporary file generation with automatic cleanup and security validation
  - **Quality Optimization**: High-quality MP3 generation with optimized settings for voice calls
  - **Error Handling**: Comprehensive fallback systems with detailed error logging and recovery

## 5. Technical Architecture Overview (Current V4.1)

### 5.1. Core Infrastructure
* **Containerized Application:** Docker-based deployment with multi-service architecture and health monitoring
* **Database:** PostgreSQL with pgvector extension for AI embeddings and comprehensive lead management
* **Advanced Session Management:** 
  - **Primary:** Redis with robust connection management, automatic reconnection, and health monitoring
  - **Intelligent Fallback:** In-memory session storage with automatic cleanup and memory optimization
  - **Session Service:** Enhanced VoiceSessionService with comprehensive analytics and entity extraction
* **Voice Infrastructure:** Twilio Voice API with webhook handling and OpenAI TTS integration

### 5.2. AI & Voice Processing
* **OpenAI Integration:** 
  - **Conversation AI:** GPT-4 for intelligent conversations with voice-optimized prompts
  - **Speech Recognition:** Whisper for high-accuracy transcription with noise filtering
  - **Advanced TTS:** OpenAI voice models (nova, alloy, onyx, etc.) with dynamic audio generation
  - **Embeddings:** text-embedding-3-small for RAG-based knowledge retrieval
* **Enhanced SSML Processing:** Advanced speech synthesis with natural language patterns, conversational flow, and intelligent emphasis
* **Entity Extraction:** Advanced NLP for real-time contact information and intent classification with confidence scoring
* **Voice Optimization:** Specialized prompts and processing for voice interactions with dynamic action determination

### 5.3. API Architecture & Session Management
* **RESTful Design:** Express.js-based API with comprehensive error handling and plan-aware middleware
* **Voice Webhook System:** Enhanced Twilio webhook handling for voice events with session management
* **Authentication:** JWT-based security with plan-aware middleware and secure session management
* **Advanced Session Storage:**
  - **Redis Client Management:** Singleton pattern with connection pooling and automatic failover
  - **Session Analytics:** Real-time conversation tracking with entity extraction and intent classification
  - **Memory Optimization:** Configurable session limits, automatic cleanup, and memory monitoring
  - **Health Monitoring:** Continuous Redis health checks with exponential backoff and status reporting
* **Rate Limiting:** Plan-based API access controls with session-aware throttling

## 6. Future Roadmap (V5.0+ Features)

### 6.1. Advanced AI Capabilities
* **Enhanced Voice Features:**
  - **Voice Cloning**: Custom voice synthesis for brand consistency using OpenAI's advanced voice capabilities
  - **Multi-Language Expansion**: Additional language support with native voice models
  - **Contextual Voice Adaptation**: Dynamic voice characteristics based on conversation context and customer sentiment
  - **Advanced SSML**: Enhanced markup for even more natural conversations with emotion and tone control

### 6.2. Enterprise Session Management
* **Advanced Analytics Platform:**
  - **Predictive Analytics**: Machine learning insights for customer behavior prediction and optimization
  - **Advanced Reporting**: Comprehensive dashboards with custom metrics and business intelligence
  - **Performance Optimization**: AI-driven session management and resource allocation
  - **Enterprise Integration**: Advanced CRM synchronization with session analytics and customer journey tracking

### 6.3. Self-Service SaaS Platform
* **Automated Onboarding:** Wizard-based setup for new businesses
* **Subscription Management:** Stripe-powered billing with automatic tier management
* **Usage Analytics:** Detailed reporting on agent performance and ROI
* **White-Label Options:** Custom branding solutions for agencies

### 6.4. Mobile & Advanced Features
* **Native Mobile Apps:** iOS/Android applications for business owners
* **Push Notifications:** Real-time mobile alerts for critical interactions
* **Offline Capability:** Basic functionality during connectivity issues
* **Advanced Analytics:** Machine learning insights for business optimization

This comprehensive platform now serves as a complete multi-channel AI solution for SMBs, with sophisticated voice capabilities, intelligent emergency handling, and scalable plan-based architecture that grows with business needs. 