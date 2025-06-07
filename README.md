# Leads Support AI Agent for SMBs

## 🚀 Overview

The Leads Support AI Agent is a sophisticated, multi-tenant, **voice and chat-enabled** AI platform designed to empower Small to Medium-Sized Businesses (SMBs). Beyond the original chat functionality, the system now includes a comprehensive **Voice Agent System** with Twilio integration, **Plan-Based Feature Tiers**, and **Enhanced Emergency Handling**. The platform automates customer interactions across multiple channels, captures leads effectively 24/7, provides instant answers to frequently asked questions using business-specific knowledge bases, and handles voice calls with natural speech synthesis and advanced conversation management.

This project uses a Dockerized environment for consistent development and is designed for deployment on platforms like Render.

## ✨ Current Features

### 🎯 Core AI Capabilities
* **Multi-Channel AI Agent:** Supports both chat widget and voice calls
* **Advanced Intent Classification:** Accurately determines user intent across channels
* **RAG-based FAQ Answering:** Retrieves information from custom knowledge bases using vector embeddings
* **Emergency Detection & Prioritization:** Sophisticated emergency identification with priority routing
* **Voice-Optimized AI Processing:** SSML-enhanced responses with natural conversational interjections

### 📞 Voice Agent System (NEW)
* **Twilio Integration:** Complete voice calling infrastructure with business phone number routing
* **Incoming Call Handling:** Automatic call routing and management with intelligent session tracking
* **Advanced Speech Processing:** 
  - OpenAI Whisper transcription with noise filtering and accuracy optimization
  - AI-powered response generation with voice-specific conversation flow
  - **OpenAI TTS Integration:** High-quality text-to-speech using advanced AI voice models
  - Intelligent fallback to Twilio TTS for reliability
* **Enhanced Speech Synthesis:** SSML-enhanced natural speech with multiple voice options:
  - **Standard Voices:** Alice, Man, Woman (Twilio TTS)
  - **Premium AI Voices (PRO):** OpenAI voice models (nova, alloy, onyx, echo, fable, shimmer)
  - **Premium Voices (PRO):** Amazon Polly Neural voices with enhanced naturalness
  - **Generative Voices (PRO):** Google Chirp3-HD, Amazon Polly Generative
* **Multi-Language Support:** English (US/UK/AU), Spanish, French, German, Italian, Portuguese
* **Dynamic Voice Actions:** CONTINUE, HANGUP, TRANSFER, VOICEMAIL routing with intelligent flow management
* **Advanced Session Management:** Redis-backed VoiceSessionService with comprehensive analytics and fallback
* **Real-time Analytics:** Conversation tracking, intent analysis, entity extraction, and call performance metrics

### 💎 Plan Tier System (NEW)
* **Three-Tier Structure:** FREE, BASIC, PRO with progressive feature access
* **Feature Gating:** Plan-based access control for advanced features
* **PRO-Exclusive Voice Features:** Advanced voice configuration only available for PRO tier
* **Branding Control:** Visibility management based on plan tier

### 🚨 Enhanced Emergency Handling (NEW)
* **Multi-Channel Emergency Detection:** Works across chat and voice interactions
* **Priority Voice Calls:** Urgent notifications to business owners with SSML-enhanced messaging
* **Essential Question Flagging:** `isEssentialForEmergency` flag for streamlined emergency flows
* **Enhanced Emergency Transcription:** Detailed emergency information in notifications

### 📊 Session Management & Analytics (NEW)
* **Advanced Redis Implementation:** Robust Redis storage with intelligent connection management and automatic reconnection
* **Enhanced VoiceSessionService:** Comprehensive session management with entity extraction and intent classification
* **Intelligent Fallback System:** Automatic failover to in-memory storage with cleanup and optimization
* **Real-Time Analytics:** Session tracking with conversation analytics, entity extraction, and intent confidence scoring
* **Health Monitoring:** Continuous system health checks with Redis status monitoring and memory usage tracking
* **Performance Optimization:** Configurable session limits, automatic cleanup, and memory management
* **Session Analytics Dashboard:** Call duration, message counts, intent analysis, and entity extraction metrics

### 🎛️ Advanced Admin Interface
* **Voice Configuration:** PRO-tier voice message customization and settings
* **Plan-Based UI:** Conditional feature rendering based on subscription tier
* **Enhanced Lead Management:** Improved lead tracking with emergency prioritization
* **Voice Analytics Dashboard:** Call statistics and voice interaction insights

### 💬 Chat Widget (Enhanced)
* **AI-Powered Chat Widget:** Lightweight JavaScript widget embeddable on any SMB website
* **Intelligent Conversation Flows:** Enhanced with voice integration capabilities
* **Configurable Lead Capture:** Guides users through business-specific question sequences
* **Emergency-Aware Interface:** Prioritizes emergency interactions

### 🔔 Advanced Notifications
* **Multi-Channel Notifications:** Email and voice-based alert system
* **Emergency Prioritization:** Urgent lead alerts with enhanced messaging
* **Customer Confirmations:** Automated confirmation across channels
* **SSML-Enhanced Voice Notifications:** Natural speech synthesis for voice alerts

### 🎨 Admin Dashboard
* **Secure JWT Authentication:** HttpOnly cookie-based security
* **Comprehensive Agent Configuration:** Chat and voice settings management
* **Advanced Lead Management:** Full CRUD with emergency flagging and analytics
* **Knowledge Base Management:** Enhanced with voice-optimized content
* **Voice Settings (PRO):** Advanced voice configuration for premium users

## 🛠️ Technology Stack

### Backend & Core
* **Backend:** Node.js, Express.js, TypeScript
* **Database:** PostgreSQL with `pgvector` extension
* **ORM:** Prisma
* **Session Management:** Redis with in-memory fallback
* **Authentication:** JWT with `bcrypt` password hashing

### AI & Voice Processing
* **AI & NLP:** OpenAI API (GPT models, Whisper, OpenAI TTS voice models, text-embedding-3-small)
* **Voice Infrastructure:** Twilio Voice API with OpenAI TTS integration
* **Advanced Speech Synthesis:** SSML with multiple TTS providers and intelligent fallback
* **Enhanced Entity Extraction:** Real-time NLP for voice and chat interactions with confidence scoring
* **Session Analytics:** VoiceSessionService with comprehensive conversation tracking and intent analysis

### Frontend & Integration
* **Chat Widget:** Vanilla JavaScript with voice integration hooks
* **Admin Dashboard:** EJS templates with enhanced JavaScript interactions
* **Voice Interface:** Twilio-powered voice interaction system

### Development & Deployment
* **Development Server:** `nodemon`, `ts-node`
* **Package Manager:** Yarn (recommended)
* **Containerization:** Docker, Docker Compose
* **Email Service:** Nodemailer

## 📋 Prerequisites

Ensure the following are installed on your local development machine:
* [Git](https://git-scm.com/)
* [Node.js](https://nodejs.org/) (Latest LTS version recommended, ideally managed via [NVM](https://github.com/nvm-sh/nvm))
* [Yarn Package Manager (v1.x)](https://classic.yarnpkg.com/en/docs/install)
* [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Ensure it is running)
* [Redis](https://redis.io/) (for session management - can be Docker-based)

## ⚙️ Project Setup & Running (Docker-First for Development)

This project is best developed and run using the provided Docker configuration for stability.

### 1. Clone the Repository
If you haven't already, clone the project to your local machine:
```bash
git clone <your-repository-url>
cd leads-support-agent-smb
```

### 2. Create and Configure the .env File
This file stores your environment-specific variables and secrets. It is not committed to Git.

In the root of the project (leads-support-agent-smb/), create a file named `.env`.

Add the following variables, replacing placeholder values with your actual credentials:

```bash
# Application Port (used by Docker Compose to expose the app container)
PORT=3000

# Database URL for LOCAL PRISMA STUDIO to connect to the DOCKERIZED PostgreSQL database.
DATABASE_URL="postgresql://db_user:db_password@localhost:5433/app_db?schema=public"
DIRECT_URL="postgresql://db_user:db_password@localhost:5433/app_db?schema=public"

# Redis Configuration (for session management)
REDIS_URL="redis://localhost:6379"

# Secrets (Generate strong random strings for these)
JWT_SECRET="YOUR_VERY_STRONG_RANDOM_JWT_SECRET_HERE"

# OpenAI API Key
OPENAI_API_KEY="sk-YOUR_OPENAI_API_KEY_HERE"

# Twilio Configuration (for voice features)
TWILIO_ACCOUNT_SID="AC_YOUR_TWILIO_ACCOUNT_SID"
TWILIO_AUTH_TOKEN="your_twilio_auth_token"
TWILIO_WEBHOOK_BASE_URL="https://your-domain.com"

# Node Environment for local Docker development
NODE_ENV=development

# Frontend URLs for CORS
APP_PRIMARY_URL=http://localhost:3000 
ADMIN_CUSTOM_DOMAIN_URL=https://app.cincyaisolutions.com
WIDGET_DEMO_URL=https://demo.cincyaisolutions.com
WIDGET_TEST_URL=http://127.0.0.1:8080
```

**Important Voice Features Note:** The voice agent system requires Twilio configuration for full functionality. PRO tier features include advanced voice customization and premium voice options.

### 3. Build and Start Docker Containers
Make sure Docker Desktop is running. In your project root terminal:

Build the application image (if first time or Dockerfile changes):
```bash
docker-compose build
# (Or docker compose build for newer Docker CLI syntax)
```

Start the application and database containers:
```bash
docker-compose up
# (Or docker compose up)
```
This will show combined logs from the app and db services. The app service will run `yarn dev`.

### 4. Run Database Migrations (First Time Setup or Schema Changes)
Once docker-compose up shows the database (db service) is healthy and the app (app service) is running or trying to start:

1. Open a new, separate terminal window.
2. Navigate to your project root.
3. Execute the Prisma migrate command inside the running app container:
```bash
docker-compose exec app npx prisma migrate dev --name initial_docker_setup
# (Or docker compose exec app .... Use a descriptive migration name.)
```
This creates tables in your Dockerized PostgreSQL database.

### 5. Accessing the Application (Locally via Docker)
* **AI Agent Backend API & Admin UI:** http://localhost:3000
* **Admin Login Page:** http://localhost:3000/admin/login
* **System Health Check:** http://localhost:3000/health (includes Redis status and session analytics)
* **Voice System Health:** http://localhost:3000/api/voice/health (detailed voice system monitoring)
* **Voice Webhook Endpoints:** http://localhost:3000/api/voice/* (Twilio integration)
* **Chat Widget Script:** http://localhost:3000/widget.js
* **Session Analytics:** Available in admin dashboard for PRO users with Redis status monitoring

### 6. Testing the Chat Widget Locally
Create a test.html file in your project root (if not already present):
```html
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Widget Test</title></head>
<body>
    <h1>My Local Test Site for Widget</h1>
    <script src="http://localhost:3000/widget.js" data-business-id="YOUR_TEST_BUSINESS_ID_FROM_DOCKER_DB" defer></script>
</body>
</html>
```

Replace `YOUR_TEST_BUSINESS_ID_FROM_DOCKER_DB` with a valid Business ID from your Dockerized database.

Serve this test.html file using live-server:
1. Ensure live-server is installed: `npm install -g live-server` (or `yarn global add live-server`).
2. In a new terminal, `cd` to your project root (or where test.html is).
3. Run `live-server`. It will open the page, usually at http://127.0.0.1:8080.
4. Your backend's CORS configuration (using WIDGET_TEST_URL=http://127.0.0.1:8080 from .env passed to Docker) should allow this.

### 7. Accessing the Dockerized Database with Prisma Studio
To view/edit data in the Dockerized PostgreSQL database using Prisma Studio from your Mac:

1. Ensure your local .env file (in the project root on your Mac) has DATABASE_URL and DIRECT_URL pointing to localhost:5433 (as shown in Setup Step 2).
2. Ensure your Docker containers are running (`docker-compose up`).
3. In a new terminal window (on your Mac, in the project root), run:
```bash
npx prisma studio
```
This opens Prisma Studio in your browser at http://localhost:5555, connected to the database inside your Docker db container.

## 🎯 Plan Tiers & Features

### FREE Tier
* Basic chat widget functionality
* Standard FAQ answering
* Basic lead capture (5 questions max)
* Email notifications
* Branding visible

### BASIC Tier  
* Enhanced chat capabilities
* Advanced lead capture (unlimited questions)
* Priority email notifications
* Branding visible
* Basic analytics

### PRO Tier
* **Full Voice Agent System** with Twilio integration
* **Advanced Voice Configuration** (greetings, voices, languages)
* **Premium Voice Options** (Polly Neural, Generative voices)
* **Emergency Voice Calls** to business owners
* **Advanced Analytics & Session Management**
* **Branding Hidden**
* **Priority Support**

## 📜 Key Scripts (package.json)

Voice and session-enhanced development commands:

```bash
# Development with voice features enabled
docker-compose exec app yarn dev

# Voice-specific database migrations
docker-compose exec app npx prisma migrate dev --name voice_features

# Redis session cleanup (if needed)
docker-compose exec app yarn redis:cleanup

# Voice webhook testing
docker-compose exec app yarn test:voice
```

## 📁 Enhanced Project Structure

```
leads-support-agent-smb/
├── prisma/                     # Enhanced schema with voice & plan features
│   └── schema.prisma          # Includes PlanTier enum, voice fields
├── public/                     # Static assets with voice integration
│   └── widget.js              # Enhanced with plan-aware features
├── src/
│   ├── api/                    # Express route handlers
│   │   ├── admin.ts           # Enhanced with plan-based features  
│   │   ├── voiceRoutes.ts     # NEW: Twilio voice integration
│   │   ├── chatRoutes.ts      # Enhanced with voice compatibility
│   │   └── viewRoutes.ts      # Plan-aware view rendering
│   ├── core/                   # Enhanced AI and business logic
│   │   ├── aiHandler.ts       # Voice-optimized AI processing
│   │   └── ragService.ts      # Enhanced for voice contexts
│   ├── services/               # Service layer
│   │   ├── voiceSessionService.ts  # NEW: Redis session management
│   │   ├── notificationService.ts  # Enhanced with voice notifications
│   │   └── openai.ts          # Enhanced with voice processing
│   ├── utils/                  # Helper functions
│   │   ├── voiceHelpers.ts    # NEW: Voice processing utilities
│   │   └── planUtils.ts       # NEW: Plan tier management
│   └── types/                  # TypeScript definitions
│       └── voice.ts           # NEW: Voice-related types
```

## 🚀 Recent Major Updates

### Voice Agent System
* Complete Twilio integration with webhook handling
* Advanced speech synthesis with SSML support
* Multi-language and multi-voice support
* Voice session management with Redis
* Real-time voice analytics and monitoring

### Plan Tier Implementation
* Three-tier subscription model (FREE/BASIC/PRO)
* Feature gating based on plan level
* Plan-aware UI rendering throughout admin interface

### Enhanced Emergency System
* Cross-channel emergency detection
* Priority voice notifications for urgent leads
* Essential question flagging for emergency flows
* Enhanced emergency transcription and routing

### Advanced Analytics
* Session-based conversation tracking
* Entity extraction and intent classification
* Voice call duration and interaction metrics
* Health monitoring with Redis integration

This enhanced platform now provides SMBs with a comprehensive AI solution that handles both chat and voice interactions, with sophisticated emergency handling and plan-based feature access.

## 📜 Key Scripts (package.json)

These are run using `yarn <scriptname>` (or `npm run <scriptname>`). When using Docker for development, most are run via `docker-compose exec app yarn <scriptname>` or are part of the Dockerfile/docker-compose.yml commands.

* `"dev": "nodemon src/server.ts"`: Starts the development server with hot-reloading using nodemon and ts-node. (This is the default command for the app service in docker-compose.yml).
* `"build": "yarn prisma:generate && tsc"`: Generates Prisma Client and compiles TypeScript to JavaScript (output to dist/ folder).
* `"start": "node dist/server.js"`: Runs the compiled JavaScript application (for production).
* `"prisma:generate": "prisma generate"`: Generates Prisma Client.
* `"prisma:migrate": "prisma migrate dev"`: Creates and applies a new database migration during development.

Running Prisma commands with Docker:
```bash
docker-compose exec app npx prisma migrate dev --name <migration_name>
docker-compose exec app yarn prisma:generate # (or docker-compose exec app npx prisma generate)
docker-compose exec app npx prisma db seed # (if you set up a seed script)
```

## 📁 Project Structure Overview

```
leads-support-agent-smb/
├── prisma/                     # Prisma schema, migrations
│   └── schema.prisma
├── public/                     # Static assets for chat widget
│   └── widget.js
├── src/
│   ├── api/                    # Express route handlers
│   │   ├── admin.ts            # Admin API routes (CRUD for configs, leads)
│   │   ├── authMiddleware.ts   # JWT Authentication middleware
│   │   ├── chatRoutes.ts       # Public chat API endpoint
│   │   └── viewRoutes.ts       # Routes for rendering EJS admin views
│   ├── core/                   # Core AI and business logic
│   │   ├── aiHandler.ts        # Main message processing, intent, flows
│   │   └── ragService.ts       # RAG logic, embedding search
│   ├── services/               # External service integrations & clients
│   │   ├── db.ts               # Prisma client instance
│   │   ├── notificationService.ts # Email notification logic
│   │   └── openai.ts           # OpenAI API client wrapper
│   ├── views/                  # EJS templates for Admin Dashboard
│   │   ├── login.ejs
│   │   ├── dashboard.ejs
│   │   ├── agent-settings.ejs
│   │   ├── lead-questions.ejs
│   │   ├── knowledge-base.ejs
│   │   └── view-leads.ejs
│   └── server.ts               # Express server setup, main application entry point
├── .env                        # Local environment variables (gitignored)
├── .dockerignore               # Files/folders to ignore for Docker builds
├── .gitignore                  # Files/folders to ignore for Git
├── Dockerfile                  # Instructions to build the application Docker image
├── docker-compose.yml          # Defines and runs multi-container Docker app (app + DB)
├── nodemon.json                # Nodemon configuration
├── package.json                # Project dependencies and scripts
├── tsconfig.json               # TypeScript compiler configuration
└── yarn.lock                   # Yarn lockfile for consistent dependency versions
```

## ☁️ Deployment Overview (Render.com)

This application is designed to be deployed as a Dockerized Web Service on Render.com, with a separate PostgreSQL instance also managed by Render.

* **Git Repository:** Code is hosted on GitHub/GitLab.
* **Render PostgreSQL:** A managed PostgreSQL instance on Render (with pgvector extension available, e.g., by using an image like pgvector/pgvector or ensuring the chosen Render Postgres version supports it).
* **Render Web Service:**
    * Connects to the Git repository.
    * Uses the Dockerfile for building the production image.
    * Environment variables are set in the Render dashboard (for DATABASE_URL pointing to Render's internal DB URL, OPENAI_API_KEY, JWT_SECRET, NODE_ENV=production, and various FRONTEND_URLS for CORS).
    * Start command is `yarn start` (which runs `node dist/server.js`).
* **Migrations on Render:** After a successful deploy, database migrations are applied using Render's environment or by remotely connecting: `npx prisma migrate deploy`.
* **Custom Domains:** Configured on Render and Namecheap (or other DNS provider) for app.cincyaisolutions.com (pointing to Render Web Service) and demo.cincyaisolutions.com (pointing to a static site host like Vercel).

## 🔮 Future Enhancements (V1.1 / V2 and Beyond)

* **Advanced AI:** AI-driven clarifying questions, deeper contextual memory.
* **Admin UI Full CRUD:** Complete Edit/Delete for all manageable entities. Advanced Lead Management (filtering, sorting, detailed views).
* **Multi-Channel:** SMS/Voice (Twilio), Social Media DMs.
* **Integrations:** CRMs (HubSpot, Salesforce, etc.).
* **Widget UI:** More customization, proactive triggers, voice input.
* **SaaS Features:** User self-signup, billing/subscription tiers, onboarding wizards.
* **Analytics & Reporting** for SMBs on agent performance.
* **Comprehensive automated testing.** # Deployment trigger - Thu Jun  5 13:42:24 EDT 2025
