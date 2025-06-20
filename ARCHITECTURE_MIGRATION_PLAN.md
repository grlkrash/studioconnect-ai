# StudioConnect AI: Architecture Migration Plan (V2 - Detailed)

## Current Architecture Analysis

### Dual-Server Setup Issues

You currently have a **problematic dual-server architecture**:

1. **Express.js Backend** (`src/`) - Main API server
   - Voice processing and WebSocket connections
   - All business logic and integrations
   - Serves at `localhost:3000`

2. **Next.js Admin Dashboard** (`dashboard/`) - Static export
   - Admin interface only
   - Static export with `basePath: "/admin"`
   - Serves at `localhost:3100`

### Current Problems

#### 1. **Development Complexity**
- Two separate development servers
- Duplicate dependencies and configurations
- Complex CORS setup between servers
- Environment variable duplication

#### 2. **Deployment Issues**
- Two separate containers/processes
- Inter-service communication overhead
- Complex load balancing requirements
- Double the infrastructure costs

#### 3. **Build Errors**
Your current Next.js build is failing:
```bash
Build error occurred
[Error: ENOENT: no such file or directory, open '/Users/sonia/studioconnect-ai/dashboard/.next/server/pages-manifest.json']
```

#### 4. **Runtime Errors**
Your Express server has import issues:
```bash
ReferenceError: authRoutes is not defined
```

#### 5. **Architectural Inconsistencies**
- Next.js configured for static export but trying to use server features
- Express serving static Next.js files (awkward hybrid)
- CORS complexity between localhost:3000 and localhost:3100

## Recommended Solution: Unified Next.js Full-Stack Architecture

### Why This is the Correct Approach

#### Technical Benefits
- **Single codebase** - All frontend and backend in one place
- **Unified routing** - Next.js App Router handles both UI and API
- **Better performance** - No inter-service communication
- **Modern features** - Server components, streaming, edge functions

#### Operational Benefits
- **Simplified deployment** - One container, one process
- **Easier debugging** - Single application to monitor
- **Better scaling** - Next.js optimization built-in
- **Cost reduction** - Half the infrastructure

#### Developer Experience
- **Single dev server** - `npm run dev` starts everything
- **Shared types** - No API contract management
- **Hot reloading** - For both frontend and backend changes
- **Unified testing** - One test suite

## Migration Architecture

### Current Structure
```
studioconnect-ai/
├── src/                    # Express.js Backend
│   ├── api/               # Express routes
│   ├── services/          # Business logic
│   ├── server.ts          # Express server
│   └── ...
├── dashboard/             # Next.js Dashboard
│   ├── app/               # Next.js App Router
│   ├── components/        # UI components
│   └── next.config.mjs    # Static export config
└── ...
```

### Target Structure
```
studioconnect-ai/
├── app/                   # Next.js App Router
│   ├── api/              # API Routes (replaces Express)
│   │   ├── chat/         # Chat endpoints
│   │   ├── voice/        # Voice processing
│   │   ├── auth/         # Authentication
│   │   └── ...
│   ├── admin/            # Admin dashboard
│   │   ├── dashboard/    # Dashboard pages
│   │   ├── settings/     # Settings pages
│   │   └── ...
│   ├── widget/           # Client widget
│   └── globals.css
├── lib/                  # Shared utilities
│   ├── services/         # Business logic
│   ├── db.ts            # Database connection
│   └── utils.ts         # Utilities
├── components/           # Reusable UI components
│   ├── ui/              # Shadcn components
│   └── ...
└── next.config.js       # Full-stack config
```

## Step-by-Step Technical Migration Plan

### Phase 1: Project Setup & Configuration

This phase establishes a new, clean Next.js project structure that will become the home for the unified application.

#### 1.1 Backup and Reorganize

First, let's create a new, consolidated directory structure. We'll move the existing code into a temporary location to be migrated piece-by-piece.

```bash
# In your project root (/Users/sonia/studioconnect-ai)

# 1. Create a backup/migration source directory
mkdir -p migration_source

# 2. Move existing code into the backup directory
mv src migration_source/express_backend
mv dashboard migration_source/nextjs_dashboard
mv prisma migration_source/prisma_schema

# 3. Create the new unified Next.js application in the current directory
npx create-next-app@latest . --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*"

# 4. Move the prisma schema into its new home
mv migration_source/prisma_schema prisma

# 5. Clean up placeholder files from the new app template
rm app/page.tsx
rm app/favicon.ico
rm app/logo.svg
rm -rf public/*
```

#### 1.2 Install Dependencies

Transfer all dependencies from both old `package.json` files into the new root `package.json`.

```bash
# Open the new package.json and add the dependencies from:
# - migration_source/express_backend/package.json
# - migration_source/nextjs_dashboard/package.json

# After updating package.json, install everything
npm install
```

#### 1.3 Configure `tsconfig.json`

Ensure your `tsconfig.json` is set up for path aliases and modern TypeScript.

```json
{
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

#### 1.4 Configure `next.config.mjs`

This configuration enables full-stack capabilities, including WebSocket support via a custom server.

```javascript
// next.config.mjs

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Required for Prisma to work correctly in server components/actions
    serverComponentsExternalPackages: ['@prisma/client'],
  },
  // This section is crucial for WebSocket support in a self-hosted environment
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push({
        'utf-8-validate': 'commonjs utf-8-validate',
        'bufferutil': 'commonjs bufferutil',
      });
    }
    return config;
  },
};

export default nextConfig;
```

### Phase 2: Services & Database Layer

#### 2.1 Migrate Prisma and Database Client

Create a singleton instance of the Prisma client to avoid connection exhaustion in a serverless-like environment.

**Create `lib/db.ts`:**
```typescript
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
```

Run `prisma generate` to create the client based on your schema.
```bash
npx prisma generate
```

#### 2.2 Migrate Business Services

Move all your business logic from `migration_source/express_backend/services` to `lib/services`. Then, update their imports to use the new Prisma client path.

**Example: `lib/services/clientService.ts`**
```typescript
// BEFORE
// import { prisma } from '../services/db'

// AFTER
import { db } from '@/lib/db'

// ... rest of the service file
```

### Phase 3: API Route Migration

This is where we replace Express endpoints with Next.js API Route Handlers.

#### 3.1 Example: Migrating Health Check Route

**Old File: `migration_source/express_backend/api/healthzRoutes.ts`**
```typescript
// ... (express router setup)
healthzRouter.get('/', async (req, res) => {
  // ... logic
  res.status(httpStatus).json({ ...healthStatus, responseTime: totalResponseTime })
})
```

**New File: `app/api/health/route.ts`**
```typescript
import { NextResponse } from 'next/server'
import { db } from '@/lib/db' // Updated import path

export async function GET() {
  const startTime = Date.now()
  
  const healthStatus = {
    status: 'healthy' as 'healthy' | 'degraded' | 'unhealthy',
    timestamp: new Date().toISOString(),
    checks: {
      database: { status: 'unknown' as 'pass' | 'fail' | 'unknown', responseTime: 0 },
      // ... other checks
    },
    // ... other fields
  }

  // Check Database Connection
  try {
    const dbStart = Date.now()
    await db.$queryRaw`SELECT 1` // use the singleton db instance
    healthStatus.checks.database = {
      status: 'pass',
      responseTime: Date.now() - dbStart
    }
  } catch (error) {
    console.error('[HEALTH CHECK] Database check failed:', error)
    healthStatus.checks.database = { status: 'fail', responseTime: 0 }
    healthStatus.status = 'unhealthy'
  }

  // ... (implement other checks similarly) ...

  const totalResponseTime = Date.now() - startTime
  let httpStatus = 200
  if (healthStatus.status === 'degraded') httpStatus = 200
  if (healthStatus.status === 'unhealthy') httpStatus = 503
  
  return NextResponse.json(
    { ...healthStatus, responseTime: totalResponseTime },
    { status: httpStatus }
  )
}
```

#### 3.2 Plan for `authMiddleware`

Express middleware can be migrated to Next.js Middleware or by wrapping API route handlers.

**Option A: Next.js Middleware (Recommended for broad protection)**

Create `middleware.ts` in the root directory. This will run before requests matching the `config.matcher`.

**`middleware.ts`:**
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET)

export async function middleware(req: NextRequest) {
  const token = req.cookies.get('auth_token')?.value

  if (!token) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    // You can attach the user payload to headers to pass it to the API route
    const requestHeaders = new Headers(req.headers)
    requestHeaders.set('x-user-payload', JSON.stringify(payload))
    
    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    })
  } catch (error) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }
}

export const config = {
  matcher: '/api/me', // Apply middleware only to specific routes
}
```

**Option B: Wrapper Function (For per-route logic)**

Create a higher-order function to wrap individual API routes.

**`lib/auth/withAuth.ts`:**
```typescript
// ... (implementation of a wrapper that checks token and calls the handler)
```

### Phase 4: WebSocket Migration

Since Vercel's serverless environment doesn't support persistent WebSocket servers, and you are self-hosting, we must create a custom Node.js server to run Next.js and the WebSocket server in the same process.

**1. Create `server.ts` in the root directory:**
```typescript
// server.ts
import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { WebSocketServer } from 'ws'

const dev = process.env.NODE_ENV !== 'production'
const hostname = 'localhost'
const port = 3000

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true)
    handle(req, res, parsedUrl)
  })

  // Initialize WebSocket Server
  const wss = new WebSocketServer({ server: httpServer })

  wss.on('connection', (ws) => {
    console.log('New client connected!')
    
    // This is where your logic from src/services/websocketServer.ts goes
    // e.g., setupWebSocketConnection(ws)
    
    ws.on('message', (message) => {
      console.log(`Received: ${message}`)
      ws.send(`Echo: ${message}`)
    })

    ws.on('close', () => {
      console.log('Client disconnected')
    })
  })

  httpServer
    .listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`)
    })
    .on('upgrade', (req, socket, head) => {
        // Handle WebSocket upgrade requests specifically for the voice stream
        const { pathname } = parse(req.url!, true);
        if (pathname === '/api/voice') { // Or your specific WebSocket path
            wss.handleUpgrade(req, socket, head, (ws) => {
                wss.emit('connection', ws, req);
            });
        } else {
            socket.destroy();
        }
    });
})

```

**2. Update `package.json` scripts:**
```json
"scripts": {
  "dev": "node server.ts",
  "build": "next build",
  "start": "NODE_ENV=production node server.ts",
  "lint": "next lint"
},
```
Now, all your WebSocket logic from `src/services/websocketServer.ts` can be ported into the `server.ts` file, running in the same process as your Next.js application.

### Phase 5: Dashboard & UI Migration

- **Move UI Code**: Copy all files from `migration_source/nextjs_dashboard/app` to `app/`. Copy components from `migration_source/nextjs_dashboard/components` to `components/`.
- **Update Imports**: Systematically go through the moved files and change relative paths to use the `@/` alias (e.g., `../components/ui/button` becomes `@/components/ui/button`).
- **Convert to Server Components**: Refactor pages that fetch data to do so directly on the server, eliminating client-side `useEffect` for data fetching and improving performance.

**Example: `app/clients/page.tsx`**
```typescript
// BEFORE (in old dashboard)
'use client'
import { useState, useEffect } from 'react'
// ...
export default function ClientsPage() {
  const [clients, setClients] = useState([])
  useEffect(() => {
    fetch('/api/clients').then(res => res.json()).then(data => setClients(data))
  }, [])
  // ... render table with loading state
}
```

**AFTER (in new unified app)**
```typescript
import { db } from '@/lib/db'
import { ClientTable } from '@/components/clients/client-table' // Assuming you create this

async function getClients() {
  // Directly fetch data on the server
  const clients = await db.client.findMany({
    // ... your query
  })
  return clients
}

export default async function ClientsPage() {
  const clients = await getClients()
  // No loading state needed, data is present on initial render
  return (
    <div>
      <h1>Clients</h1>
      <ClientTable data={clients} />
    </div>
  )
}
```

This updated, detailed plan provides a robust and technically sound path to a modern, maintainable, and high-performance system.

## Testing Strategy

### Phase 1: Parallel Testing
- Keep both servers running during migration
- Test each migrated endpoint against original
- Use automated testing to verify functionality

### Phase 2: Integration Testing
- Test complete user flows
- Verify WebSocket connections
- Test voice processing pipeline

### Phase 3: Performance Testing
- Compare response times
- Test concurrent connections
- Monitor resource usage

## Deployment Strategy

### Development
```bash
# Single command to start everything
npm run dev
```

### Docker Compose for Local Development
The `docker-compose.yml` file is the key to your local development environment. It will spin up your Next.js application, the PostgreSQL database, and Redis with a single command. Here is a more detailed, development-optimized version.

**Create/update `docker-compose.yml` in the root directory:**
```yaml
version: '3.8'
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    volumes:
      # Mounts your local code into the container for hot-reloading
      - .:/app
      # Prevents local node_modules from overwriting container's node_modules
      - /app/node_modules
    # Use the 'dev' script for development to enable hot-reloading
    command: npm run dev
    depends_on:
      - postgres
      - redis
    environment:
      - NODE_ENV=development
      - DATABASE_URL=postgresql://db_user:db_password@postgres:5432/studioconnect
      - REDIS_URL=redis://redis:6379
      # Add all other required environment variables from your .env file here

  postgres:
    image: postgres:15-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: studioconnect
      POSTGRES_USER: db_user
      POSTGRES_PASSWORD: db_password
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```
**To run your local dev environment:**
```bash
docker-compose up --build
```

### Render Production Deployment

For Render, you have two main options: using a `Dockerfile` or using their native Node.js environment. Both are covered here.

#### Option 1: Deploying with a `Dockerfile` on Render (Recommended for Control)

This approach uses the `Dockerfile` you create, giving you maximum control over the environment.

**1. Create a production-ready `Dockerfile` in your root directory:**
```dockerfile
# Dockerfile
# Stage 1: Install dependencies
FROM node:18-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: Build the application
FROM node:18-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# This will also run prisma generate due to the postinstall script
RUN npm run build

# Stage 3: Production image
FROM node:18-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy production dependencies and built assets
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000
CMD ["node", "server.js"]
```
*Note: This assumes you are using the Next.js standalone output feature for smaller Docker images.* You would need to add `output: 'standalone'` to your `next.config.mjs`.

**2. Configure your service on Render:**

- In the Render Dashboard, create a new "Web Service".
- Connect your GitHub/GitLab repository.
- **Select "Use your Dockerfile"**. Render will automatically detect and use your `Dockerfile`.
- **Set Environment Variables**: In the "Environment" tab, add all your production environment variables (e.g., `DATABASE_URL` from Render's own Postgres instance, `JWT_SECRET`, `OPENAI_API_KEY`, etc.).
- **Health Check**: Set the health check path to `/api/health`.

#### Option 2: Deploying as a Native Node.js App on Render

This is a simpler option if you don't need fine-grained Docker control.

**1. Configure your service on Render:**

- Create a new "Web Service" and connect your repository.
- **Environment**: Select "Node".
- **Build Command**: `npm install && npx prisma generate && npm run build`
- **Start Command**: `npm run start` (which executes `NODE_ENV=production node server.ts`)
- **Set Environment Variables**: Add all your production variables in the "Environment" tab.
- **Health Check**: Set the health check path to `/api/health`.

With both options, Render will manage the deployment process, and the unified Next.js app will run as a single service, connecting to your database and Redis instance within Render's infrastructure. This addition to the plan ensures your deployment strategy is as robust as your new architecture.

## Timeline and Milestones

### Week 1: Foundation
- [ ] Setup new Next.js structure
- [ ] Migrate core API routes
- [ ] Test basic functionality

### Week 2: Dashboard Migration
- [ ] Move dashboard components
- [ ] Update routing and navigation
- [ ] Test admin interface

### Week 3: Services and WebSocket
- [ ] Migrate business services
- [ ] Implement WebSocket support
- [ ] Test voice processing

### Week 4: Testing and Deployment
- [ ] Comprehensive testing
- [ ] Performance optimization
- [ ] Production deployment

## Risk Mitigation

### Technical Risks
- **WebSocket complexity** - Consider Server-Sent Events as fallback
- **Performance degradation** - Monitor response times during migration
- **Database connection issues** - Use connection pooling

### Business Risks
- **Downtime during migration** - Use blue-green deployment
- **Feature regression** - Comprehensive testing suite
- **Client impact** - Gradual rollout with rollback plan

## Success Metrics

### Performance Improvements
- [ ] Reduce deployment time by 50%
- [ ] Improve API response times by 25%
- [ ] Reduce infrastructure costs by 40%

### Developer Experience
- [ ] Single development server
- [ ] Unified debugging experience
- [ ] Faster build times

### Operational Benefits
- [ ] Simplified monitoring
- [ ] Unified logging
- [ ] Single point of failure

## Next Steps

1. **Backup current system** - Ensure we can rollback if needed
2. **Create migration branch** - Separate branch for migration work
3. **Start with API routes** - Begin with low-risk endpoints
4. **Test thoroughly** - Each component before moving to next
5. **Document changes** - Keep detailed migration log

## Resources and References

- [Next.js App Router Documentation](https://nextjs.org/docs/app)
- [Next.js API Routes](https://nextjs.org/docs/app/building-your-application/routing/route-handlers)
- [WebSocket in Next.js](https://github.com/vercel/next.js/discussions/46716)
- [Prisma with Next.js](https://www.prisma.io/docs/guides/other/troubleshooting-orm/help-articles/nextjs-prisma-client-dev-practices)

---

**Status**: Planning Phase  
**Next Review**: After Phase 1 completion  
**Owner**: Development Team  
**Priority**: High 