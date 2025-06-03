# Product Requirements Document: Leads Support AI Agent
**Version:** 3.0 (Post-MVP, Pre-Live Demo)
**Date:** June 2, 2025
**Project Owner:** Sonia
**Author:** Gemini AI Assistant (in collaboration with Sonia)

## 1. Introduction

### 1.1. Purpose of this Document
This document defines the product requirements, features, and strategic vision for the "Leads Support AI Agent" (hereinafter "the Agent"). It details the Minimum Viable Product (MVP) that has been developed, tested, and deployed to a staging/development environment on Render. It serves as a central reference for current functionality, future development, and stakeholder alignment.

### 1.2. Project Vision
To empower Small to Medium-Sized Businesses (SMBs) with an intelligent, affordable, and highly effective AI-powered chat assistant. The Agent aims to seamlessly integrate into their customer interaction workflows, dramatically enhancing customer engagement, automating and optimizing lead capture and qualification, providing 24/7 instant and accurate FAQ support, and ultimately enabling SMBs to save valuable time, minimize missed opportunities, and accelerate business growth.

### 1.3. Product Goals

#### MVP Goals (Functionally Achieved & Deployed to Staging)
* **Stable & Reliable Core Application:** A Dockerized backend application serving multiple SMB clients (multi-tenant by design) deployed on Render.
* **Intelligent Conversation Core:** Implement an AI core capable of:
    * Accurate user intent classification (FAQ, Lead Capture, Emergency Lead Capture, Other).
    * Effective FAQ answering using a Retrieval-Augmented Generation (RAG) system with business-specific knowledge bases and OpenAI embeddings.
    * A configurable, sequential lead capture flow that populates both structured lead data and specific contact fields.
* **Actionable Lead Management:**
    * Implement emergency lead prioritization.
    * Provide immediate email notifications to the SMB for new leads, highlighting urgency.
    * Provide automated email confirmation to the customer upon lead submission.
* **Functional Interfaces:**
    * Deliver a functional frontend chat widget (`widget.js`) easily embeddable on SMB websites.
    * Provide a secure Admin Dashboard for SMBs to:
        * Log in.
        * Configure core agent settings (Agent Name, Persona Prompt, Welcome Message, Chat Widget Color Theme).
        * Manage Lead Capture Questions (Add, View, Edit, Delete, including mapping to specific lead data fields like `contactName`, `contactEmail`, `contactPhone`).
        * Manage Knowledge Base content (Add, View, Edit, Delete, with automatic embedding generation and regeneration on updates).
        * View Captured Leads with key details populated and allow for status updates and internal notes.

#### Long-Term Goals (V1.1 and Beyond)
* Achieve a fully self-serve SaaS model enabling SMBs to independently sign up, subscribe, configure, and deploy the agent.
* Expand to multi-channel communication (SMS, Voice Calls via Twilio, Social Media DMs).
* Offer deep, bi-directional integrations with popular SMB CRMs (e.g., HubSpot, Salesforce, industry-specific CRMs).
* Continuously enhance AI capabilities: contextual awareness, proactive engagement, dynamic clarifying questions.
* Provide advanced analytics, reporting, and insights for SMBs on agent performance and lead quality.

### 1.4. Target Audience
Primary users are Small to Medium-Sized Businesses (SMBs) in service-oriented industries that rely heavily on inbound customer inquiries for lead generation, appointments, and sales. These businesses often face challenges with 24/7 availability, efficiently handling high volumes of repetitive questions, and promptly capturing and qualifying leads.

**Initial Customer Profiles (ICPs) for MVP focus:**
* **Home Service Professionals (HSPs):** Plumbers, electricians, HVAC technicians, landscapers, roofers, etc.
* **Real Estate Agencies & Agents.**
* **Law Offices** (for initial non-advisory information gathering and consultation scheduling).
* **Med Spas & Aesthetics Clinics** (for non-PHI related inquiries, service information, and appointment booking).

### 1.5. Scope
* **In Scope for Current MVP (Deployed):** All features listed under "MVP Goals" and detailed in Section 4.
* **Out of Scope for Current MVP (Future Considerations):** Direct billing/subscription management UI, self-serve signup, advanced multi-channel integrations beyond email, deep CRM syncs, full UI polish beyond basic functionality.

## 2. Product Overview

### 2.1. Core Problem & Solution
Many SMBs lose potential business and spend excessive time on repetitive inquiries due to limited availability and resources. The Leads Support AI Agent provides an always-on, intelligent chatbot that instantly engages website visitors, answers common questions accurately, captures and qualifies leads efficiently, and alerts the business to new opportunities, especially urgent ones.

### 2.2. Key Differentiators (Planned & Inherent)
* **Tailored for Service SMBs:** Focus on lead quality, emergency handling, and practical information delivery.
* **Ease of Configuration:** Admin dashboard designed for non-technical SMB owners.
* **RAG Accuracy:** Provides answers based on the SMB's own verified knowledge base.
* **Proactive Lead Handling:** Prioritization and immediate notifications for HSPs.
* **Affordability:** Designed to be accessible for SMB budgets.

## 3. User Personas & Stories (MVP Summary)

### 3.1. Helen the HSP (Plumber)
* **As Helen,** I want an AI agent to answer calls/chats about my service area and hours when I'm on a job, so I don't miss new customers.
* **As Helen,** I need the AI to get a customer's name, phone, email, and a description of their plumbing issue, so I have all the details before I call back.
* **As Helen,** if a customer says "my basement is flooding," I need an immediate alert (email, and ideally SMS/call later) so I can respond instantly.
* **As Helen,** I want to easily update the list of questions the AI asks and the answers it gives for FAQs via a simple web page.
* **As Helen,** I want to see a list of all leads captured, with their urgency and details clearly displayed, and be able to mark their status (e.g., "Contacted," "Job Booked").

### 3.2. Charlie the Client (Homeowner with a plumbing issue)
* **As Charlie,** when I have a burst pipe at night, I want to quickly tell a plumbing service my problem and know my request is received and treated as urgent.
* **As Charlie,** I want to ask about service costs or if they handle specific issues before committing to a call.
* **As Charlie,** I want to receive a confirmation that my service request was submitted successfully.

## 4. Detailed Feature Specifications (MVP - Current Deployed State)

### 4.1. AI Chat Widget (`widget.js`)
* **Embedding:** Deployed via a single `<script>` tag on the SMB's website, configured with a `data-business-id`. Dynamically determines API endpoint from its own load source.
* **User Interface:**
    * Fixed chat bubble button.
    * Click-to-open chat window with header (agent name, close button), scrollable message display area, text input field, and send button.
    * Basic color theme configurable via Admin Dashboard.
* **Core Functionality:**
    * Retrieves `businessId` from its `data-business-id` attribute.
    * Displays a welcome message (from `AgentConfig`) on first open.
    * Sends user messages to `POST /api/chat` backend endpoint.
    * Request payload includes `message`, `businessId`, and `conversationHistory`.
    * `conversationHistory` is maintained client-side as an array of `{role: 'user' | 'assistant', content: string}`.
    * Displays AI responses in the chat window.
    * Handles basic error display (e.g., "trouble connecting") if API connection fails.

### 4.2. AI Core Logic (`aiHandler.ts`, `ragService.ts`, `openai.ts`)
* **OpenAI Service (`openai.ts`):**
    * Initializes OpenAI client with `OPENAI_API_KEY` from environment.
    * Provides `getEmbedding(text, model)` (uses `text-embedding-3-small`).
    * Provides `getChatCompletion(userPrompt, systemPrompt, model)` (uses `gpt-4o` or configurable).
* **RAG Service (`ragService.ts`):**
    * `generateAndStoreEmbedding(knowledgeBaseId)`: Fetches `KnowledgeBase.content`, gets embedding via `openai.ts`, updates `KnowledgeBase` record with the vector.
    * `findRelevantKnowledge(userQuery, businessId, limit)`: Generates embedding for `userQuery`, performs vector similarity search (cosine distance) against `KnowledgeBase` entries for the `businessId` (where `embedding IS NOT NULL`), returns top `limit` results.
* **AI Handler (`aiHandler.ts` - `processMessage` function):**
    * **Intent Classification:** Uses `getChatCompletion` with a detailed prompt (including examples for FAQ, LEAD_CAPTURE, OTHER, and emergency indicators) and recent `conversationHistory` to classify intent.
    * Fetches `AgentConfig` (including ordered `questions`) for the `businessId`.
    * **FAQ Flow:**
        * If intent is "FAQ", calls `findRelevantKnowledge`.
        * If context found, constructs prompt for `getChatCompletion` using `AgentConfig.personaPrompt`, retrieved context, and user's question.
        * Returns AI-generated answer or "I don't have that information" if context is insufficient.
        * If no context found by RAG, returns a polite "I couldn't find specific information" message.
    * **Lead Capture Flow:**
        * If intent is "LEAD_CAPTURE" (or includes emergency indicators).
        * Checks for valid `AgentConfig` and `questions`.
        * Determines next unanswered question from `agentConfig.questions` by analyzing `conversationHistory`.
        * If a question is pending, returns `question.questionText`.
        * If all questions answered:
            * Extracts answers from `conversationHistory` into `capturedData` JSON object.
            * Populates specific `Lead` model fields (`contactName`, `contactEmail`, `contactPhone`, `notes`) based on `mapsToLeadField` property of `LeadCaptureQuestion`s by looking up answers in `capturedData`.
            * **Emergency Detection:** Checks initial user message for keywords to set `isEmergency` flag.
            * Creates `Lead` record with `businessId`, `capturedData`, `conversationTranscript`, `status: 'NEW'`, `priority: (isEmergency ? 'URGENT' : 'NORMAL')`, and populated contact fields.
            * Triggers `sendLeadNotificationEmail` to HSP.
            * Triggers `sendLeadConfirmationToCustomer` to the captured customer email (if available).
            * Returns a concluding message (customized if emergency).
    * **Other/Fallback Flow:** Returns `AgentConfig.welcomeMessage` for new conversations or a general response using `getChatCompletion` with `AgentConfig.personaPrompt`.
    * Includes comprehensive `try...catch` for error handling, returning a polite error message to the chat.

### 4.3. Admin Backend APIs (`src/api/admin.ts`, `src/api/authMiddleware.ts`)
* All routes under `/api/admin` (except `/login`, `/logout`) are protected by `authMiddleware`.
* **Authentication (`authMiddleware.ts`):** Verifies JWT from HttpOnly `token` cookie, populates `req.user` (`userId`, `businessId`, `role`). Returns 401 JSON for API errors.
* **Login (`POST /api/admin/login`):** Validates credentials, generates JWT, sets HttpOnly cookie.
* **Logout (`GET /api/admin/logout`):** Clears `token` cookie, redirects to `/admin/login`.
* **User Info (`GET /api/admin/me`):** Returns `req.user` (JWT payload).
* **Agent Configuration (`POST /api/admin/config`, `GET /api/admin/config`):** Full CRUD for `AgentConfig` scoped to `req.user.businessId`.
* **Lead Capture Questions (`POST /api/admin/config/questions`, `GET /api/admin/config/questions`, `PUT /api/admin/config/questions/:questionId`, `DELETE /api/admin/config/questions/:questionId`):** Full CRUD for `LeadCaptureQuestion`s, linked to the business's `AgentConfig`.
* **Knowledge Base (`POST /api/admin/knowledgebase`, `GET /api/admin/knowledgebase`, `PUT /api/admin/knowledgebase/:kbId`, `DELETE /api/admin/knowledgebase/:kbId`):** Full CRUD for `KnowledgeBase` entries. `POST` and `PUT` (if content changes) trigger `generateAndStoreEmbedding`.
* **Leads (`GET /api/admin/leads`, `PUT /api/admin/leads/:leadId`):**
    * `GET`: Retrieves all `Lead` records for the `businessId`.
    * `PUT`: Updates `Lead` record (e.g., for `status`, `notes`).

### 4.4. Admin Dashboard (Frontend - EJS Views at `/admin/*`, served by `src/api/viewRoutes.ts`)
* View routes are protected using `authMiddleware` (currently sends JSON 401; ideal for views is redirect).
* **Login Page (`/admin/login` -> `login.ejs`):** Form with client-side JS `fetch` to `/api/admin/login`, redirects to `/admin/dashboard` on success.
* **Main Dashboard Page (`/admin/dashboard` -> `dashboard.ejs`):** Welcome message with Business Name, navigation links.
* **Manage Agent Settings Page (`/admin/settings` -> `agent-settings.ejs`):** Form pre-filled, client-side JS `fetch` to `POST /api/admin/config`.
* **Manage Lead Capture Questions Page (`/admin/lead-questions` -> `lead-questions.ejs`):** Displays list, form to add (including `mapsToLeadField`), client-side JS for Add, Edit, Delete via API calls.
* **Manage Knowledge Base Page (`/admin/knowledge-base` -> `knowledge-base.ejs`):** Displays list, form to add, client-side JS for Add, Edit, Delete via API calls.
* **View Captured Leads Page (`/admin/leads` -> `view-leads.ejs`):** Displays leads in a table with key fields populated. UI for status updates and notes editing.

### 4.5. Notifications (`notificationService.ts`)
* Uses `Nodemailer`, configured with Ethereal.email for development.
* `sendLeadNotificationEmail(toEmail, leadDetails, leadPriority, businessName)`: Sends detailed lead notification to the HSP's configured `Business.notificationEmail`.
* `sendLeadConfirmationToCustomer(customerEmail, businessName, leadDetails, isEmergency)`: Sends confirmation email to the customer after lead submission.

### 4.6. Database (PostgreSQL with `pgvector`)
* Schema defined in `prisma/schema.prisma`.
* Models: `Business` (with `notificationEmail`, `notificationPhoneNumber`), `User`, `AgentConfig` (with `colorTheme` JSON), `LeadCaptureQuestion` (with `mapsToLeadField`), `KnowledgeBase` (with `embedding vector(1536)`), `Lead` (with `priority`, `contactName`, `contactEmail`, `contactPhone`, `notes`, `capturedData` JSONB, `conversationTranscript` Text).
* `pgvector` extension enabled for `KnowledgeBase.embedding`.

## 5. Technical Overview

* **Containerized Application:** Docker & Docker Compose manage the Node.js application container and a PostgreSQL/pgvector database container, ensuring a consistent development and deployment environment.
* **Backend API:** Node.js/Express.js/TypeScript RESTful API. Handles business logic, AI orchestration, data persistence (Prisma), authentication (JWT), and serves Admin Dashboard views (EJS) and static assets.
* **AI Core:**
    * **OpenAI Service:** Wrapper for OpenAI API calls (embeddings, chat completions).
    * **RAG Service:** Manages knowledge base embedding generation and vector similarity search for context retrieval.
    * **AI Handler:** Orchestrates intent classification, RAG, and lead capture conversational flows.
* **Database:** PostgreSQL with `pgvector` extension.
* **Frontend Chat Widget:** Vanilla JavaScript, dynamically injected into SMB websites.
* **Admin Dashboard:** Server-Side Rendered EJS templates with client-side JavaScript for enhanced interactivity and API communication.
* **Deployment Target:** Render.com (PaaS).

## 6. Future Roadmap / V1.1+ Features

* **Advanced AI & Conversation:**
    * AI dynamically asks clarifying questions.
    * Deeper contextual awareness and memory.
* **Admin Dashboard Enhancements:**
    * More sophisticated Lead Management in "View Leads" (filtering, sorting, detailed view, advanced note-taking).
    * UI for re-ordering Lead Capture Questions.
    * Analytics dashboard for agent performance.
* **Multi-Channel & Integrations:**
    * Twilio integration for SMS and/or Voice Call notifications for emergency leads.
    * Social Media DM integration (Facebook, Instagram).
    * Direct CRM integrations (HubSpot, Salesforce, industry-specific).
* **Chat Widget Enhancements:**
    * Advanced UI customization (avatars, themes beyond color).
    * Proactive chat triggers.
    * Voice input/dictation within the widget.
* **Self-Serve SaaS Model:**
    * Public user/business sign-up.
    * Subscription tiers and billing integration (e.g., Stripe).
    * Automated, wizard-style onboarding for new SMBs.
* **Testing & Operations:**
    * Comprehensive automated testing suite (unit, integration, E2E).
    * Production-grade logging and monitoring.
    * Scalability and performance optimizations.

## 7. Success Metrics (MVP & Beyond)

* **SMB Adoption:**
    * Number of active SMB clients.
    * Ease of setup and configuration time by admins.
    * Admin dashboard engagement (logins, configurations made).
* **Agent Performance:**
    * Number of leads captured per agent.
    * Lead quality/conversion rate (requires feedback from SMBs).
    * Number of FAQs successfully handled (reduction in SMB support time).
    * Accuracy of intent classification.
* **End-User (Customer) Satisfaction:**
    * Successful task completion rate (lead submitted, question answered).
    * (Future) CSAT scores from chat interactions.
* **System Health:**
    * Service uptime (Render).
    * API response times.
    * Error rates. 