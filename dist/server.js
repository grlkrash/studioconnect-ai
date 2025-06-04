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
const fs_1 = __importDefault(require("fs"));
// Load environment variables
dotenv_1.default.config();
// Import route handlers
const chatRoutes_1 = __importDefault(require("./api/chatRoutes"));
const admin_1 = __importDefault(require("./api/admin"));
const viewRoutes_1 = __importDefault(require("./api/viewRoutes"));
// At the very top of src/server.ts, or right after all imports
console.log("<<<<< STARTUP ENV VAR CHECK >>>>>");
console.log("NODE_ENV from process.env:", process.env.NODE_ENV);
console.log("PORT from process.env:", process.env.PORT);
console.log("DATABASE_URL (first 30 chars):", process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 30) + "..." : "DATABASE_URL is UNDEFINED");
console.log("JWT_SECRET (exists?):", process.env.JWT_SECRET ? 'Exists' : 'JWT_SECRET is MISSING!');
console.log("OPENAI_API_KEY (exists?):", process.env.OPENAI_API_KEY ? 'Exists (starts sk-...)' : 'OPENAI_API_KEY is MISSING!');
console.log("--- CORS Related ENV VARS as seen by process.env ---");
console.log("APP_PRIMARY_URL:", process.env.APP_PRIMARY_URL);
console.log("ADMIN_CUSTOM_DOMAIN_URL:", process.env.ADMIN_CUSTOM_DOMAIN_URL);
console.log("WIDGET_DEMO_URL:", process.env.WIDGET_DEMO_URL);
console.log("WIDGET_TEST_URL:", process.env.WIDGET_TEST_URL);
console.log("FRONTEND_PRODUCTION_URL:", process.env.FRONTEND_PRODUCTION_URL);
console.log("<<<<< END STARTUP ENV VAR CHECK >>>>>");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
// CORS configuration - MUST BE FIRST MIDDLEWARE
const corsOptions = {
    origin: function (origin, callback) {
        // Only log detailed CORS info for actual browser requests (not health checks/internal calls)
        if (origin) {
            console.log("[CORS Debug] Request Origin:", origin);
        }
        // Debug logs for environment variables at the moment of CORS check (only for requests with origin)
        if (origin) {
            console.log("[CORS Env Check] APP_PRIMARY_URL:", process.env.APP_PRIMARY_URL);
            console.log("[CORS Env Check] ADMIN_CUSTOM_DOMAIN_URL:", process.env.ADMIN_CUSTOM_DOMAIN_URL);
            console.log("[CORS Env Check] WIDGET_DEMO_URL:", process.env.WIDGET_DEMO_URL);
            console.log("[CORS Env Check] WIDGET_TEST_URL:", process.env.WIDGET_TEST_URL);
            console.log("[CORS Env Check] FRONTEND_PRODUCTION_URL:", process.env.FRONTEND_PRODUCTION_URL);
        }
        const allowedOrigins = [
            process.env.APP_PRIMARY_URL,
            process.env.ADMIN_CUSTOM_DOMAIN_URL,
            process.env.WIDGET_DEMO_URL,
            process.env.WIDGET_TEST_URL,
            process.env.FRONTEND_PRODUCTION_URL,
            'http://127.0.0.1:8080', // Local development server
            'http://localhost:8080' // Local development server
        ]
            .filter(Boolean) // Remove undefined/null values
            .filter((value, index, self) => self.indexOf(value) === index); // Remove duplicates
        if (origin) {
            console.log("[CORS Debug] Constructed allowedOrigins array:", allowedOrigins);
        }
        // Allow requests without origin (same-origin, Postman, curl, health checks, etc.)
        if (!origin || allowedOrigins.includes(origin)) {
            if (origin) {
                console.log("[CORS Debug] Allowing origin:", origin, "Allowed List:", allowedOrigins);
            }
            callback(null, true);
        }
        else {
            console.log("[CORS Debug] Blocking origin:", origin, "| Allowed List:", allowedOrigins);
            callback(null, false); // Changed from Error to false for better handling
        }
    },
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie", "X-Requested-With"],
    preflightContinue: false,
    optionsSuccessStatus: 204
};
// Apply CORS middleware first
app.use((0, cors_1.default)(corsOptions));
// Then other middleware
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
app.use((0, cookie_parser_1.default)());
// Set up EJS for server-side rendering
app.set('view engine', 'ejs');
app.set('views', path_1.default.join(__dirname, '../views'));
// =======================
// ROUTE MOUNTING ORDER
// =======================
// 1. Mount admin view routes FIRST
app.use('/admin', viewRoutes_1.default);
// 2. Mount API routes
app.use('/api/chat', chatRoutes_1.default);
app.use('/api/admin', admin_1.default);
// 3. Specific file serving routes
app.get('/widget.js', (req, res) => {
    // Using process.cwd() for more explicit path resolution
    const widgetPath = path_1.default.join(process.cwd(), 'public/widget.js');
    console.log(`WIDGET_DEBUG: Request for /widget.js. Attempting to send from: ${widgetPath}`);
    try {
        if (fs_1.default.existsSync(widgetPath)) {
            console.log(`WIDGET_DEBUG: File exists at ${widgetPath}. Setting Content-Type and trying to send...`);
            res.setHeader('Content-Type', 'application/javascript; charset=UTF-8');
            res.sendFile(widgetPath, (err) => {
                if (err) {
                    console.error('WIDGET_DEBUG: Error during res.sendFile:', err);
                    if (!res.headersSent) {
                        res.status(500).send('// Server error: Could not send widget file.');
                    }
                }
                else {
                    console.log('WIDGET_DEBUG: widget.js sent successfully via res.sendFile.');
                }
            });
        }
        else {
            console.error(`WIDGET_DEBUG: Widget file NOT FOUND at: ${widgetPath}`);
            res.status(404).send('// Widget script not found.');
        }
    }
    catch (e) {
        console.error('WIDGET_DEBUG: Exception caught in /widget.js route handler:', e.message);
        if (!res.headersSent) {
            res.status(500).send('// Server error processing widget request.');
        }
    }
});
// 4. Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0'
    });
});
// 5. Debug route to test routing
app.get('/admin-test', (req, res) => {
    res.json({ message: 'Admin routing is working!', timestamp: new Date().toISOString() });
});
// 6. Root route handler
app.get('/', (req, res) => {
    res.send('Application Root - Hello from Deployed App!');
});
// 7. Static file serving (general)
app.use('/static', express_1.default.static(path_1.default.join(__dirname, '../public')));
// Debug logs for static path
const staticPath = path_1.default.join(__dirname, '../public');
console.log(`DEPLOY_DEBUG: Attempting to serve static files from resolved path: ${staticPath}`);
try {
    const files = fs_1.default.readdirSync(staticPath);
    console.log('DEPLOY_DEBUG: Files found in static path directory by Express:', files);
}
catch (e) {
    console.error('DEPLOY_DEBUG: Error reading static path directory by Express:', e.message);
}
// =======================
// WILDCARD 404 HANDLER - MUST BE LAST!
// =======================
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
    console.log(`✅ Admin routes mounted at: http://localhost:${PORT}/admin`);
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
//# sourceMappingURL=server.js.map