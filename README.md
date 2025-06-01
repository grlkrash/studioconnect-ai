# Leads Support AI Agent for SMBs

## 🚀 Overview

The Leads Support AI Agent is a sophisticated chatbot application designed to empower Small to Medium-Sized Businesses (SMBs) by automating customer interactions, capturing leads effectively, and providing 24/7 FAQ support. It leverages advanced AI capabilities, including Natural Language Processing (NLP) and Retrieval-Augmented Generation (RAG), to deliver intelligent and contextual responses.

This project provides a multi-tenant backend API, an AI core logic handler, an embeddable chat widget for client websites, and an admin dashboard for SMBs to configure their agent and manage leads.

## ✨ MVP Features

* **AI-Powered Chat Widget:** A JavaScript-based widget easily embeddable on any SMB website.
* **Dual AI Modes:**
    * **FAQ Answering:** Utilizes a Retrieval-Augmented Generation (RAG) system with a configurable knowledge base to answer customer questions accurately based on business-specific information. Embeddings are generated for knowledge base entries and stored in a PostgreSQL database with the `pgvector` extension for similarity searches.
    * **Lead Capture Flow:** Guides potential customers through a series of configurable questions (e.g., name, email, phone, service needs) to capture lead details.
* **Intent Classification:** AI determines user intent to seamlessly switch between FAQ and Lead Capture modes.
* **Emergency Lead Prioritization:** Identifies urgent leads based on user input and can flag them accordingly (e.g., setting a priority in the database).
* **Email Notifications:** Automatically sends email notifications to the SMB owner/designated email when a new lead (especially an urgent one) is captured.
* **Admin Dashboard (for SMBs):** A web interface for SMB clients to:
    * Securely log in.
    * Manage general agent settings: Agent Name, Persona Prompt (system message for AI), Welcome Message, Chat Widget Color Theme.
    * Manage Lead Capture Questions: Add and view the sequence of questions the AI will ask. (Edit/Delete are V1.1 features). Includes mapping questions to specific lead fields like `contactName`, `contactEmail`.
    * Manage Knowledge Base: Add and view text-based entries that the AI uses for FAQ answers. Embeddings are automatically generated and stored for these entries. (Edit/Delete are V1.1 features).
    * View Captured Leads: Display a list of all leads captured by their agent, including captured data and contact information.
* **Multi-Tenant Architecture:** Designed to support multiple SMB clients from a single deployed application, with data isolation per business.
* **Dockerized Development Environment:** Ensures a consistent and reliable development setup.

## 🛠️ Technology Stack

* **Backend:** Node.js, Express.js, TypeScript
* **AI & NLP:** OpenAI API (GPT models for chat completion & intent classification, `text-embedding-3-small` for RAG embeddings)
* **Database:** PostgreSQL (with `pgvector` extension for vector similarity search)
* **ORM:** Prisma
* **Real-time Development Server:** `nodemon` with `ts-node`
* **Frontend Chat Widget:** Vanilla JavaScript, HTML, CSS (dynamically injected)
* **Admin Dashboard UI:** EJS (Embedded JavaScript templates) rendered by Express.js, with client-side JavaScript for form submissions.
* **Email Notifications:** Nodemailer (configured with Ethereal.email for development)
* **Authentication:** JWT (JSON Web Tokens) stored in HttpOnly cookies.
* **Password Hashing:** `bcrypt`
* **Development & Deployment Environment:** Docker, Docker Compose
* **Package Manager:** Yarn (recommended due to stability in this project's development)

## 📋 Prerequisites

Before you begin, ensure you have the following installed on your system:
* [Node.js](https://nodejs.org/) (latest LTS version recommended, ideally managed via [NVM](https://github.com/nvm-sh/nvm))
* [Yarn Package Manager](https://classic.yarnpkg.com/en/docs/install) (v1.x)
* [Docker Desktop](https://www.docker.com/products/docker-desktop/) (ensure it's running)
* [Git](https://git-scm.com/)

## ⚙️ Project Setup & Running (Docker First - Recommended)

This project is configured to run in a Dockerized environment for stability and consistency.

### 1. Clone the Repository (If applicable)
```bash
git clone <your-repository-url>
cd leads-support-agent-smb
``` 

### 2. Create and Configure the `.env` File
This file stores your environment-specific variables and secrets.

In the root of the project, create a file named `.env`.

Copy the content from `.env.example` (if provided) or add the following variables, replacing placeholder values with your actual credentials:

```bash
# Application Port
PORT=3000

# Database URL for Prisma (when running Prisma commands locally like `prisma studio`)
# This points to the PostgreSQL database EXPOSED BY DOCKER on your host machine.
DATABASE_URL="postgresql://db_user:db_password@localhost:5433/app_db?schema=public"
DIRECT_URL="postgresql://db_user:db_password@localhost:5433/app_db?schema=public"

# Secrets (Generate strong random strings for these)
JWT_SECRET="YOUR_VERY_STRONG_RANDOM_JWT_SECRET_HERE"

# OpenAI API Key
OPENAI_API_KEY="sk-YOUR_OPENAI_API_KEY_HERE"

# Node Environment
NODE_ENV=development

# Frontend URL (for CORS in production, can be localhost for dev if widget served separately)
# For development with test.html via live-server, this might be http://127.0.0.1:8080
# For development with test.html via file:/// and the admin dashboard on localhost:3000,
# the CORS config in server.ts handles 'null' and 'http://localhost:3000' in dev.
FRONTEND_URL=
```

### 3. Build and Start Docker Containers
Make sure Docker Desktop is running. In your project root:

**Build the application image:**

```bash
docker-compose build
```
(Or `docker compose build` for newer Docker CLI versions)

This might take a few minutes the first time.

**Start the application and database containers:**

```bash
docker-compose up
```
(Or `docker compose up`)

You will see logs from both the `app` and `db` containers.

### 4. Run Database Migrations (First Time Setup)
Once `docker-compose up` shows the database (`db` service) is healthy and the app (`app` service) is trying to start:

1. Open a new, separate terminal window.
2. Navigate to your project root.
3. Execute the Prisma migrate command inside the running app container:

```bash
docker-compose exec app npx prisma migrate dev --name initial_setup
```
(Or `docker compose exec app ...`)

This will create all necessary tables in your Dockerized PostgreSQL database.

### 5. Accessing the Application
* **AI Agent Backend API & Admin UI:** http://localhost:3000
* **Admin Login Page:** http://localhost:3000/admin/login
* **Health Check Endpoint:** http://localhost:3000/health
* **Chat Widget Script (served by the app):** http://localhost:3000/static/widget.js

**Testing the Chat Widget:**

1. Create a simple `test.html` file in your project root (or anywhere):

```html
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Widget Test</title></head>
<body>
    <h1>My Test Site</h1>
    <script src="http://localhost:3000/static/widget.js" data-business-id="YOUR_TEST_BUSINESS_ID" defer></script>
</body>
</html>
```

Replace `YOUR_TEST_BUSINESS_ID` with a valid Business ID from your database.

2. Serve this `test.html` file using a local HTTP server (to avoid `file:///` CORS issues):
   - Ensure `live-server` is installed: `npm install -g live-server` (or `yarn global add live-server`).
   - In the terminal, `cd` to the directory containing `test.html`.
   - Run `live-server`. It will open the page, usually at `http://127.0.0.1:8080`.
   - Your backend's CORS configuration in `src/server.ts` needs to allow `http://127.0.0.1:8080` (or the port `live-server` uses) when `NODE_ENV=development`.

### 6. Accessing the Dockerized Database with Prisma Studio
To view/edit data in the Dockerized PostgreSQL database using Prisma Studio:

1. Ensure your local `.env` file has the `DATABASE_URL` and `DIRECT_URL` pointing to `localhost:5433` as described in step 2.
2. Ensure your Docker containers are running (`docker-compose up`).
3. In a new terminal window (on your Mac, in the project root), run:

```bash
npx prisma studio
```

This will open Prisma Studio in your browser at http://localhost:5555, connected to the database inside your Docker container.

## 📜 Key Scripts

These scripts are typically defined in `package.json` and run via Yarn (or npm). When using Docker, the primary script `yarn dev` is run by `docker-compose.yml` for the app service.

* **`yarn dev`**: Starts the development server using `nodemon` and `ts-node` for hot-reloading. (This is the command used by `docker-compose.yml` for the app service).
* **`yarn build`**: (You would add this script) Compiles TypeScript to JavaScript, e.g., `tsc`. Used for production builds.
* **`npx prisma migrate dev --name <migration_name>`**: Creates and applies a new database migration. (Run via `docker-compose exec app ...` when using Docker).
* **`npx prisma generate`**: Generates/updates Prisma Client. (Run via `docker-compose exec app ...` after schema changes if not relying solely on the Docker build step).
* **`npx prisma studio`**: Opens Prisma Studio to view/manage database data. (Run from your Mac terminal, configured `.env` to point to Docker DB's exposed port).

## 📁 Project Structure Overview

```
leads-support-agent-smb/
├── prisma/                     # Prisma schema, migrations, seed (optional)
│   └── schema.prisma
├── src/
│   ├── api/                    # Express route handlers (admin, chat, views)
│   │   ├── admin.ts
│   │   ├── authMiddleware.ts
│   │   ├── chatRoutes.ts
│   │   └── viewRoutes.ts
│   ├── core/                   # Core AI logic
│   │   ├── aiHandler.ts        # Main message processing, intent, flows
│   │   └── ragService.ts       # Retrieval-Augmented Generation logic
│   ├── services/               # External service integrations
│   │   ├── db.ts               # Prisma client instance
│   │   ├── notificationService.ts # Email/SMS notifications
│   │   └── openai.ts           # OpenAI API client wrapper
│   ├── public/                 # Static assets served by Express
│   │   └── widget.js           # Frontend chat widget script
│   ├── views/                  # EJS templates for Admin Dashboard
│   │   ├── login.ejs
│   │   ├── dashboard.ejs
│   │   ├── agent-settings.ejs
│   │   ├── lead-questions.ejs
│   │   ├── knowledge-base.ejs
│   │   └── view-leads.ejs
│   └── server.ts               # Express server setup, main entry point
├── .env                        # Local environment variables (DO NOT COMMIT)
├── .dockerignore               # Specifies files to ignore for Docker builds
├── Dockerfile                  # Instructions to build the application Docker image
├── docker-compose.yml          # Defines and runs multi-container Docker app (app + DB)
├── nodemon.json                # Nodemon configuration
├── package.json                # Project dependencies and scripts
├── tsconfig.json               # TypeScript compiler configuration
└── yarn.lock                   # Yarn lockfile
```

## 🔮 Future Enhancements (V1.1 / V2 and Beyond)

* More advanced AI decision-making framework and deeper contextual understanding.
* **Multi-Channel Support:**
    * SMS integration (e.g., via Twilio).
    * Voice call integration (AI voice agent).
    * Voice message/dictation input in the website widget.
    * Social Media DMs (Instagram, Facebook).
* Enhanced Accessibility for the chat widget.
* Portability: Ability to embed/integrate the agent beyond a simple website widget.
* Direct CRM Integrations: HubSpot, Salesforce, etc., for automatic lead flagging, sorting, and prioritization.
* Chat Widget UI Enhancements: Custom avatars/emojis, branding options, visual cues for AI interaction.
* Full CRUD in Admin UI: Add Edit/Delete for Lead Questions and Knowledge Base.
* Advanced Lead Management in Admin UI: Update status, add notes, filtering, pagination for leads.
* Automated testing suite.
* Scalability and performance optimizations for production.

## 📝 License

This software is proprietary and confidential. All rights reserved.

Copyright (c) 2024 Leads Support AI Agent for SMBs

This software and associated documentation files (the "Software") are the proprietary property of the copyright holder. The Software may not be used, copied, modified, merged, published, distributed, sublicensed, and/or sold without explicit written permission from the copyright holder.

For licensing inquiries, please contact the repository owner. 