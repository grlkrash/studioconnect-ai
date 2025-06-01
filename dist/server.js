"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const dotenv_1 = __importDefault(require("dotenv"));
const cors_1 = __importDefault(require("cors"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const path_1 = __importDefault(require("path"));
// Load environment variables
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
// Middleware configuration
app.use((0, cors_1.default)({
    origin: process.env.FRONTEND_URL || true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
}));
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
app.use((0, cookie_parser_1.default)());
// Set up EJS for server-side rendering
app.set('view engine', 'ejs');
app.set('views', path_1.default.join(__dirname, 'views'));
// Serve static files (for the chat widget)
app.use('/static', express_1.default.static(path_1.default.join(__dirname, 'public')));
// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0'
    });
});
// Import route handlers (these will be created later)
const chatRoutes_1 = __importDefault(require("./api/chatRoutes"));
const admin_1 = __importDefault(require("./api/admin"));
// import viewRoutes from './api/viewRoutes'
// API Routes
app.use('/api/chat', chatRoutes_1.default);
app.use('/api/admin', admin_1.default);
// View Routes (for admin dashboard)
// app.use('/', viewRoutes)
// Serve the chat widget script
app.get('/widget.js', (req, res) => {
    res.set('Content-Type', 'application/javascript');
    res.sendFile(path_1.default.join(__dirname, 'public', 'widget.js'));
});
// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Route not found',
        path: req.originalUrl,
        method: req.method
    });
});
// Global error handler
app.use((err, req, res, next) => {
    console.error('Error:', err.stack);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});
// Start server
const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`🤖 Chat widget: http://localhost:${PORT}/widget.js`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});
// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Process terminated');
    });
});
process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('Process terminated');
    });
});
exports.default = app;
