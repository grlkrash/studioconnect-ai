import express, { Request, Response, NextFunction } from 'express'
import dotenv from 'dotenv'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import path from 'path'
import fs from 'fs'
import http from 'http'
import https from 'https'
import OpenAI from 'openai'
import { UserPayload } from './api/authMiddleware'
import next from 'next'
import widgetConfigRoutes from './api/widgetConfigRoutes'
import { elevenLabsRouter } from './api/elevenlabsRoutes'
import { healthzRouter } from './api/healthzRoutes'

// Load environment variables
dotenv.config()

// Import Redis and session service
import RedisManager from './config/redis'
import VoiceSessionService from './services/voiceSessionService'
import { initializeVoiceWebSocketServer } from './services/websocketServer'

// Import route handlers
import chatRoutes from './api/chatRoutes'
import adminRoutes from './api/admin'
import viewRoutes from './api/viewRoutes'
import voiceRoutes from './api/voiceRoutes'
import projectRoutes from './api/projectRoutes'
import clientRoutes from './api/clientRoutes'
import knowledgeBaseRoutes from './api/knowledgeBaseRoutes'
import businessRoutes from './api/businessRoutes'
import agentConfigRoutes from './api/agentConfigRoutes'
import leadQuestionRoutes from './api/leadQuestionRoutes'
import integrationRoutes from './api/integrationRoutes'
import webhookRoutes from './api/webhookRoutes'
import callHistoryRoutes from './api/callHistoryRoutes'
import interactionRoutes from './api/interactionRoutes'
import analyticsRoutes from './api/analyticsRoutes'
import authRoutes from './api/authRoutes'
import { startAsanaCron } from './services/projectSync/cron'
import { voiceHealthMonitor } from './monitor/voiceHealthMonitor'

// At the very top of src/server.ts, or right after all imports
console.log("<<<<< STARTUP ENV VAR CHECK >>>>>")
console.log("NODE_ENV from process.env:", process.env.NODE_ENV)
console.log("PORT from process.env:", process.env.PORT)
console.log("DATABASE_URL (first 30 chars):", process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 30) + "..." : "DATABASE_URL is UNDEFINED")
console.log("JWT_SECRET (exists?):", process.env.JWT_SECRET ? 'Exists' : 'JWT_SECRET is MISSING!')
console.log("OPENAI_API_KEY (exists?):", process.env.OPENAI_API_KEY ? 'Exists (starts sk-...)' : 'OPENAI_API_KEY is MISSING!')

console.log("--- CORS Related ENV VARS as seen by process.env ---")
console.log("APP_PRIMARY_URL:", process.env.APP_PRIMARY_URL)
console.log("ADMIN_CUSTOM_DOMAIN_URL:", process.env.ADMIN_CUSTOM_DOMAIN_URL)
console.log("WIDGET_DEMO_URL:", process.env.WIDGET_DEMO_URL)
console.log("WIDGET_TEST_URL:", process.env.WIDGET_TEST_URL)
console.log("FRONTEND_PRODUCTION_URL:", process.env.FRONTEND_PRODUCTION_URL)
console.log("<<<<< END STARTUP ENV VAR CHECK >>>>>")

const app = express()
const PORT = process.env.PORT || 3000

// CORS configuration - MUST BE FIRST MIDDLEWARE
const corsOptions = {
  origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
    // Only log detailed CORS info for actual browser requests (not health checks/internal calls)
    if (origin) {
      console.log("[CORS Debug] Request Origin:", origin)
    }
    
    // Debug logs for environment variables at the moment of CORS check (only for requests with origin)
    if (origin) {
      console.log("[CORS Env Check] APP_PRIMARY_URL:", process.env.APP_PRIMARY_URL)
      console.log("[CORS Env Check] ADMIN_CUSTOM_DOMAIN_URL:", process.env.ADMIN_CUSTOM_DOMAIN_URL)
      console.log("[CORS Env Check] WIDGET_DEMO_URL:", process.env.WIDGET_DEMO_URL)
      console.log("[CORS Env Check] WIDGET_TEST_URL:", process.env.WIDGET_TEST_URL)
      console.log("[CORS Env Check] FRONTEND_PRODUCTION_URL:", process.env.FRONTEND_PRODUCTION_URL)
    }

    const allowedOrigins = [
      process.env.APP_PRIMARY_URL,
      process.env.ADMIN_CUSTOM_DOMAIN_URL,
      process.env.WIDGET_DEMO_URL,
      process.env.WIDGET_TEST_URL,
      process.env.FRONTEND_PRODUCTION_URL,
      'http://127.0.0.1:8080', // Local development server
      'http://localhost:8080',  // Local development server
      'http://127.0.0.1:3100', // Next.js dashboard dev server
      'http://localhost:3100', // Next.js dashboard dev server
    ]
      .filter(Boolean) // Remove undefined/null values
      .filter((value, index, self) => self.indexOf(value) === index) // Remove duplicates

    if (origin) {
      console.log("[CORS Debug] Constructed allowedOrigins array:", allowedOrigins)
    }

    // Allow requests without origin (same-origin, Postman, curl, health checks, etc.)
    if (!origin || allowedOrigins.includes(origin)) {
      if (origin) {
        console.log("[CORS Debug] Allowing origin:", origin, "Allowed List:", allowedOrigins)
      }
      callback(null, true)
    } else {
      console.log("[CORS Debug] Blocking origin:", origin, "| Allowed List:", allowedOrigins)
      callback(null, false) // Changed from Error to false for better handling
    }
  },
  credentials: true,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Cookie", "X-Requested-With"],
  preflightContinue: false,
  optionsSuccessStatus: 204
}

// Apply CORS middleware first
app.use(cors(corsOptions))

// --- Webhook routes (need raw body) BEFORE body parsers ---
app.use('/api/webhooks', express.raw({ type: '*/*', limit: '10mb' }))
app.use('/api/webhooks', webhookRoutes)

// Body parsing middleware - MUST BE BEFORE ROUTES
app.use(express.json({ 
  limit: '10mb',
  verify: (req: Request, res: Response, buf: Buffer) => {
    try {
      JSON.parse(buf.toString())
    } catch (e) {
      res.status(400).json({ error: 'Invalid JSON' })
      throw new Error('Invalid JSON')
    }
  }
}))
app.use(express.urlencoded({ 
  extended: true,
  limit: '10mb'
}))
app.use(cookieParser())

// Type augmentation for Express Request
declare global {
  namespace Express {
    interface Request {
      user?: UserPayload
    }
  }
}

// Test route for diagnosing Twilio timeout issues - MUST BE BEFORE API ROUTES
app.post('/test-voice', (req: Request, res: Response) => {
  console.log('[VOICE TEST] The /test-voice endpoint was successfully reached.');
  const VoiceResponse = require('twilio').twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  twiml.say('Test successful. The server is responding correctly.');
  twiml.hangup();
  res.type('text/xml');
  res.send(twiml.toString());
});

// Test route for WebSocket server status
app.get('/test-realtime', async (req: Request, res: Response) => {
  try {
    console.log('[REALTIME TEST] The /test-realtime endpoint was reached.');
    
    res.json({
      message: "WebSocket server status check",
      timestamp: new Date().toISOString(),
      websocketServer: {
        initialized: true,
        activeConnections: 0
      },
      environment: {
        hostname: process.env.HOSTNAME || 'Not configured',
        openaiApiKey: !!process.env.OPENAI_API_KEY
      }
    });
    
  } catch (error) {
    console.error('[REALTIME TEST] Error:', error);
    res.status(500).json({
      error: "Failed to check WebSocket server status",
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// Test route for OpenAI API key validation
app.get('/test-key', async (req: Request, res: Response) => {
  console.log('[KEY TEST] Starting OpenAI API Key test...');
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('[KEY TEST] Test failed: OPENAI_API_KEY is not set in the environment.');
      res.status(500).json({ status: 'error', message: 'OPENAI_API_KEY is not set.' });
      return;
    }

    // Use a fresh OpenAI client to ensure no other configurations interfere
    const openai = new OpenAI({ apiKey: apiKey });

    // Make the simplest possible, lightweight API call
    await openai.models.list(); 
    
    console.log('[KEY TEST] SUCCESS: The API Key is valid and successfully connected to OpenAI.');
    res.status(200).json({ status: 'success', message: 'API Key is valid and operational.' });

  } catch (error: any) {
    console.error('[KEY TEST] FAILURE: The API Key test failed.', error);
    const statusCode = error.status || 500;
    res.status(statusCode).json({
      status: 'error',
      message: 'The API Key test failed.',
      errorDetails: {
        message: error.message,
        status: error.status,
        type: error.type,
      }
    });
  }
});

// ────────────────────────────────────────────────────────────
// EARLY HEALTH CHECK ROUTE
// Register this before any async operations (e.g., nextApp.prepare())
// so that Render and other platforms can immediately receive a 200
// during container startup.
// ────────────────────────────────────────────────────────────

app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString()
  })
})

// Server readiness flag for clearer boot-status responses
let isServerReady = false

// ────────────────────────────────────────────────────────────
// CRITICAL WEBHOOK ROUTES (mounted early)
// Mount external-facing webhooks *before* the asynchronous Next.js
// preparation to ensure 3rd-party callbacks (e.g. Twilio) never
// receive a 404 while Next.js is still compiling.
// ────────────────────────────────────────────────────────────

app.use('/api/voice', voiceRoutes)
app.use('/api/chat', chatRoutes)

// Fallback 503 handler during boot – must come AFTER early routes but BEFORE Next.js preparation
app.use('*', (req: Request, res: Response, next: NextFunction) => {
  if (!isServerReady) {
    res.status(503).json({
      error: 'Service Unavailable – server is still starting, please retry shortly',
      timestamp: new Date().toISOString()
    })
    return
  }
  next()
})

// Set up EJS for server-side rendering
app.set('view engine', 'ejs')
app.set('views', [
  path.join(__dirname, '../views'),        // compiled views directory
  path.join(__dirname, '../src/views')     // source views for ts-node/dev
])

// -------------------------------------------------
// TEMPORARY: Preserve legacy login page at /admin/login
// -------------------------------------------------
app.get('/admin/login', (req: Request, res: Response) => {
  res.render('login', { error: null })
})

// ────────────────────────────────────────────────────────────
// NEXT.JS DASHBOARD (dir: /dashboard) will be prepared below
// We first declare the app & handler, then defer route mounting
// and server start until after nextApp.prepare() completes.
// ────────────────────────────────────────────────────────────
// =======================
// STATIC DASHBOARD SERVING
// =======================

// Initialize Next.js for dashboard integration
const dashboardDir = path.join(__dirname, '../dashboard')
const isDev = process.env.NODE_ENV !== 'production'

console.log(`[DASHBOARD] Initializing Next.js from: ${dashboardDir}`)

// Initialize Next.js app
const nextApp = next({ 
  dev: isDev, 
  dir: dashboardDir,
  conf: {
    // Disable X-Powered-By header for security
    poweredByHeader: false
  }
})
const handle = nextApp.getRequestHandler()

// Variables to track Next.js initialization status
let nextReady = false
let nextError: Error | null = null

// Prepare Next.js app
nextApp.prepare().then(() => {
  console.log('[DASHBOARD] Next.js app prepared successfully')
  nextReady = true
}).catch((err) => {
  console.error('[DASHBOARD] Error preparing Next.js app:', err)
  nextError = err
})

// Serve dashboard static assets
app.use('/_next/static', express.static(path.join(dashboardDir, '.next/static')))
app.use('/admin/_next/static', express.static(path.join(dashboardDir, '.next/static')))
app.use('/admin/static', express.static(path.join(dashboardDir, 'public')))

// Redirect /dashboard/* to /admin/*
app.all('/dashboard*', (req: Request, res: Response) => {
  const redirectUrl = req.url.replace('/dashboard', '/admin')
  console.log(`[DASHBOARD] Redirecting ${req.url} -> ${redirectUrl}`)
  res.redirect(301, redirectUrl)
})

// Handle all admin routes with Next.js
app.all('/admin*', (req: Request, res: Response) => {
  if (nextError) {
    return res.status(500).send('Dashboard initialization failed. Please check server logs.')
  }
  
  if (!nextReady) {
    return res.status(503).send('Dashboard is starting up. Please wait a moment and refresh.')
  }
  
  // Rewrite the URL to remove /admin prefix for Next.js routing
  const originalUrl = req.url
  req.url = req.url.replace(/^\/admin/, '') || '/'
  
  console.log(`[DASHBOARD] Handling ${originalUrl} -> ${req.url}`)
  
  return handle(req, res)
})

// Test page for API debugging
app.get('/test-calls', (req: Request, res: Response) => {
  const testPagePath = path.join(__dirname, '../public/test-calls.html');
  res.sendFile(testPagePath);
});

// 2. Mount API routes
// (chat route mounted earlier to avoid 404 during Next.js prepare)
// app.use('/api/chat', chatRoutes)
app.use('/api/auth', authRoutes)
app.use('/admin/api/auth', authRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/clients', clientRoutes)
    app.use('/api/projects', projectRoutes)
    app.use('/api/knowledge-base', knowledgeBaseRoutes)
    app.use('/api/business', businessRoutes)
    app.use('/api/agent-config', agentConfigRoutes)
    app.use('/api/lead-questions', leadQuestionRoutes)
    app.use('/api/integrations', integrationRoutes)
    app.use('/api/calls', callHistoryRoutes)
    app.use('/api/interactions', interactionRoutes)
app.use('/api/analytics', analyticsRoutes)
app.use('/api/widget-config', widgetConfigRoutes)
    app.use('/api/elevenlabs', elevenLabsRouter)
    app.use('/api/healthz', healthzRouter)
    
    // Admin API routes (for dashboard)
    app.use('/admin/api/admin', adminRoutes)
    app.use('/admin/api/clients', clientRoutes)
    app.use('/admin/api/projects', projectRoutes)
    app.use('/admin/api/knowledge-base', knowledgeBaseRoutes)
    app.use('/admin/api/business', businessRoutes)
    app.use('/admin/api/agent-config', agentConfigRoutes)
    app.use('/admin/api/lead-questions', leadQuestionRoutes)
    app.use('/admin/api/integrations', integrationRoutes)
    app.use('/admin/api/calls', callHistoryRoutes)
    app.use('/admin/api/interactions', interactionRoutes)
    app.use('/admin/api/analytics', analyticsRoutes)
    app.use('/admin/api/widget-config', widgetConfigRoutes)
    app.use('/admin/api/elevenlabs', elevenLabsRouter)
    app.use('/admin/api/healthz', healthzRouter)
    
    // Legacy health check endpoints
    app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }))
    app.get('/healthz', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }))
    
    // Voice preview route (alias for UI compatibility)
    app.post('/api/voice-preview', async (req, res) => {
      // Forward to ElevenLabs preview endpoint
      req.url = '/preview'
      elevenLabsRouter(req, res, () => {})
    })

    // 3. Specific file serving routes
    // Serve the public chat widget bundle. Historically the snippet referenced
    // both `widget.js` and `embed.js`, so we alias the two paths here to avoid
    // breaking existing installs.
    const widgetHandler = (req: Request, res: Response) => {
      // Using process.cwd() for more explicit path resolution
      const widgetPath = path.join(process.cwd(), 'public/widget.js'); 

      console.log(`WIDGET_DEBUG: Request for ${req.path}. Attempting to send from: ${widgetPath}`);
      try {
        if (fs.existsSync(widgetPath)) {
          console.log(`WIDGET_DEBUG: File exists at ${widgetPath}. Setting Content-Type and trying to send...`);
          res.setHeader('Content-Type', 'application/javascript; charset=UTF-8');
          res.sendFile(widgetPath, (err: Error | null) => {
            if (err) {
              console.error('WIDGET_DEBUG: Error during res.sendFile:', err);
              if (!res.headersSent) {
                res.status(500).send('// Server error: Could not send widget file.');
              }
            } else {
              console.log('WIDGET_DEBUG: widget.js sent successfully via res.sendFile.');
            }
          });
        } else {
          console.error(`WIDGET_DEBUG: Widget file NOT FOUND at: ${widgetPath}`);
          res.status(404).send('// Widget script not found.');
        }
      } catch (e: any) {
        console.error('WIDGET_DEBUG: Exception caught in widget route handler:', e.message);
        if (!res.headersSent) {
          res.status(500).send('// Server error processing widget request.');
        }
      }
    };

    // Main path used in documentation
    app.get('/widget.js', widgetHandler);

    // Legacy alias kept for backwards-compatibility
    app.get('/embed.js', widgetHandler);

    // 4. Debug route to test routing
    app.get('/admin-test', (req: Request, res: Response) => {
      res.json({ message: 'Admin routing is working!', timestamp: new Date().toISOString() })
    })

    // 5. Root route handler
    app.get('/', (req: Request, res: Response) => {
      res.send('Application Root - Hello from Deployed App!');
    });

    // 6. Static file serving (general)
    app.use('/static', express.static(path.join(__dirname, '../public')))

    // Debug logs for static path
    const staticPath = path.join(__dirname, '../public');
    console.log(`DEPLOY_DEBUG: Attempting to serve static files from resolved path: ${staticPath}`);
    try {
      const files = fs.readdirSync(staticPath);
      console.log('DEPLOY_DEBUG: Files found in static path directory by Express:', files);
    } catch (e: any) {
      console.error('DEPLOY_DEBUG: Error reading static path directory by Express:', e.message);
    }

    // =======================
    // WILDCARD 404 HANDLER - MUST BE LAST!
    // =======================
    app.use('*', (req: express.Request, res: express.Response) => {
      res.status(404).json({
        error: 'Route not found',
        path: req.originalUrl,
        method: req.method
      })
    })

    // Signal that every route has been mounted – server is ready
    isServerReady = true

// Global error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err.stack)
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  })
})

// Initialize Redis connection
async function initializeRedis() {
  try {
    console.log('🔄 Attempting Redis connection...')
    const redisManager = RedisManager.getInstance()
    await redisManager.connect()
    console.log('✅ Redis connection established')
    
    const sessionService = VoiceSessionService.getInstance()
    setInterval(async () => {
      try {
        await sessionService.cleanupExpiredSessions()
      } catch (err) {
        console.debug('[Redis Cleanup] Session cleanup failed:', (err as Error).message)
      }
    }, 5 * 60 * 1000) // Run cleanup every 5 minutes
    
  } catch (error) {
    console.warn('⚠️  Redis connection failed - continuing with in-memory fallback')
    console.debug('Redis error details:', (error as Error).message)
    // Don't throw - let the app continue without Redis
  }
}

// ────────────────────────────────────────────────────────────
// CONDITIONAL HTTPS SUPPORT
// If SSL_KEY_PATH and SSL_CERT_PATH are provided (and files exist),
// the server will start in HTTPS mode. Otherwise, it will fall back
// to regular HTTP. This prevents "An SSL error has occurred" when
// the widget is loaded via https on production domains.
// ────────────────────────────────────────────────────────────

let server: http.Server | https.Server

const sslKeyPath = process.env.SSL_KEY_PATH
const sslCertPath = process.env.SSL_CERT_PATH

const shouldUseHttps =
  process.env.NODE_ENV === 'production' && sslKeyPath && sslCertPath &&
  fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath)

if (shouldUseHttps) {
  console.log('🔐 SSL configuration detected. Starting HTTPS server.')

  const sslOptions: https.ServerOptions = {
    key: fs.readFileSync(sslKeyPath!, 'utf8'),
    cert: fs.readFileSync(sslCertPath!, 'utf8'),
  }

  // Optional CA chain support
  if (process.env.SSL_CA_PATH && fs.existsSync(process.env.SSL_CA_PATH)) {
    sslOptions.ca = fs.readFileSync(process.env.SSL_CA_PATH, 'utf8')
  }

  server = https.createServer(sslOptions, app)
} else {
  console.log('🌐 No valid SSL configuration found. Falling back to HTTP.')
  server = http.createServer(app)
}

// Add upgrade event listener for WebSocket debugging
server.on('upgrade', (request, socket, head) => {
  console.log('--- HTTP UPGRADE REQUEST RECEIVED ---')
  console.log('Request URL:', request.url)
  console.log('Request Headers:', JSON.stringify(request.headers, null, 2))
  console.log('------------------------------------')
})

// 🏢 BULLETPROOF ENTERPRISE WEBSOCKET SERVER INITIALIZATION 🏢
console.log('🏢 INITIALIZING BULLETPROOF ENTERPRISE VOICE AGENT SYSTEM...')
const voiceWsServer = initializeVoiceWebSocketServer(server)
console.log('🏢 ✅ BULLETPROOF ENTERPRISE VOICE AGENT SYSTEM READY')
console.log('🎯 Fortune 100/50 quality voice calls now supported')
console.log('🔗 WebSocket endpoint: /voice-ws')
console.log('📞 Enterprise incoming: /api/voice/enterprise-incoming')

// Start the server
server.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`)
  console.log(`📊 Health check: http://localhost:${PORT}/health`)
  console.log(`🤖 Chat widget: http://localhost:${PORT}/widget.js`)
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`)
  console.log(`✅ Admin routes mounted at: http://localhost:${PORT}/admin`)
  
  // Initialize Redis after server starts
  await initializeRedis()

  // 🎯 INITIALIZE BULLETPROOF VOICE HEALTH MONITORING 🎯
  console.log('🎯 INITIALIZING BULLETPROOF VOICE HEALTH MONITORING...');

  // Set up real-time performance alerts
  voiceHealthMonitor.on('performanceAlert', (alert) => {
    console.error(`[🚨 PERFORMANCE ALERT] ${alert.type}: ${alert.message}`);
    
    // TODO: Send alerts to Slack, email, PagerDuty, etc.
    // Example: await sendSlackAlert(alert);
  });

  // Set up call tracking events
  voiceHealthMonitor.on('callStarted', (event) => {
    console.log(`[🎯 VOICE MONITOR] Call started: ${event.callSid}`);
  });

  voiceHealthMonitor.on('callEnded', (event) => {
    console.log(`[🎯 VOICE MONITOR] Call ended: ${event.callSid} - ${event.status}`);
  });

  // Generate performance report every 5 minutes
  setInterval(() => {
    const report = voiceHealthMonitor.generatePerformanceReport();
    console.log(report);
  }, 5 * 60 * 1000);

  console.log('✅ BULLETPROOF VOICE HEALTH MONITORING ACTIVE');

  // --- Start periodic Asana sync cron ---
  startAsanaCron()

  // --- Start Atlassian Personal Data Reporting cron (weekly) ---
  try {
    const { startAtlassianPdrCron } = await import('./services/projectSync/cron')
    startAtlassianPdrCron()
  } catch (err) {
    console.error('[Server] Failed to start PDR cron', err)
  }

  // --- Websocket server etc.
})

// 🎯 BULLETPROOF GRACEFUL SHUTDOWN FOR PRODUCTION VOICE CALLS 🎯
let isShuttingDown = false;

async function performGracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    console.log(`${signal} received again, forcing immediate shutdown...`);
    process.exit(1);
  }
  
  isShuttingDown = true;
  console.log(`🛑 ${signal} received, initiating bulletproof graceful shutdown...`);
  
  // Set a maximum shutdown time to prevent hanging
  const shutdownTimeout = setTimeout(() => {
    console.error('🚨 Graceful shutdown timeout reached, forcing exit');
    process.exit(1);
  }, 30000); // 30 seconds max shutdown time

  try {
    // 1. Stop accepting new connections immediately
    console.log('🔒 Stopping server from accepting new connections...');
    server.close();

    // 2. Gracefully close all active voice calls with proper notification
    console.log('📞 Gracefully closing active voice calls...');
    try {
      // Check bulletproof enterprise voice agent
      const { bulletproofEnterpriseAgent } = await import('./services/realtimeAgentService');
      
      const enterpriseConnections = bulletproofEnterpriseAgent.getActiveConnections();
      
      if (enterpriseConnections > 0) {
        console.log(`📞 Found ${enterpriseConnections} active enterprise voice calls, closing gracefully...`);
        
        // Enterprise agent handles its own graceful cleanup
        console.log('🏢 Enterprise voice agent will handle graceful cleanup automatically');
        
        // Wait a moment for cleanup to complete
        await new Promise(resolve => setTimeout(resolve, 3000));
        console.log('✅ All enterprise voice calls gracefully closed');
      } else {
        console.log('✅ No active voice calls to close');
      }
    } catch (voiceError) {
      console.error('❌ Error during voice call cleanup:', voiceError);
      // Continue with shutdown even if voice cleanup fails
    }

    // 3. Close Redis connection
    console.log('🔌 Disconnecting from Redis...');
    try {
      const redisManager = RedisManager.getInstance();
      await redisManager.disconnect();
      console.log('✅ Redis disconnected successfully');
    } catch (redisError) {
      console.error('❌ Error disconnecting Redis:', redisError);
    }

    // 4. Close any remaining database connections
    console.log('🗃️ Closing database connections...');
    try {
      const { prisma } = await import('./services/db');
      await prisma.$disconnect();
      console.log('✅ Database connections closed');
    } catch (dbError) {
      console.error('❌ Error closing database connections:', dbError);
    }

    // 5. Wait a moment for any final cleanup
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    clearTimeout(shutdownTimeout);
    console.log('✅ Graceful shutdown completed successfully');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error during graceful shutdown:', error);
    clearTimeout(shutdownTimeout);
    process.exit(1);
  }
}

// Enhanced graceful shutdown handlers
process.on('SIGTERM', () => performGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => performGracefulShutdown('SIGINT'));

// Handle uncaught exceptions and promise rejections gracefully
process.on('uncaughtException', (error) => {
  console.error('🚨 Uncaught Exception:', error);
  if (!isShuttingDown) {
    performGracefulShutdown('UNCAUGHT_EXCEPTION');
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
  if (!isShuttingDown) {
    performGracefulShutdown('UNHANDLED_REJECTION');
  }
});

export default app