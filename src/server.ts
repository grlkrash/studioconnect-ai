import express from 'express'
import dotenv from 'dotenv'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import path from 'path'

// Load environment variables
dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000

// Middleware configuration
app.use(cors({
  origin: function (origin, callback) {
    console.log("CORS Check - Request Origin header:", origin);

    // Define allowed origins
    // APP_OWN_URL will be your Render service URL (e.g., https://your-app-name.onrender.com)
    // FRONTEND_WIDGET_TEST_URL will be your local live-server (e.g., http://127.0.0.1:8080)
    // FRONTEND_PRODUCTION_URL will be your eventual app.cincyaisolutions.com

    const allowedOrigins = [
      process.env.APP_OWN_URL,
      process.env.FRONTEND_WIDGET_TEST_URL,
      process.env.FRONTEND_PRODUCTION_URL 
    ].filter(Boolean); // Remove any undefined/empty strings if ENV VARS are not set

    // Allow requests with no origin (like curl, server-to-server, some health checks)
    // OR if the origin is in our list of allowed origins
    if (!origin || allowedOrigins.includes(origin)) {
      console.log("CORS: Allowing origin:", origin || 'undefined/null');
      callback(null, true);
    } else {
      console.log("CORS: Blocking origin:", origin, "| Allowed:", allowedOrigins);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
}))

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())

// Set up EJS for server-side rendering
app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'))

// Serve static files (for the chat widget)
// Updated path to work with TypeScript build output structure
app.use('/static', express.static(path.join(__dirname, '../public')))

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0'
  })
})

// Import route handlers (these will be created later)
import chatRoutes from './api/chatRoutes'
import adminRoutes from './api/admin'
import viewRoutes from './api/viewRoutes'

// API Routes
app.use('/api/chat', chatRoutes)
app.use('/api/admin', adminRoutes)

// View Routes (for admin dashboard)
app.use('/admin', viewRoutes)

// Debug route to test routing
app.get('/admin-test', (req, res) => {
  res.json({ message: 'Admin routing is working!', timestamp: new Date().toISOString() })
})

// Serve the chat widget script
app.get('/widget.js', (req, res) => {
  res.set('Content-Type', 'application/javascript')
  res.sendFile(path.join(__dirname, '../public', 'widget.js'))
})

// Root route handler
app.get('/', (req, res) => {
  res.send('Application Root - Hello from Deployed App!');
});

// 404 handler
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

// Debug logs for static path
const staticPath = path.join(__dirname, '../public'); // This path assumes server.js is in dist/ and public is at the root of where dist is
console.log(`DEPLOY_DEBUG: Attempting to serve static files from resolved path: ${staticPath}`);
try {
  const files = require('fs').readdirSync(staticPath);
  console.log('DEPLOY_DEBUG: Files found in static path directory by Express:', files);
} catch (e: any) {
  console.error('DEPLOY_DEBUG: Error reading static path directory by Express:', e.message);
}

// Start server
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
  console.log(`📊 Health check: http://localhost:${PORT}/health`)
  console.log(`🤖 Chat widget: http://localhost:${PORT}/widget.js`)
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`)
  console.log(`✅ Admin routes mounted at: http://localhost:${PORT}/admin`)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully')
  server.close(() => {
    console.log('Process terminated')
  })
})

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully')
  server.close(() => {
    console.log('Process terminated')
  })
})

export default app 