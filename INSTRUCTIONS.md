# AI Agent for SMB - Implementation Instructions

## Phase 0: Project Setup

### 1. Initialize Node.js Project

```bash
mkdir leads-support-agent-smb
cd leads-support-agent-smb
npm init -y
npm install express dotenv openai pg prisma
npm install -D nodemon typescript ts-node @types/express @types/node
npx tsc --init
```

### 2. Configure package.json scripts

```json
"scripts": {
  "dev": "nodemon src/server.ts",
  "build": "tsc",
  "start": "node dist/server.js"
}
```

### 3. Set up Prisma

- Initialize Prisma: `npx prisma init --datasource-provider postgresql`
- Define your data models (from PRD section 2.2) in `prisma/schema.prisma`
- Run `npx prisma migrate dev --name init` to create the database tables

### 4. Create Project Structure

```
/src
├── api/             # Express routes
├── core/            # Core business logic (AI, RAG)
├── services/        # External services (OpenAI, DB)
├── utils/           # Helper functions
├── public/          # For widget.js
├── views/           # EJS templates for admin dashboard
└── server.ts        # Main server entry point
```

### 5. Environment Variables (.env)

```env
DATABASE_URL="postgresql://user:password@host:port/dbname"
OPENAI_API_KEY="sk-..."
JWT_SECRET="your-super-secret-key"
```

## Phase 1: Core Backend API

### 1. Setup Express Server (`src/server.ts`)

- Import express
- Configure middleware (CORS, JSON body parser)
- Define a basic health check route (`/health`)
- Mount your API routes
- Start the server

### 2. Create Chat Endpoint (`src/api/chat.ts`)

- Define a POST `/api/chat` route
- **Request Body:** `{ message: string, conversationHistory: [], businessId: string }`
- **Logic:**
  1. Extract data from the request body
  2. Instantiate your core AI logic handler (`src/core/aiHandler.ts`)
  3. Call a method like `aiHandler.processMessage(message, history, businessId)`
  4. This method will perform the intent analysis (Lead Capture vs. FAQ) and return the AI's response
  5. Send the response back to the client

### 3. Create Admin Routes (`src/api/admin.ts`)

- Define routes for login, lead viewing, and configuration, protected by JWT middleware
- Example: `GET /api/admin/leads` will query the database for all leads associated with the logged-in user's businessId

## Phase 2: AI Logic & RAG Implementation

### 1. OpenAI Service (`src/services/openai.ts`)

- Create a reusable client for interacting with the OpenAI API
- Export functions like `getChatCompletion(...)` and `getEmbedding(...)`

### 2. RAG Service (`src/core/ragService.ts`)

#### `addDocumentToKnowledgeBase(text, businessId)`:
1. Chunk the input text into smaller, overlapping segments
2. For each chunk, call `openai.getEmbedding(chunk)`
3. Store the chunk text and its corresponding embedding vector in the KnowledgeBase table
   > **Note:** For a true vector database, you'd use a service like Pinecone, but for an MVP, you can perform a cosine similarity search directly in your database if using an extension like pgvector.

#### `queryKnowledgeBase(query, businessId)`:
1. Get the embedding for the user's query
2. Perform a vector similarity search to find the top k matching chunks from the KnowledgeBase
3. Return the text of these chunks

### 3. Main AI Handler (`src/core/aiHandler.ts`)

#### `processMessage(...)`:
1. **Intent Analysis:** Make a preliminary call to OpenAI. Prompt: "Does the following user message seem like a question for information or a request for service? Respond with 'FAQ' or 'LEAD_CAPTURE'."
2. **If 'LEAD_CAPTURE':** Initiate the lead capture conversational flow
3. **If 'FAQ':**
   - Call `ragService.queryKnowledgeBase(...)` to get relevant context
   - Call `openai.getChatCompletion(...)` with the user's message and the retrieved context
   - Return the final answer

## Phase 3: Frontend Chat Widget

### 1. Create `src/public/widget.js`

- This script will be self-contained
- On load, it reads its own script tag to get the `data-business-id`
- It injects HTML for the chat button and the chat window into the `<body>` of the host page
- It adds CSS dynamically for styling (to avoid requiring the SMB to link a CSS file)

#### Event Handling:
- On chat button click, toggle the chat window's visibility
- On message send, capture the input text
- Make a fetch call to your `POST /api/chat` endpoint with the message, history, and business ID
- Append the user's message and the AI's response to the chat window

## Phase 4: Admin Dashboard

### 1. Setup EJS (`src/server.ts`)

```javascript
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
```

### 2. Create View Routes (`src/api/viewRoutes.ts`)

- Define routes like `/dashboard` that render EJS templates
- **Example GET `/dashboard` route:**
  1. Verify JWT
  2. Fetch leads and agent config from the database
  3. `res.render('dashboard', { leads: dbLeads, config: dbConfig })`

### 3. Create EJS Templates (`src/views/`)

- `login.ejs`, `dashboard.ejs`, `config.ejs`
- Use simple HTML forms. Form submissions will post to your admin API endpoints
- On success, redirect back to the relevant dashboard page

## Phase 5: Deployment

### 1. Dockerize the Application

- Create a Dockerfile to build your Node.js app into a container image
- It should install dependencies, build the TypeScript, and define the start command

### 2. Choose a Hosting Provider

#### Render
Good for simplicity. You can deploy a web service from your Docker image and a PostgreSQL database directly on their platform.

#### AWS/GCP/Azure
More powerful but more complex. Use a service like Elastic Beanstalk, App Engine, or container orchestration services (ECS, Kubernetes).

### 3. Deployment Steps

1. Push your code to a Git repository (GitHub, GitLab)
2. Connect your hosting provider to the repository
3. Configure environment variables in the hosting provider's dashboard
4. Set up a production database and update the `DATABASE_URL`
5. Trigger a deployment
6. Configure your domain name to point to the deployed application's URL 