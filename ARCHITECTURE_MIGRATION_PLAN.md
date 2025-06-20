# StudioConnect AI: Architecture Migration Plan

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

## Recommended Solution: Next.js Full-Stack Migration

### Why Consolidate to Next.js?

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

## Step-by-Step Migration Plan

### Phase 1: Setup New Next.js Structure

#### 1.1 Initialize Next.js App Router
```bash
# Backup current setup
cp -r dashboard dashboard-backup
cp -r src src-backup

# Create new Next.js structure
npx create-next-app@latest studioconnect-ai-new --typescript --tailwind --app --src-dir=false

# Move to new structure
cd studioconnect-ai-new
```

#### 1.2 Update Next.js Configuration
```javascript
// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client'],
  },
  webpack: (config) => {
    config.externals.push({
      'utf-8-validate': 'commonjs utf-8-validate',
      'bufferutil': 'commonjs bufferutil',
    })
    return config
  }
}

export default nextConfig
```

### Phase 2: Migrate API Routes

#### 2.1 Convert Express Routes to Next.js API Routes

**Before (Express):**
```typescript
// src/api/chatRoutes.ts
import express from 'express'
const router = express.Router()

router.post('/chat', async (req, res) => {
  // handler logic
})

export default router
```

**After (Next.js):**
```typescript
// app/api/chat/route.ts
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    // handler logic
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
```

#### 2.2 Migration Priority Order

1. **Authentication routes** (`/api/auth/*`)
2. **Health check routes** (`/api/health`)
3. **Chat routes** (`/api/chat`)
4. **Voice routes** (`/api/voice/*`)
5. **Business logic routes** (`/api/business/*`)
6. **Integration routes** (`/api/integrations/*`)

### Phase 3: Migrate WebSocket Support

#### 3.1 Next.js WebSocket Implementation
```typescript
// app/api/voice/websocket/route.ts
import { NextRequest } from 'next/server'
import { WebSocketServer } from 'ws'

export async function GET(request: NextRequest) {
  const { searchParams, headers } = new URL(request.url)
  
  if (headers.get('upgrade') !== 'websocket') {
    return new Response('Expected websocket', { status: 400 })
  }

  // WebSocket upgrade logic
  // This requires custom server setup or using a WebSocket library
}
```

#### 3.2 Alternative: Server-Sent Events
For simpler implementation, consider using Server-Sent Events:
```typescript
// app/api/voice/stream/route.ts
export async function GET(request: NextRequest) {
  const encoder = new TextEncoder()
  
  const stream = new ReadableStream({
    start(controller) {
      // Stream logic
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
```

### Phase 4: Migrate Dashboard UI

#### 4.1 Move Dashboard Components
```bash
# Copy dashboard components
cp -r dashboard/app/* app/admin/
cp -r dashboard/components/* components/
cp -r dashboard/lib/* lib/
```

#### 4.2 Update Import Paths
```typescript
// Before
import { Button } from '../components/ui/button'

// After  
import { Button } from '@/components/ui/button'
```

#### 4.3 Convert to Server Components
```typescript
// app/admin/dashboard/page.tsx
import { getBusinessStats } from '@/lib/services/businessService'

export default async function DashboardPage() {
  const stats = await getBusinessStats()
  
  return (
    <div className="container mx-auto p-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      {/* Dashboard content */}
    </div>
  )
}
```

### Phase 5: Migrate Services and Database

#### 5.1 Move Services
```bash
mkdir -p lib/services
cp -r src/services/* lib/services/
```

#### 5.2 Update Database Configuration
```typescript
// lib/db.ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
```

#### 5.3 Update Service Imports
```typescript
// lib/services/businessService.ts
import { db } from '@/lib/db'

export async function getBusinessStats() {
  return await db.business.findMany()
}
```

### Phase 6: Environment and Configuration

#### 6.1 Consolidate Environment Variables
```bash
# Merge environment files
cat .env > .env.local
cat dashboard/.env >> .env.local
```

#### 6.2 Update Package.json
```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "^14.0.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0",
    "@prisma/client": "^5.0.0",
    "ws": "^8.0.0"
  }
}
```

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

### Production
```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
```

### Docker Compose
```yaml
# docker-compose.yml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL}
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: studioconnect
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}

  redis:
    image: redis:7-alpine
```

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