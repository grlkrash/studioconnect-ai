# Technical Product Requirements Document (PRD) - AI Agent for SMBs

**Version:** 2.0 (Technical Focus)  
**Date:** May 30, 2025

---

## 1. Introduction & Vision

### 1.1 Product
An AI-powered chat agent for SMB websites designed for 24/7 lead capture and automated customer Q&A.

### 1.2 Vision
Empower SMBs with an affordable, effective AI assistant that integrates seamlessly into their workflow, drives revenue by capturing every lead, and reduces staff workload by automating routine inquiries.

### 1.3 Core Architecture
A modular, multi-tenant Node.js application leveraging a central OpenAI-based logic core. Each SMB client will have a unique configuration that dictates the agent's behavior, knowledge, and personality.

---

## 2. System & Feature Requirements (MVP)

### 2.1 Core Platform

- **Authentication:** JWT-based authentication for the SMB Admin Dashboard
- **Database:** PostgreSQL with Prisma ORM for type-safe database access
- **API:** RESTful API built with Express.js for all client-side interactions (chat widget, admin dashboard)
- **Multi-tenancy:** Database schema supports multi-tenancy with a `tenantId` (or `businessId`) associated with every relevant record (leads, conversations, configurations)

### 2.2 Data Models (Simplified)

#### Business
```typescript
interface Business {
  id: string
  name: string
  businessType: 'REAL_ESTATE' | 'LAW' | 'HVAC' | 'PLUMBING' | 'OTHER'
  createdAt: Date
}
```

#### User
```typescript
interface User {
  id: string
  businessId: string // FK to Business
  email: string
  passwordHash: string
  role: 'ADMIN' | 'USER'
}
```

#### AgentConfig
```typescript
interface AgentConfig {
  id: string
  businessId: string // FK to Business
  agentName: string
  personaPrompt: string // text
  welcomeMessage: string
  colorTheme: JSON
}
```

#### LeadCaptureQuestion
```typescript
interface LeadCaptureQuestion {
  id: string
  configId: string // FK to AgentConfig
  questionText: string
  expectedFormat: 'TEXT' | 'EMAIL' | 'PHONE'
  order: number
}
```

#### KnowledgeBase
```typescript
interface KnowledgeBase {
  id: string
  businessId: string // FK to Business
  content: string // text
  sourceURL?: string
  embedding: number[] // vector
}
```

#### Lead
```typescript
interface Lead {
  id: string
  businessId: string // FK to Business
  capturedData: JSON // JSONB
  conversationTranscript: string // text
  status: 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'CLOSED'
  createdAt: Date
}
```

### 2.3 AI Logic: Conversational Flow

The agent operates in one of two primary modes, determined by analyzing user intent with an initial OpenAI call.

#### 1. Lead Capture Mode

**Trigger:** User intent suggests they are a potential new customer (e.g., "how much for a new AC," "I need a consultation")

**Process:**
1. The agent follows the sequence of questions defined in the `LeadCaptureQuestion` model for that business
2. It validates user input against the `expectedFormat`
3. Once all questions are answered, it packages the data into a `Lead` object, saves it to the database, and sends a notification
4. It concludes the conversation with a polite sign-off (e.g., "Thanks! Someone from our team will be in touch shortly.")

#### 2. FAQ/Knowledge Mode

**Trigger:** User intent suggests a question for information (e.g., "what are your hours," "do you service my area")

**Process (Retrieval-Augmented Generation - RAG):**
1. Take the user's query and generate an embedding vector using an OpenAI embedding model (e.g., `text-embedding-3-small`)
2. Perform a vector similarity search against the `KnowledgeBase` embeddings for that `businessId`
3. Retrieve the top 2-3 most relevant text chunks from the `KnowledgeBase.content`
4. Construct a new prompt for the chat model (e.g., `gpt-4o`) containing the original user question and the retrieved text chunks as context
5. The prompt will instruct the model: "Answer the user's question only using the provided context. If the answer is not in the context, say you don't have that information."
6. Return the model's generated answer to the user

### 2.4 Frontend Chat Widget

#### Technical Implementation
- **Technology:** Vanilla JavaScript, HTML, CSS (no frontend frameworks for maximum compatibility and lightweight embedding)
- **Embedding:** Deployed via a single `<script>` tag that the SMB owner places on their website
- **Dynamic Injection:** The script will dynamically inject the chatbot's HTML and CSS into the host page
- **Business Identification:** `businessId` passed as a data attribute in the script tag

**Example Implementation:**
```html
<script src="https://your-domain.com/widget.js" data-business-id="XYZ"></script>
```

#### Features
- Toggle chat window visibility on button click
- Real-time message handling
- Communication with backend `/api/chat` endpoint
- Responsive design for mobile and desktop

### 2.5 Admin Dashboard (Basic)

#### Technical Implementation
- **Technology:** Server-side rendered templates (EJS with Express) for MVP simplicity
- **Authentication:** Secure JWT-based login system

#### Core Features

##### Lead Viewer
- Table displaying all captured leads from the `Lead` model
- Ability to view full conversation transcripts
- Lead status management
- Export capabilities for lead data

##### Agent Configuration
- Form-based editor for `AgentConfig` fields
- Management of `LeadCaptureQuestion` sequences
- Real-time preview of agent behavior
- Color theme customization

##### Knowledge Base Management
- Simple textarea interface for adding/editing content
- Automatic text processing pipeline:
  1. Content chunking
  2. Embedding generation
  3. Vector storage in `KnowledgeBase`
- Content source tracking and management

---

## 3. Technical Architecture

### 3.1 API Endpoints

#### Chat API
```
POST /api/chat
Body: {
  message: string,
  conversationHistory: Message[],
  businessId: string
}
Response: {
  response: string,
  mode: 'LEAD_CAPTURE' | 'FAQ',
  requiresFollowUp: boolean
}
```

#### Admin API
```
GET /api/admin/leads
POST /api/admin/config
PUT /api/admin/knowledge-base
GET /api/admin/analytics
```

### 3.2 Deployment Requirements

- **Environment:** Node.js 18+
- **Database:** PostgreSQL 14+
- **External Services:** OpenAI API integration
- **Hosting:** Docker-ready for cloud deployment
- **Scalability:** Horizontal scaling support through stateless design

### 3.3 Security Considerations

- JWT token management and refresh
- Input sanitization for all user inputs
- Rate limiting on chat endpoints
- CORS configuration for widget embedding
- Environment variable management for API keys

---

## 4. Success Metrics

### 4.1 Technical KPIs
- Response time < 2 seconds for chat interactions
- 99.9% uptime for chat widget
- Embedding accuracy for knowledge retrieval

### 4.2 Business KPIs
- Lead capture rate improvement
- Customer satisfaction scores
- Reduction in support ticket volume
- SMB onboarding time reduction

---

## 5. Implementation Phases

### Phase 1: Core Backend (Weeks 1-2)
- Database setup and models
- Basic API endpoints
- OpenAI integration
- Authentication system

### Phase 2: AI Logic & RAG (Weeks 3-4)
- Intent classification
- Lead capture flow
- Knowledge base RAG implementation
- Vector similarity search

### Phase 3: Frontend Widget (Weeks 5-6)
- Vanilla JS chat widget
- Embedding mechanism
- Responsive design
- Cross-browser compatibility

### Phase 4: Admin Dashboard (Weeks 7-8)
- EJS template implementation
- Lead management interface
- Configuration tools
- Knowledge base management

### Phase 5: Testing & Deployment (Weeks 9-10)
- End-to-end testing
- Performance optimization
- Production deployment
- Documentation and training materials 