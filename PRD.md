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
* **Speech Processing Pipeline:**
  - OpenAI Whisper transcription with noise filtering
  - AI-powered response generation with voice optimization
  - SSML-enhanced speech synthesis with multiple voice providers
* **Voice Options (Plan-Dependent):**
  - **Standard (All Tiers):** Alice, Man, Woman
  - **Premium (PRO Only):** Amazon Polly Neural voices
  - **Generative (PRO Only):** Google Chirp3-HD, Amazon Polly Generative

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
* **Session Storage:** Robust Redis implementation with in-memory fallback
* **Real-Time Analytics:** Live conversation tracking with timestamp precision
* **Health Monitoring:** System status checks with Redis connectivity monitoring
* **Automatic Cleanup:** Session expiration and garbage collection

#### Analytics Dashboard (PRO Feature)
* **Session Metrics:** Duration, message count, completion rates
* **Intent Analysis:** Classification accuracy and confidence scoring
* **Entity Extraction:** Automatic capture of emails, phones, names, dates, amounts, locations
* **Call Analytics:** Voice-specific metrics including call duration and voice action usage

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
* **Containerized Application:** Docker-based deployment with multi-service architecture
* **Database:** PostgreSQL with pgvector extension for AI embeddings
* **Session Management:** Redis primary with in-memory fallback
* **Voice Infrastructure:** Twilio Voice API with webhook handling

### 5.2. AI & Voice Processing
* **OpenAI Integration:** GPT-4 for conversations, Whisper for transcription, text-embedding-3-small for RAG
* **SSML Processing:** Advanced speech synthesis with natural language patterns
* **Entity Extraction:** Advanced NLP for contact information and intent classification
* **Voice Optimization:** Specialized prompts and processing for voice interactions

### 5.3. API Architecture
* **RESTful Design:** Express.js-based API with comprehensive error handling
* **Webhook System:** Twilio webhook handling for voice events
* **Authentication:** JWT-based security with plan-aware middleware
* **Rate Limiting:** Plan-based API access controls

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