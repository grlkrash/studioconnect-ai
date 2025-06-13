import express, { Request, Response, NextFunction } from 'express'
import dotenv from 'dotenv'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import path from 'path'
import fs from 'fs'
import http from 'http'
import OpenAI from 'openai'
import { UserPayload } from './api/authMiddleware'

// Load environment variables
dotenv.config()

// Import Redis and session service
import RedisManager from './config/redis'
import VoiceSessionService from './services/voiceSessionService'
import { setupWebSocketServer } from './services/websocketServer'

// Import route handlers
import chatRoutes from './api/chatRoutes'
import adminRoutes from './api/admin'
import viewRoutes from './api/viewRoutes'
import voiceRoutes from './api/voiceRoutes'

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
      'http://localhost:8080'  // Local development server
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

// Set up EJS for server-side rendering
app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, '../views'))

// =======================
// ROUTE MOUNTING ORDER
// =======================

// 1. Mount admin view routes FIRST
app.use('/admin', viewRoutes)

// 2. Mount API routes
app.use('/api/chat', chatRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/voice', voiceRoutes)

// 3. Specific file serving routes
app.get('/widget.js', (req: Request, res: Response) => {
  // Using process.cwd() for more explicit path resolution
  const widgetPath = path.join(process.cwd(), 'public/widget.js'); 

  console.log(`WIDGET_DEBUG: Request for /widget.js. Attempting to send from: ${widgetPath}`);
  try {
    if (fs.existsSync(widgetPath)) {
      console.log(`WIDGET_DEBUG: File exists at ${widgetPath}. Setting Content-Type and trying to send...`);
      res.setHeader('Content-Type', 'application/javascript; charset=UTF-8');
      res.sendFile(widgetPath, (err) => {
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
    console.error('WIDGET_DEBUG: Exception caught in /widget.js route handler:', e.message);
    if (!res.headersSent) {
      res.status(500).send('// Server error processing widget request.');
    }
  }
})

// 4. Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
})

// 5. Debug route to test routing
app.get('/admin-test', (req, res) => {
  res.json({ message: 'Admin routing is working!', timestamp: new Date().toISOString() })
})

// 6. Root route handler
app.get('/', (req, res) => {
  res.send('Application Root - Hello from Deployed App!');
});

// 7. Static file serving (general)
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
    const redisManager = RedisManager.getInstance()
    await redisManager.connect()
    console.log('✅ Redis connection established')
    
    const sessionService = VoiceSessionService.getInstance()
    setInterval(async () => {
      await sessionService.cleanupExpiredSessions()
    }, 5 * 60 * 1000) // Run cleanup every 5 minutes
    
  } catch (error) {
    console.warn('⚠️  Redis connection failed, falling back to in-memory sessions:', error)
  }
}

// Start server
const httpServer = http.createServer(app)

// Add upgrade event listener for WebSocket debugging
httpServer.on('upgrade', (request, socket, head) => {
  console.log('--- HTTP UPGRADE REQUEST RECEIVED ---')
  console.log('Request URL:', request.url)
  console.log('Request Headers:', JSON.stringify(request.headers, null, 2))
  console.log('------------------------------------')
})

// Setup WebSocket Server
setupWebSocketServer(httpServer)

// Start the server
const server = httpServer.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`)
  console.log(`📊 Health check: http://localhost:${PORT}/health`)
  console.log(`🤖 Chat widget: http://localhost:${PORT}/widget.js`)
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`)
  console.log(`✅ Admin routes mounted at: http://localhost:${PORT}/admin`)
  
  // Initialize Redis after server starts
  await initializeRedis()
})

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully')
  
  try {
    const redisManager = RedisManager.getInstance()
    await redisManager.disconnect()
    console.log('✅ Redis disconnected')
  } catch (error) {
    console.error('Error during graceful shutdown:', error)
  }
  
  server.close(() => {
    console.log('Process terminated')
  })
})

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully')
  
  try {
    const redisManager = RedisManager.getInstance()
    await redisManager.disconnect()
    console.log('✅ Redis disconnected')
  } catch (error) {
    console.error('Error during graceful shutdown:', error)
  }
  
  server.close(() => {
    console.log('Process terminated')
  })
})

export default app