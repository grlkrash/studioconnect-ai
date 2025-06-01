# Developer Guide & System Architecture
## AI Agent Assistant for SMBs

**Version:** 1.0  
**Last Updated:** December 2024  
**Purpose:** Technical implementation guide and architectural reference for developers

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [System Architecture](#2-system-architecture)
3. [Project Structure](#3-project-structure)
4. [Core Components](#4-core-components)
5. [Database Schema](#5-database-schema)
6. [API Documentation](#6-api-documentation)
7. [Development Setup](#7-development-setup)
8. [Deployment Guide](#8-deployment-guide)
9. [Security Considerations](#9-security-considerations)
10. [Development Best Practices](#10-development-best-practices)
11. [Testing Strategy](#11-testing-strategy)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Project Overview

The AI Agent Assistant for SMBs is a multi-tenant SaaS application that provides intelligent chatbot capabilities for small and medium-sized businesses. The system consists of:

- **Backend API**: Node.js/Express/TypeScript REST API
- **Database**: PostgreSQL with pgvector extension for AI embeddings
- **AI Core**: OpenAI integration for chat completions and embeddings
- **Chat Widget**: Embeddable JavaScript widget for SMB websites
- **Admin Dashboard**: Server-side rendered web interface for SMB configuration
- **Notification System**: Email notifications for lead capture

### Key Technologies

- **Runtime**: Node.js 20.x
- **Language**: TypeScript 5.x
- **Framework**: Express.js 4.x
- **Database**: PostgreSQL 15+ with pgvector
- **ORM**: Prisma 5.x
- **AI**: OpenAI API (GPT-4, text-embedding-3-small)
- **Authentication**: JWT (jsonwebtoken)
- **View Engine**: EJS
- **Containerization**: Docker & Docker Compose
- **Email**: Nodemailer

---

## 2. System Architecture

### High-Level Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   SMB Website   │     │ Admin Dashboard │     │   Email Client  │
│   (widget.js)   │     │  (EJS Views)    │     │                 │
└────────┬────────┘     └────────┬────────┘     └────────▲────────┘
         │                       │                         │
         │ HTTPS                 │ HTTPS                   │ SMTP
         │                       │                         │
         ▼                       ▼                         │
┌────────────────────────────────────────────────────────┴────────┐
│                        Backend API (Express.js)                  │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐   │
│  │   Chat API  │  │  Admin API   │  │ Notification Service│   │
│  └──────┬──────┘  └──────┬───────┘  └──────────┬──────────┘   │
│         │                │                       │               │
│  ┌──────▼──────────────────────────────────────▼──────────┐   │
│  │                    Business Logic Layer                  │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  │   │
│  │  │  AI Handler │  │  RAG Service │  │ Lead Service  │  │   │
│  │  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘  │   │
│  └─────────┼────────────────┼──────────────────┼──────────┘   │
│            │                │                   │               │
│  ┌─────────▼────────────────▼───────────────────▼──────────┐   │
│  │                  Data Access Layer (Prisma)              │   │
│  └─────────────────────────┬────────────────────────────────┘   │
└────────────────────────────┼────────────────────────────────────┘
                             │
                    ┌────────▼────────┐     ┌─────────────┐
                    │   PostgreSQL    │────▶│   pgvector  │
                    │    Database     │     │  Extension  │
                    └─────────────────┘     └─────────────┘
                             │
                    ┌────────▼────────┐
                    │   OpenAI API    │
                    └─────────────────┘
```

### Component Interactions

1. **Chat Flow**: Widget → Chat API → AI Handler → OpenAI/RAG → Database → Response
2. **Admin Flow**: Dashboard → Admin API → Auth Middleware → Business Logic → Database
3. **Lead Capture**: AI Handler → Lead Service → Database → Notification Service → Email

---

## 3. Project Structure

```
leads-support-agent-smb/
├── docker-compose.yml          # Container orchestration
├── Dockerfile                  # Node.js app container definition
├── package.json               # Dependencies and scripts
├── tsconfig.json             # TypeScript configuration
├── .env.example              # Environment variables template
├── prisma/
│   ├── schema.prisma         # Database schema definition
│   └── migrations/           # Database migration history
├── src/
│   ├── index.ts             # Application entry point
│   ├── api/
│   │   ├── admin.ts         # Admin API routes
│   │   ├── chat.ts          # Chat API routes
│   │   ├── authMiddleware.ts # JWT authentication
│   │   └── viewRoutes.ts    # Admin dashboard views
│   ├── services/
│   │   ├── aiHandler.ts     # Core AI logic
│   │   ├── ragService.ts    # RAG implementation
│   │   ├── openai.ts        # OpenAI client wrapper
│   │   └── notificationService.ts # Email notifications
│   ├── utils/
│   │   └── logger.ts        # Logging utilities
│   └── types/
│       └── index.ts         # TypeScript type definitions
├── views/                   # EJS templates
│   ├── login.ejs
│   ├── dashboard.ejs
│   ├── agent-settings.ejs
│   ├── lead-questions.ejs
│   ├── knowledge-base.ejs
│   └── view-leads.ejs
├── public/
│   ├── widget.js           # Embeddable chat widget
│   └── css/
│       └── admin.css       # Admin dashboard styles
└── tests/                  # Test files (future)
```

---

## 4. Core Components

### 4.1 AI Handler (`aiHandler.ts`)

**Purpose**: Central AI orchestration for chat interactions

**Key Functions**:
```typescript
processMessage(message: string, conversationHistory: Message[], businessId: string): Promise<AIResponse>
```

**Responsibilities**:
- Intent classification (FAQ, LEAD_CAPTURE, EMERGENCY_LEAD_CAPTURE, OTHER)
- Conversation state management
- Lead capture flow orchestration
- Emergency detection
- Response generation

### 4.2 RAG Service (`ragService.ts`)

**Purpose**: Retrieval-Augmented Generation for FAQ answering

**Key Functions**:
```typescript
generateAndStoreEmbedding(knowledgeBaseId: string): Promise<void>
findRelevantKnowledge(userQuery: string, businessId: string, limit: number): Promise<KnowledgeResult[]>
```

**Responsibilities**:
- Embedding generation for knowledge base content
- Vector similarity search using pgvector
- Context retrieval for FAQ responses

### 4.3 OpenAI Service (`openai.ts`)

**Purpose**: Wrapper for OpenAI API interactions

**Key Functions**:
```typescript
getEmbedding(text: string, model?: string): Promise<number[]>
getChatCompletion(userPrompt: string, systemPrompt: string, model?: string): Promise<string>
```

### 4.4 Auth Middleware (`authMiddleware.ts`)

**Purpose**: JWT-based authentication for admin routes

**Implementation**:
- Validates JWT from HttpOnly cookie
- Populates `req.user` with decoded token data
- Returns 401 for invalid/missing tokens

### 4.5 Chat Widget (`widget.js`)

**Purpose**: Embeddable client-side chat interface

**Features**:
- Minimal dependencies (vanilla JavaScript)
- Configurable via `data-business-id` attribute
- Maintains conversation history client-side
- Responsive design with fixed positioning

---

## 5. Database Schema

### Entity Relationship Diagram

```
Business (1) ─────┬──── (n) User
    │             │
    │ (1)         │
    ├─────────────┴──── (1) AgentConfig
    │                         │
    │                         │ (1)
    │                         └──── (n) LeadCaptureQuestion
    │ (1)
    ├──────────────────── (n) Lead
    │
    │ (1)
    └──────────────────── (n) KnowledgeBase
```

### Key Models

#### Business
```prisma
model Business {
  id                String   @id @default(cuid())
  name              String
  notificationEmail String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  
  users         User[]
  agentConfig   AgentConfig?
  leads         Lead[]
  knowledgeBase KnowledgeBase[]
}
```

#### AgentConfig
```prisma
model AgentConfig {
  id            String   @id @default(cuid())
  businessId    String   @unique
  agentName     String?
  personaPrompt String?  @db.Text
  welcomeMessage String?  @db.Text
  colorTheme    Json?
  
  business  Business @relation(...)
  questions LeadCaptureQuestion[]
}
```

#### Lead
```prisma
model Lead {
  id            String   @id @default(cuid())
  businessId    String
  capturedData  Json
  status        String   @default("NEW")
  priority      String   @default("NORMAL")
  contactName   String?
  contactEmail  String?
  contactPhone  String?
  notes         String?  @db.Text
  createdAt     DateTime @default(now())
  
  business Business @relation(...)
}
```

#### KnowledgeBase
```prisma
model KnowledgeBase {
  id         String   @id @default(cuid())
  businessId String
  content    String   @db.Text
  sourceURL  String?
  embedding  Unsupported("vector(1536)")?
  createdAt  DateTime @default(now())
  
  business Business @relation(...)
}
```

---

## 6. API Documentation

### Public Endpoints

#### POST /api/chat
**Purpose**: Process chat messages from widget

**Request**:
```json
{
  "message": "string",
  "businessId": "string",
  "conversationHistory": [
    {
      "role": "user" | "assistant",
      "content": "string"
    }
  ]
}
```

**Response**:
```json
{
  "reply": "string",
  "intent": "FAQ" | "LEAD_CAPTURE" | "OTHER"
}
```

### Admin Endpoints (Protected)

#### POST /api/admin/login
**Purpose**: Authenticate admin user

**Request**:
```json
{
  "email": "string",
  "password": "string"
}
```

**Response**: Sets HttpOnly JWT cookie
```json
{
  "id": "string",
  "email": "string",
  "businessId": "string"
}
```

#### GET /api/admin/config
**Purpose**: Retrieve agent configuration

**Response**:
```json
{
  "id": "string",
  "agentName": "string",
  "personaPrompt": "string",
  "welcomeMessage": "string",
  "colorTheme": {}
}
```

#### POST /api/admin/config
**Purpose**: Update agent configuration

**Request**: Same as GET response format

#### GET /api/admin/config/questions
**Purpose**: Retrieve lead capture questions

**Response**:
```json
[
  {
    "id": "string",
    "questionText": "string",
    "expectedFormat": "TEXT" | "EMAIL" | "PHONE",
    "order": "number",
    "mapsToLeadField": "string"
  }
]
```

#### POST /api/admin/config/questions
**Purpose**: Add new lead capture question

**Request**: Single question object

#### GET /api/admin/knowledgebase
**Purpose**: Retrieve knowledge base entries

**Response**:
```json
[
  {
    "id": "string",
    "content": "string",
    "sourceURL": "string",
    "createdAt": "datetime"
  }
]
```

#### POST /api/admin/knowledgebase
**Purpose**: Add knowledge base entry

**Request**:
```json
{
  "content": "string",
  "sourceURL": "string"
}
```

#### GET /api/admin/leads
**Purpose**: Retrieve captured leads

**Response**:
```json
[
  {
    "id": "string",
    "capturedData": {},
    "status": "string",
    "priority": "string",
    "contactName": "string",
    "contactEmail": "string",
    "contactPhone": "string",
    "notes": "string",
    "createdAt": "datetime"
  }
]
```

---

## 7. Development Setup

### Prerequisites
- Node.js 20.x
- Docker & Docker Compose
- PostgreSQL client (optional, for direct DB access)

### Local Development

1. **Clone repository**:
```bash
git clone [repository-url]
cd leads-support-agent-smb
```

2. **Environment setup**:
```bash
cp .env.example .env
# Edit .env with your configurations:
# - OPENAI_API_KEY
# - JWT_SECRET
# - SMTP settings
```

3. **Start services**:
```bash
docker-compose up -d
```

4. **Database setup**:
```bash
# Run migrations
docker-compose exec app npx prisma migrate dev

# Seed test data (if available)
docker-compose exec app npm run seed
```

5. **Access points**:
- API: http://localhost:3000
- Admin Dashboard: http://localhost:3000/admin/login
- Database: localhost:5432

### Development Commands

```bash
# Start in development mode
npm run dev

# Run database migrations
npx prisma migrate dev

# Generate Prisma client
npx prisma generate

# Open Prisma Studio
npx prisma studio

# Type checking
npm run type-check

# Linting
npm run lint

# Build for production
npm run build
```

---

## 8. Deployment Guide

### Production Requirements

- Node.js 20.x runtime
- PostgreSQL 15+ with pgvector extension
- Environment variables properly configured
- SSL/TLS certificates for HTTPS
- SMTP server for email notifications

### Deployment Steps (Render.com Example)

1. **Database Setup**:
   - Create PostgreSQL instance with pgvector
   - Run production migrations
   - Configure connection pooling

2. **Application Deployment**:
   - Set environment variables
   - Configure build command: `npm run build`
   - Set start command: `npm start`
   - Configure health check endpoint

3. **Post-Deployment**:
   - Verify database connectivity
   - Test chat widget embedding
   - Confirm email notifications
   - Set up monitoring/logging

### Environment Variables

```bash
# Required for production
NODE_ENV=production
DATABASE_URL=postgresql://...
OPENAI_API_KEY=sk-...
JWT_SECRET=[strong-random-string]
PORT=3000

# Email configuration
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=notifications@example.com
SMTP_PASS=[password]

# Optional
LOG_LEVEL=info
CORS_ORIGIN=https://example.com
```

---

## 9. Security Considerations

### Authentication & Authorization
- JWT tokens stored in HttpOnly cookies
- Passwords hashed with bcrypt (10 rounds)
- Business-scoped data access (multi-tenancy)
- Session expiration handling

### Data Protection
- Input validation on all API endpoints
- SQL injection prevention via Prisma ORM
- XSS protection in chat widget
- CORS configuration for API access
- Rate limiting (to be implemented)

### API Security
- HTTPS enforcement in production
- API key rotation for OpenAI
- Environment variable security
- Secure webhook endpoints (future)

### Best Practices
- Regular dependency updates
- Security headers (helmet.js recommended)
- Input sanitization for user content
- Audit logging for sensitive operations

---

## 10. Development Best Practices

### Code Style
- TypeScript strict mode enabled
- ESLint configuration for consistency
- Prettier for code formatting
- Meaningful variable/function names
- Comprehensive type definitions

### Git Workflow
```bash
# Feature branch workflow
git checkout -b feature/your-feature
# Make changes
git commit -m "feat: add new feature"
git push origin feature/your-feature
# Create pull request
```

### Commit Convention
- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation changes
- `refactor:` Code refactoring
- `test:` Test additions/changes
- `chore:` Maintenance tasks

### Error Handling
```typescript
// Consistent error structure
try {
  // Operation
} catch (error) {
  logger.error('Operation failed', {
    error: error.message,
    context: { businessId, userId }
  });
  throw new AppError('User-friendly message', 500);
}
```

### Logging
```typescript
// Structured logging
logger.info('Lead captured', {
  businessId,
  leadId,
  priority,
  timestamp: new Date()
});
```

---

## 11. Testing Strategy

### Unit Tests (Planned)
- AI intent classification
- RAG similarity search
- Lead capture flow logic
- Authentication middleware

### Integration Tests (Planned)
- API endpoint testing
- Database operations
- OpenAI API mocking
- Email notification flow

### E2E Tests (Planned)
- Complete chat conversation flows
- Admin dashboard workflows
- Widget embedding and initialization

### Test Structure
```
tests/
├── unit/
│   ├── services/
│   │   ├── aiHandler.test.ts
│   │   └── ragService.test.ts
│   └── utils/
├── integration/
│   ├── api/
│   └── database/
└── e2e/
    ├── chat-flow.test.ts
    └── admin-flow.test.ts
```

---

## 12. Troubleshooting

### Common Issues

#### Widget Not Loading
1. Verify `businessId` in script tag
2. Check CORS settings
3. Confirm API endpoint accessibility
4. Review browser console errors

#### AI Responses Failing
1. Check OpenAI API key validity
2. Verify rate limits not exceeded
3. Review conversation history format
4. Check knowledge base embeddings

#### Database Connection Issues
1. Verify DATABASE_URL format
2. Check pgvector extension installation
3. Confirm migration status
4. Review connection pool settings

#### Email Notifications Not Sending
1. Verify SMTP credentials
2. Check email service limits
3. Review notification email addresses
4. Confirm email template rendering

### Debug Mode
```bash
# Enable verbose logging
LOG_LEVEL=debug npm run dev

# Database query logging
DEBUG=prisma:query npm run dev
```

### Performance Monitoring
- Response time tracking
- Database query optimization
- Embedding generation timing
- Memory usage monitoring

---

## Appendix A: Quick Reference

### Key Files
- Entry point: `src/index.ts`
- AI logic: `src/services/aiHandler.ts`
- Database schema: `prisma/schema.prisma`
- Widget: `public/widget.js`

### Key Commands
```bash
docker-compose up -d          # Start all services
docker-compose logs -f app    # View app logs
docker-compose exec app bash  # Shell into app container
npx prisma studio            # Visual database editor
```

### Key Endpoints
- Chat: `POST /api/chat`
- Admin: `/api/admin/*`
- Views: `/admin/*`

---

*This document is a living guide and should be updated as the system evolves.* 