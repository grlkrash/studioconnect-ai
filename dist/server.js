"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
const http_1 = __importDefault(require("http"));
const https_1 = __importDefault(require("https"));
const openai_1 = __importDefault(require("openai"));
const next_1 = __importDefault(require("next"));
const widgetConfigRoutes_1 = __importDefault(require("./api/widgetConfigRoutes"));
const elevenlabsRoutes_1 = require("./api/elevenlabsRoutes");
const healthzRoutes_1 = require("./api/healthzRoutes");
dotenv_1.default.config();
const redis_1 = __importDefault(require("./config/redis"));
const voiceSessionService_1 = __importDefault(require("./services/voiceSessionService"));
const websocketServer_1 = require("./services/websocketServer");
const chatRoutes_1 = __importDefault(require("./api/chatRoutes"));
const admin_1 = __importDefault(require("./api/admin"));
const voiceRoutes_1 = __importDefault(require("./api/voiceRoutes"));
const projectRoutes_1 = __importDefault(require("./api/projectRoutes"));
const clientRoutes_1 = __importDefault(require("./api/clientRoutes"));
const knowledgeBaseRoutes_1 = __importDefault(require("./api/knowledgeBaseRoutes"));
const businessRoutes_1 = __importDefault(require("./api/businessRoutes"));
const agentConfigRoutes_1 = __importDefault(require("./api/agentConfigRoutes"));
const leadQuestionRoutes_1 = __importDefault(require("./api/leadQuestionRoutes"));
const integrationRoutes_1 = __importDefault(require("./api/integrationRoutes"));
const webhookRoutes_1 = __importDefault(require("./api/webhookRoutes"));
const interactionRoutes_1 = __importDefault(require("./api/interactionRoutes"));
const cron_1 = require("./services/projectSync/cron");
const voiceHealthMonitor_1 = require("./monitor/voiceHealthMonitor");
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
const corsOptions = {
    origin: function (origin, callback) {
        if (origin) {
            console.log("[CORS Debug] Request Origin:", origin);
        }
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
            'http://127.0.0.1:8080',
            'http://localhost:8080',
            'http://127.0.0.1:3100',
            'http://localhost:3100',
        ]
            .filter(Boolean)
            .filter((value, index, self) => self.indexOf(value) === index);
        if (origin) {
            console.log("[CORS Debug] Constructed allowedOrigins array:", allowedOrigins);
        }
        if (!origin || allowedOrigins.includes(origin)) {
            if (origin) {
                console.log("[CORS Debug] Allowing origin:", origin, "Allowed List:", allowedOrigins);
            }
            callback(null, true);
        }
        else {
            console.log("[CORS Debug] Blocking origin:", origin, "| Allowed List:", allowedOrigins);
            callback(null, false);
        }
    },
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie", "X-Requested-With"],
    preflightContinue: false,
    optionsSuccessStatus: 204
};
app.use((0, cors_1.default)(corsOptions));
app.use('/api/webhooks', express_1.default.raw({ type: '*/*', limit: '10mb' }));
app.use('/api/webhooks', webhookRoutes_1.default);
app.use(express_1.default.json({
    limit: '10mb',
    verify: (req, res, buf) => {
        try {
            JSON.parse(buf.toString());
        }
        catch (e) {
            res.status(400).json({ error: 'Invalid JSON' });
            throw new Error('Invalid JSON');
        }
    }
}));
app.use(express_1.default.urlencoded({
    extended: true,
    limit: '10mb'
}));
app.use((0, cookie_parser_1.default)());
app.post('/test-voice', (req, res) => {
    console.log('[VOICE TEST] The /test-voice endpoint was successfully reached.');
    const VoiceResponse = require('twilio').twiml.VoiceResponse;
    const twiml = new VoiceResponse();
    twiml.say('Test successful. The server is responding correctly.');
    twiml.hangup();
    res.type('text/xml');
    res.send(twiml.toString());
});
app.get('/test-realtime', async (req, res) => {
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
    }
    catch (error) {
        console.error('[REALTIME TEST] Error:', error);
        res.status(500).json({
            error: "Failed to check WebSocket server status",
            message: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString()
        });
    }
});
app.get('/test-key', async (req, res) => {
    console.log('[KEY TEST] Starting OpenAI API Key test...');
    try {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            console.error('[KEY TEST] Test failed: OPENAI_API_KEY is not set in the environment.');
            res.status(500).json({ status: 'error', message: 'OPENAI_API_KEY is not set.' });
            return;
        }
        const openai = new openai_1.default({ apiKey: apiKey });
        await openai.models.list();
        console.log('[KEY TEST] SUCCESS: The API Key is valid and successfully connected to OpenAI.');
        res.status(200).json({ status: 'success', message: 'API Key is valid and operational.' });
    }
    catch (error) {
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
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString()
    });
});
let isServerReady = false;
app.use('/api/voice', voiceRoutes_1.default);
app.use('/api/chat', chatRoutes_1.default);
app.use('*', (req, res, next) => {
    if (!isServerReady) {
        res.status(503).json({
            error: 'Service Unavailable – server is still starting, please retry shortly',
            timestamp: new Date().toISOString()
        });
        return;
    }
    next();
});
app.set('view engine', 'ejs');
app.set('views', [
    path_1.default.join(__dirname, '../views'),
    path_1.default.join(__dirname, '../src/views')
]);
app.get('/admin/login', (req, res) => {
    res.render('login', { error: null });
});
const dashboardDir = path_1.default.join(__dirname, '../dashboard');
const isDev = process.env.NODE_ENV !== 'production';
console.log(`[DASHBOARD] Initializing Next.js from: ${dashboardDir}`);
const nextApp = (0, next_1.default)({
    dev: isDev,
    dir: dashboardDir,
    conf: {
        poweredByHeader: false
    }
});
const handle = nextApp.getRequestHandler();
let nextReady = false;
let nextError = null;
nextApp.prepare().then(() => {
    console.log('[DASHBOARD] Next.js app prepared successfully');
    nextReady = true;
}).catch((err) => {
    console.error('[DASHBOARD] Error preparing Next.js app:', err);
    nextError = err;
});
app.use('/admin/_next', express_1.default.static(path_1.default.join(dashboardDir, '.next/static')));
app.use('/admin/static', express_1.default.static(path_1.default.join(dashboardDir, '.next/static')));
app.all('/admin*', (req, res) => {
    if (nextError) {
        return res.status(500).send('Dashboard initialization failed. Please check server logs.');
    }
    if (!nextReady) {
        return res.status(503).send('Dashboard is starting up. Please wait a moment and refresh.');
    }
    const originalUrl = req.url;
    req.url = req.url.replace(/^\/admin/, '') || '/';
    console.log(`[DASHBOARD] Handling ${originalUrl} -> ${req.url}`);
    return handle(req, res);
});
app.get('/test-calls', (req, res) => {
    const testPagePath = path_1.default.join(__dirname, '../public/test-calls.html');
    res.sendFile(testPagePath);
});
app.use('/api/admin', admin_1.default);
app.use('/api/clients', clientRoutes_1.default);
app.use('/api/projects', projectRoutes_1.default);
app.use('/api/knowledge-base', knowledgeBaseRoutes_1.default);
app.use('/api/business', businessRoutes_1.default);
app.use('/api/agent-config', agentConfigRoutes_1.default);
app.use('/api/lead-questions', leadQuestionRoutes_1.default);
app.use('/api/integrations', integrationRoutes_1.default);
app.use('/api/interactions', interactionRoutes_1.default);
app.use('/api/widget-config', widgetConfigRoutes_1.default);
app.use('/api/elevenlabs', elevenlabsRoutes_1.elevenLabsRouter);
app.use('/api/healthz', healthzRoutes_1.healthzRouter);
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.get('/healthz', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.post('/api/voice-preview', async (req, res) => {
    req.url = '/preview';
    (0, elevenlabsRoutes_1.elevenLabsRouter)(req, res, () => { });
});
const widgetHandler = (req, res) => {
    const widgetPath = path_1.default.join(process.cwd(), 'public/widget.js');
    console.log(`WIDGET_DEBUG: Request for ${req.path}. Attempting to send from: ${widgetPath}`);
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
        console.error('WIDGET_DEBUG: Exception caught in widget route handler:', e.message);
        if (!res.headersSent) {
            res.status(500).send('// Server error processing widget request.');
        }
    }
};
app.get('/widget.js', widgetHandler);
app.get('/embed.js', widgetHandler);
app.get('/admin-test', (req, res) => {
    res.json({ message: 'Admin routing is working!', timestamp: new Date().toISOString() });
});
app.get('/', (req, res) => {
    res.send('Application Root - Hello from Deployed App!');
});
app.use('/static', express_1.default.static(path_1.default.join(__dirname, '../public')));
const staticPath = path_1.default.join(__dirname, '../public');
console.log(`DEPLOY_DEBUG: Attempting to serve static files from resolved path: ${staticPath}`);
try {
    const files = fs_1.default.readdirSync(staticPath);
    console.log('DEPLOY_DEBUG: Files found in static path directory by Express:', files);
}
catch (e) {
    console.error('DEPLOY_DEBUG: Error reading static path directory by Express:', e.message);
}
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Route not found',
        path: req.originalUrl,
        method: req.method
    });
});
isServerReady = true;
app.use((err, req, res, next) => {
    console.error('Error:', err.stack);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});
async function initializeRedis() {
    try {
        console.log('🔄 Attempting Redis connection...');
        const redisManager = redis_1.default.getInstance();
        await redisManager.connect();
        console.log('✅ Redis connection established');
        const sessionService = voiceSessionService_1.default.getInstance();
        setInterval(async () => {
            try {
                await sessionService.cleanupExpiredSessions();
            }
            catch (err) {
                console.debug('[Redis Cleanup] Session cleanup failed:', err.message);
            }
        }, 5 * 60 * 1000);
    }
    catch (error) {
        console.warn('⚠️  Redis connection failed - continuing with in-memory fallback');
        console.debug('Redis error details:', error.message);
    }
}
let server;
const sslKeyPath = process.env.SSL_KEY_PATH;
const sslCertPath = process.env.SSL_CERT_PATH;
const shouldUseHttps = process.env.NODE_ENV === 'production' && sslKeyPath && sslCertPath &&
    fs_1.default.existsSync(sslKeyPath) && fs_1.default.existsSync(sslCertPath);
if (shouldUseHttps) {
    console.log('🔐 SSL configuration detected. Starting HTTPS server.');
    const sslOptions = {
        key: fs_1.default.readFileSync(sslKeyPath, 'utf8'),
        cert: fs_1.default.readFileSync(sslCertPath, 'utf8'),
    };
    if (process.env.SSL_CA_PATH && fs_1.default.existsSync(process.env.SSL_CA_PATH)) {
        sslOptions.ca = fs_1.default.readFileSync(process.env.SSL_CA_PATH, 'utf8');
    }
    server = https_1.default.createServer(sslOptions, app);
}
else {
    console.log('🌐 No valid SSL configuration found. Falling back to HTTP.');
    server = http_1.default.createServer(app);
}
server.on('upgrade', (request, socket, head) => {
    console.log('--- HTTP UPGRADE REQUEST RECEIVED ---');
    console.log('Request URL:', request.url);
    console.log('Request Headers:', JSON.stringify(request.headers, null, 2));
    console.log('------------------------------------');
});
(0, websocketServer_1.setupWebSocketServer)(server);
server.listen(PORT, async () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`🤖 Chat widget: http://localhost:${PORT}/widget.js`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`✅ Admin routes mounted at: http://localhost:${PORT}/admin`);
    await initializeRedis();
    console.log('🎯 INITIALIZING BULLETPROOF VOICE HEALTH MONITORING...');
    voiceHealthMonitor_1.voiceHealthMonitor.on('performanceAlert', (alert) => {
        console.error(`[🚨 PERFORMANCE ALERT] ${alert.type}: ${alert.message}`);
    });
    voiceHealthMonitor_1.voiceHealthMonitor.on('callStarted', (event) => {
        console.log(`[🎯 VOICE MONITOR] Call started: ${event.callSid}`);
    });
    voiceHealthMonitor_1.voiceHealthMonitor.on('callEnded', (event) => {
        console.log(`[🎯 VOICE MONITOR] Call ended: ${event.callSid} - ${event.status}`);
    });
    setInterval(() => {
        const report = voiceHealthMonitor_1.voiceHealthMonitor.generatePerformanceReport();
        console.log(report);
    }, 5 * 60 * 1000);
    console.log('✅ BULLETPROOF VOICE HEALTH MONITORING ACTIVE');
    (0, cron_1.startAsanaCron)();
    try {
        const { startAtlassianPdrCron } = await Promise.resolve().then(() => __importStar(require('./services/projectSync/cron')));
        startAtlassianPdrCron();
    }
    catch (err) {
        console.error('[Server] Failed to start PDR cron', err);
    }
});
let isShuttingDown = false;
async function performGracefulShutdown(signal) {
    if (isShuttingDown) {
        console.log(`${signal} received again, forcing immediate shutdown...`);
        process.exit(1);
    }
    isShuttingDown = true;
    console.log(`🛑 ${signal} received, initiating bulletproof graceful shutdown...`);
    const shutdownTimeout = setTimeout(() => {
        console.error('🚨 Graceful shutdown timeout reached, forcing exit');
        process.exit(1);
    }, 30000);
    try {
        console.log('🔒 Stopping server from accepting new connections...');
        server.close();
        console.log('📞 Gracefully closing active voice calls...');
        try {
            const { realtimeAgentService } = await Promise.resolve().then(() => __importStar(require('./services/realtimeAgentService')));
            const agentService = realtimeAgentService;
            const activeConnections = agentService.getActiveConnections();
            if (activeConnections > 0) {
                console.log(`📞 Found ${activeConnections} active voice calls, notifying callers...`);
                await agentService.cleanup('🔄 System maintenance in progress. Please call back in a few moments. Thank you for your patience.');
                await new Promise(resolve => setTimeout(resolve, 3000));
                console.log('✅ All voice calls gracefully closed');
            }
            else {
                console.log('✅ No active voice calls to close');
            }
        }
        catch (voiceError) {
            console.error('❌ Error during voice call cleanup:', voiceError);
        }
        console.log('🔌 Disconnecting from Redis...');
        try {
            const redisManager = redis_1.default.getInstance();
            await redisManager.disconnect();
            console.log('✅ Redis disconnected successfully');
        }
        catch (redisError) {
            console.error('❌ Error disconnecting Redis:', redisError);
        }
        console.log('🗃️ Closing database connections...');
        try {
            const { prisma } = await Promise.resolve().then(() => __importStar(require('./services/db')));
            await prisma.$disconnect();
            console.log('✅ Database connections closed');
        }
        catch (dbError) {
            console.error('❌ Error closing database connections:', dbError);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
        clearTimeout(shutdownTimeout);
        console.log('✅ Graceful shutdown completed successfully');
        process.exit(0);
    }
    catch (error) {
        console.error('❌ Error during graceful shutdown:', error);
        clearTimeout(shutdownTimeout);
        process.exit(1);
    }
}
process.on('SIGTERM', () => performGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => performGracefulShutdown('SIGINT'));
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
exports.default = app;
//# sourceMappingURL=server.js.map