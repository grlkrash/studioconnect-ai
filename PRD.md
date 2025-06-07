# Product Requirements Document: Leads Support AI Agent
**Version:** 4.0 (Voice Agent & Plan Tier Implementation)
**Date:** December 2024
**Project Owner:** Sonia
**Author:** AI Assistant (in collaboration with Sonia)

## 1. Introduction

### 1.1. Purpose of this Document
This document defines the product requirements, features, and strategic vision for the "Leads Support AI Agent" (hereinafter "the Agent"). It details the **Voice-Enabled Multi-Channel Platform** that has evolved from the original MVP to include comprehensive voice calling capabilities, plan-based feature tiers, enhanced emergency handling, and advanced analytics. The system is currently deployed and operational with both chat and voice functionalities.

### 1.2. Project Vision
To empower Small to Medium-Sized Businesses (SMBs) with an intelligent, **multi-channel AI platform** that seamlessly handles both chat and voice interactions. The Agent provides 24/7 availability across communication channels, sophisticated emergency detection and response, plan-based access to advanced features that scale with business needs, and comprehensive analytics to help SMBs understand and optimize their customer interactions.

### 1.3. Product Goals

#### Current Implementation (V4.0 - Fully Deployed)
* **Voice-Enabled AI Platform:** Complete integration with Twilio for incoming call handling, speech processing, and natural language voice responses
* **Plan-Tier Architecture:** Three-tier system (FREE, BASIC, PRO) with progressive feature access and plan-based UI rendering
* **Enhanced Emergency System:** Cross-channel emergency detection with priority voice notifications and essential question flagging
* **Advanced Session Management:** Redis-backed session storage with comprehensive analytics and health monitoring
* **Multi-Channel Lead Capture:** Seamless lead management across chat and voice with sophisticated routing

#### Achieved Core Features
* **Sophisticated Voice Agent:**
  - Twilio integration with webhook handling for incoming calls
  - OpenAI Whisper transcription and SSML-enhanced speech synthesis
  - Multiple voice options (Standard, Premium Neural, Generative)
  - Multi-language support (English variants, Spanish, French, German, Italian, Portuguese)
  - Dynamic voice actions (CONTINUE, HANGUP, TRANSFER, VOICEMAIL)
* **Advanced Analytics Platform:**
  - Session-based conversation tracking with Redis
  - Entity extraction and intent classification
  - Voice call duration and interaction metrics
  - Health monitoring with system status dashboards
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
* **In Scope (Current V4.0 Implementation):** All voice agent features, plan tier system, enhanced emergency handling, Redis session management, advanced analytics
* **Phase 1 Future Development:** CRM integrations, advanced voice features, mobile applications
* **Phase 2 Future Development:** Self-service SaaS platform, automated billing, advanced AI capabilities

## 2. Product Overview

### 2.1. Core Problem & Solution
SMBs lose significant business opportunities due to inability to handle immediate customer needs, especially emergency situations, across multiple communication channels. The Voice-Enabled AI Agent provides comprehensive coverage with intelligent routing, sophisticated emergency detection, and plan-based access to advanced features that scale with business needs.

### 2.2. Key Differentiators (Implemented & Validated)
* **True Multi-Channel Platform:** Seamless integration between chat and voice with unified session management
* **Advanced Emergency Response:** Cross-channel emergency detection with priority voice notifications to business owners
* **Plan-Based Value Proposition:** Clear feature progression from FREE to BASIC to PRO tiers
* **Voice-First Design:** SSML-enhanced natural speech synthesis optimized for business conversations
* **Sophisticated Analytics:** Real-time session tracking with entity extraction and intent analysis
* **Service SMB Focus:** Built specifically for emergency-responsive service businesses

## 3. User Personas & Stories (Current Implementation)

### 3.1. Helen the HSP (Plumber) - PRO Tier User
* **As Helen,** I receive voice calls directly to my business number when customers have plumbing emergencies, and the AI handles initial triage with natural conversation
* **As Helen,** I get immediate voice calls to my mobile when the AI detects flooding or burst pipe emergencies, with enhanced SSML messaging for urgency
* **As Helen,** I can customize voice greetings and messages for my specific business needs in my PRO admin dashboard
* **As Helen,** I access detailed analytics showing call duration, intent analysis, and peak emergency times to optimize my response strategy
* **As Helen,** I can choose from premium voice options (Polly Neural, Generative) to match my brand personality

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

## 4. Detailed Feature Specifications (V4.0 Current Implementation)

### 4.1. Voice Agent System (Complete Implementation)

#### Voice Infrastructure
* **Twilio Integration:** Complete webhook system handling incoming calls with business phone number routing
* **Advanced Speech Processing Pipeline:**
  - OpenAI Whisper transcription with noise filtering and accuracy optimization
  - AI-powered response generation with voice-specific optimization and natural conversational flow
  - **OpenAI TTS Integration:** High-quality text-to-speech using OpenAI's advanced voice models (alloy, echo, fable, onyx, nova, shimmer)
  - SSML-enhanced speech synthesis with intelligent fallback to Twilio TTS
  - Dynamic audio file generation and streaming for optimal voice quality
* **Voice Options (Plan-Dependent):**
  - **Standard (All Tiers):** Alice, Man, Woman (Twilio TTS)
  - **Premium (PRO Only):** Amazon Polly Neural voices with enhanced naturalness
  - **Advanced AI Voices (PRO Only):** OpenAI voice models with superior quality and conversational tone
  - **Generative (PRO Only):** Google Chirp3-HD, Amazon Polly Generative

#### Enhanced Voice Processing Features
* **Intelligent Voice Routing:** Automatic selection of optimal TTS provider based on plan tier and content type
* **Audio Quality Optimization:** Dynamic audio file generation with automatic cleanup and memory management
* **Voice Response Caching:** Efficient temporary audio file serving with security validation
* **Natural Conversation Flow:** Enhanced SSML processing with conversational interjections, appropriate pauses, and emphasis
* **Voice Action Intelligence:** Dynamic determination of next actions (CONTINUE, HANGUP, TRANSFER, VOICEMAIL) based on conversation context

#### Multi-Language Support
* **Supported Languages:** English (US/UK/AU), Spanish (es-ES/es-MX), French (fr-FR), German (de-DE), Italian (it-IT), Portuguese (pt-BR)
* **Voice Matching:** Automatic voice selection based on chosen language
* **SSML Localization:** Language-appropriate speech patterns and emphasis

#### Voice Session Management
* **Redis-Backed Sessions:** Robust session storage with automatic failover to in-memory backup
* **Session Analytics:** Real-time tracking of conversation flow, intent classification, entity extraction
* **Dynamic Actions:** CONTINUE, HANGUP, TRANSFER, VOICEMAIL routing based on conversation context

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

### 4.7. Advanced Notification System

#### Multi-Channel Notifications
* **Email Notifications:** Enhanced formatting with emergency prioritization
* **Voice Notifications (PRO):** SSML-enhanced phone calls for urgent leads
* **Customer Confirmation:** Automated confirmations across all channels
* **Analytics Integration:** Notification effectiveness tracking

#### SSML-Enhanced Voice Notifications
* **Natural Speech Patterns:** Conversational interjections and appropriate pauses
* **Urgency Emphasis:** Enhanced SSML markup for emergency situations
* **Business Context:** Personalized messaging with business-specific information

## 5. Technical Architecture Overview (Current V4.0)

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
* **Contextual Memory:** Cross-session conversation awareness
* **Proactive Engagement:** AI-initiated conversations based on website behavior
* **Voice Cloning:** Custom voice synthesis for brand consistency
* **Multi-Party Calls:** Conference call capabilities for complex service scenarios

### 6.2. Platform Integrations
* **CRM Synchronization:** Direct integration with HubSpot, Salesforce, industry-specific CRMs
* **Calendar Integration:** Automatic appointment scheduling with Google Calendar, Outlook
* **Payment Processing:** Integration with Stripe, Square for service booking
* **Inventory Management:** Connection to service management platforms

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