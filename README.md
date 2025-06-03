# Leads Support AI Agent for SMBs

## 🚀 Overview

The Leads Support AI Agent is a sophisticated, multi-tenant chatbot application designed to empower Small to Medium-Sized Businesses (SMBs). It automates customer interactions, captures leads effectively 24/7, and provides instant answers to frequently asked questions using a business-specific knowledge base. By leveraging Natural Language Processing (NLP) and Retrieval-Augmented Generation (RAG) via the OpenAI API, the agent delivers intelligent, contextual, and personalized experiences for end-users, while providing SMB owners with a dashboard to configure their agent and manage captured leads.

This project uses a Dockerized environment for consistent development and is designed for deployment on platforms like Render.

## ✨ MVP Features

* **AI-Powered Chat Widget:** A lightweight JavaScript widget embeddable on any SMB website.
* **Intelligent Conversation Flows:**
    * **Intent Classification:** Accurately determines user intent (FAQ, Lead Capture, Emergency Lead Capture).
    * **RAG-based FAQ Answering:** Retrieves information from a custom knowledge base using vector embeddings (`pgvector` in PostgreSQL) and OpenAI models to provide relevant answers.
    * **Configurable Lead Capture:** Guides users through a sequence of questions defined by the SMB to capture detailed lead information.
    * **Emergency Lead Prioritization:** Identifies urgent leads and flags them.
* **Automated Notifications:**
    * Sends email notifications to the SMB for new leads (highlighting urgency).
    * Sends confirmation emails to customers after lead submission.
* **Multi-Tenant Backend (Node.js, Express.js, TypeScript):**
    * Secure RESTful APIs.
    * PostgreSQL database for data persistence.
    * Prisma ORM for database interactions.
* **Admin Dashboard (EJS & Express):**
    * Secure JWT-based authentication (HttpOnly cookies).
    * **Agent Configuration:** Manage agent name, AI persona, welcome message, and chat widget color theme.
    * **Lead Capture Question Management:** Full CRUD (Create, Read, Update, Delete) for questions, including mapping to specific lead data fields (`contactName`, `contactEmail`, etc.).
    * **Knowledge Base Management:** Full CRUD for knowledge base articles, with automatic OpenAI embedding generation on create/update.
    * **View & Manage Captured Leads:** Display leads with details, update lead status, and add internal notes.
* **Dockerized Development & Deployment:** Ensures a consistent and reliable environment.

## 🛠️ Technology Stack

* **Backend:** Node.js, Express.js, TypeScript
* **Database:** PostgreSQL with `pgvector` extension
* **ORM:** Prisma
* **AI & NLP:** OpenAI API (GPT models for chat/intent, `text-embedding-3-small` for RAG)
* **Authentication:** JWT (JSON Web Tokens) with `bcrypt` for password hashing, `cookie-parser`
* **Email Notifications:** Nodemailer (Ethereal.email for development)
* **Frontend Chat Widget:** Vanilla JavaScript, HTML, CSS (dynamically injected)
* **Admin Dashboard UI:** EJS (Embedded JavaScript templates) rendered by Express.js, with client-side JavaScript for form submissions.
* **Development Server:** `nodemon`, `ts-node`
* **Package Manager:** Yarn (recommended)
* **Containerization:** Docker, Docker Compose

## 📋 Prerequisites

Ensure the following are installed on your local development machine:
* [Git](https://git-scm.com/)
* [Node.js](https://nodejs.org/) (Latest LTS version recommended, ideally managed via [NVM](https://github.com/nvm-sh/nvm))
* [Yarn Package Manager (v1.x)](https://classic.yarnpkg.com/en/docs/install)
* [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Ensure it is running)

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
# Uses port 5433 (host) mapped to 5432 (container).
DATABASE_URL="postgresql://db_user:db_password@localhost:5433/app_db?schema=public"
DIRECT_URL="postgresql://db_user:db_password@localhost:5433/app_db?schema=public"

# Secrets (Generate strong random strings for these)
JWT_SECRET="YOUR_VERY_STRONG_RANDOM_JWT_SECRET_HERE"

# OpenAI API Key
OPENAI_API_KEY="sk-YOUR_OPENAI_API_KEY_HERE"

# Node Environment for local Docker development
NODE_ENV=development

# Frontend URLs for CORS - used by the app INSIDE Docker
# APP_PRIMARY_URL will be http://localhost:3000 when accessing app in Docker via host browser
# WIDGET_TEST_URL is for live-server testing of test.html
APP_PRIMARY_URL=http://localhost:3000 
ADMIN_CUSTOM_DOMAIN_URL=https://app.cincyaisolutions.com # For future custom domain
WIDGET_DEMO_URL=https://demo.cincyaisolutions.com     # For future custom domain
WIDGET_TEST_URL=http://127.0.0.1:8080                # For local live-server testing
```

**Important:** The DATABASE_URL and DIRECT_URL above are for running `npx prisma studio` or other Prisma commands from your Mac terminal to interact with the database inside the Docker container. The application inside its own Docker container will use a different DATABASE_URL (postgresql://db_user:db_password@db:5432/app_db) which is set in docker-compose.yml.

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
* AI Agent Backend API & Admin UI: http://localhost:3000
* Admin Login Page: http://localhost:3000/admin/login
* Health Check Endpoint: http://localhost:3000/health
* Chat Widget Script: http://localhost:3000/widget.js (or /static/widget.js if you prefer that path)

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
* **Comprehensive automated testing.** 