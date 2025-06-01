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
    // origin will be 'http://127.0.0.1:8080' from live-server
    // origin will be undefined for same-origin, Postman, or server-side requests
    // origin will be 'null' for file:/// (though we are trying to avoid this with live-server)
    console.log("CORS Check - Request Origin header:", origin); // For debugging

    const devAllowedOrigins = [
      'http://127.0.0.1:8080', // Your live-server origin
      'http://localhost:3000',   // Add this for your admin dashboard itself
      // Add other local development origins here if needed
    ];
    const productionAllowedOrigins = process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : [];

    if (process.env.NODE_ENV === 'development') {
      if (!origin || devAllowedOrigins.includes(origin)) {
        console.log("CORS Development: Allowing origin:", origin || 'current server origin');
        callback(null, true); // Allow this origin
      } else {
        console.log("CORS Development: Blocking origin:", origin);
        callback(new Error(`Not allowed by CORS in development. Origin: ${origin}`));
      }
    } else { // Production or other environments
      if (origin && productionAllowedOrigins.includes(origin)) {
        console.log("CORS Production: Allowing origin:", origin);
        callback(null, true);
      } else {
        console.log("CORS Production: Blocking origin:", origin);
        callback(new Error('Not allowed by CORS.'));
      }
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
app.use('/static', express.static(path.join(__dirname, 'public')))

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
  res.sendFile(path.join(__dirname, 'public', 'widget.js'))
})

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