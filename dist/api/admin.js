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
const express_1 = require("express");
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = require("../services/db");
const authMiddleware_1 = require("./authMiddleware");
const ragService_1 = require("../core/ragService");
const router = (0, express_1.Router)();
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        console.log('LOGIN ATTEMPT:', { email, receivedPassword: password });
        if (!email || !password) {
            console.log('Login failed: Missing email or password in request body.');
            return res.status(400).json({
                error: 'Email and password are required'
            });
        }
        const user = await db_1.prisma.user.findUnique({
            where: { email },
            include: { business: true }
        });
        console.log('USER FROM DB:', user ? { ...user, passwordHash: user.passwordHash } : null);
        if (!user || !user.passwordHash) {
            console.log('Login failed: User not found or no password hash for email:', email);
            return res.status(401).json({
                error: 'Invalid email or password'
            });
        }
        // **NEW DETAILED LOGS FOR BCRYPT.COMPARE**
        console.log(`Plaintext password received for bcrypt: "${password}" (length: ${password.length})`);
        console.log(`Stored hash for bcrypt: "${user.passwordHash}" (length: ${user.passwordHash.length})`);
        const passwordMatch = await bcrypt_1.default.compare(password, user.passwordHash);
        console.log('PASSWORD MATCH RESULT from bcrypt.compare:', passwordMatch);
        // **EXTRA TEST: Hardcoded comparison (for sanity check)**
        const hardcodedPlainText = "password123";
        const hardcodedHashFromDB = "$2b$10$KFX9Z5vG1ONvZ3pL7dZ8A.J0sU84w6KzSBc.gYmY0kDoN9S3NqU/S";
        if (user.passwordHash === hardcodedHashFromDB) {
            const hardcodedMatchTest = await bcrypt_1.default.compare(hardcodedPlainText, hardcodedHashFromDB);
            console.log('HARDCODED bcrypt.compare("password123", known_hash_for_password123) RESULT:', hardcodedMatchTest);
        }
        else {
            console.log('Stored hash in DB does NOT match the known_hash_for_password123. This is a data entry problem in Prisma Studio.');
        }
        if (!passwordMatch) {
            console.log('Login failed: Password did not match for user:', email);
            return res.status(401).json({
                error: 'Invalid email or password'
            });
        }
        // Authentication successful
        console.log('AUTHENTICATION SUCCESSFUL for user:', email);
        // Create JWT payload
        const payload = {
            userId: user.id,
            businessId: user.businessId,
            role: user.role
        };
        console.log('TOKEN PAYLOAD:', payload);
        // Sign the token
        const token = jsonwebtoken_1.default.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
        // Set HTTP-only cookie
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
        });
        console.log('Token cookie set. Sending success response.');
        // Send success response
        res.status(200).json({
            message: 'Login successful',
            user: {
                id: user.id,
                email: user.email,
                role: user.role
            }
        });
    }
    catch (error) {
        console.error('ERROR IN LOGIN ROUTE:', error);
        res.status(500).json({
            error: 'Internal server error during login'
        });
    }
});
// NEW: Add a protected /me route
router.get('/me', authMiddleware_1.authMiddleware, (req, res) => {
    // If authMiddleware passes, req.user will be populated by our extended Request type
    // The UserPayload interface is exported from authMiddleware.ts,
    // and the Express.Request interface was extended there too.
    if (!req.user) {
        // This case should ideally be caught by authMiddleware sending a 401
        // but it's good defensive programming.
        return res.status(401).json({ error: 'Authentication failed or user details not found on request.' });
    }
    // Send back the user details that the middleware attached to req.user
    res.status(200).json({ currentUser: req.user });
});
// Get Agent Configuration
router.get('/config', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        // Get the businessId from the authenticated user
        const businessId = req.user.businessId;
        // Find the configuration for this business
        const config = await db_1.prisma.agentConfig.findUnique({
            where: { businessId }
        });
        // Check if configuration exists
        if (config) {
            res.status(200).json(config);
        }
        else {
            res.status(404).json({
                error: 'Configuration not found. Please create one.'
            });
        }
    }
    catch (error) {
        console.error('Error fetching agent configuration:', error);
        res.status(500).json({
            error: 'Internal server error while fetching configuration'
        });
    }
});
// Create/Update Agent Configuration
router.post('/config', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        // Get the businessId from the authenticated user
        const businessId = req.user.businessId;
        // Fetch business to check plan tier
        const business = await db_1.prisma.business.findUnique({
            where: { id: businessId }
        });
        if (!business) {
            return res.status(404).json({
                error: 'Business not found'
            });
        }
        // Extract configuration details from request body
        const { agentName, personaPrompt, welcomeMessage, leadCaptureCompletionMessage, colorTheme, voiceGreetingMessage, voiceCompletionMessage, voiceEmergencyMessage, voiceEndCallMessage, useOpenaiTts, openaiVoice, openaiModel } = req.body;
        // Basic validation
        if (!agentName || !personaPrompt || !welcomeMessage) {
            return res.status(400).json({
                error: 'Missing required fields: agentName, personaPrompt, and welcomeMessage are required'
            });
        }
        // Validate OpenAI voice for PRO plan businesses
        if (business.planTier === 'PRO' && openaiVoice) {
            const validVoices = ['ALLOY', 'ECHO', 'FABLE', 'ONYX', 'NOVA', 'SHIMMER'];
            const normalizedVoice = openaiVoice.toUpperCase();
            if (!validVoices.includes(normalizedVoice)) {
                return res.status(400).json({
                    error: `Invalid OpenAI voice. Must be one of: ${validVoices.join(', ')}`
                });
            }
        }
        // Prepare base config data
        const baseConfigData = {
            agentName,
            personaPrompt,
            welcomeMessage,
            leadCaptureCompletionMessage,
            colorTheme: colorTheme || {}
        };
        // Add voice fields only for PRO plan businesses
        const configData = business.planTier === 'PRO'
            ? {
                ...baseConfigData,
                voiceGreetingMessage: voiceGreetingMessage || null,
                voiceCompletionMessage: voiceCompletionMessage || null,
                voiceEmergencyMessage: voiceEmergencyMessage || null,
                voiceEndCallMessage: voiceEndCallMessage || null,
                useOpenaiTts: useOpenaiTts !== undefined ? Boolean(useOpenaiTts) : true,
                openaiVoice: openaiVoice ? openaiVoice.toUpperCase() : 'NOVA',
                openaiModel: openaiModel || 'tts-1'
            }
            : baseConfigData;
        // Upsert the configuration
        const config = await db_1.prisma.agentConfig.upsert({
            where: { businessId },
            create: {
                businessId,
                ...configData
            },
            update: configData
        });
        // Send back the created or updated configuration
        res.status(200).json(config);
    }
    catch (error) {
        console.error('Error creating/updating agent configuration:', error);
        res.status(500).json({
            error: 'Internal server error while saving configuration'
        });
    }
});
// Get Lead Capture Questions for Agent Configuration
router.get('/config/questions', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        // Get the businessId from the authenticated user
        const businessId = req.user.businessId;
        // Find the agent configuration for this business
        const agentConfig = await db_1.prisma.agentConfig.findUnique({
            where: { businessId }
        });
        // Check if agent configuration exists
        if (!agentConfig) {
            return res.status(404).json({
                error: 'Agent configuration not found for this business. Please create one first.'
            });
        }
        // Fetch all lead capture questions for this configuration
        const questions = await db_1.prisma.leadCaptureQuestion.findMany({
            where: { configId: agentConfig.id },
            orderBy: { order: 'asc' }
        });
        // Send back the questions array (empty array if no questions exist)
        res.status(200).json(questions);
    }
    catch (error) {
        console.error('Error fetching lead capture questions:', error);
        res.status(500).json({
            error: 'Internal server error while fetching lead capture questions'
        });
    }
});
// Create New Lead Capture Question
router.post('/config/questions', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        // Get the businessId from the authenticated user
        const businessId = req.user.businessId;
        // Extract question details from request body
        const { questionText, expectedFormat, order, mapsToLeadField, isEssentialForEmergency } = req.body;
        // Basic validation
        if (!questionText || order === undefined || order === null) {
            return res.status(400).json({
                error: 'Missing required fields: questionText and order are required'
            });
        }
        // Validate expectedFormat against allowed values
        const validFormats = ['TEXT', 'EMAIL', 'PHONE'];
        if (expectedFormat && !validFormats.includes(expectedFormat)) {
            return res.status(400).json({
                error: `Invalid expectedFormat. Must be one of: ${validFormats.join(', ')}`
            });
        }
        // Find the agent configuration for this business
        const agentConfig = await db_1.prisma.agentConfig.findUnique({
            where: { businessId }
        });
        // Check if agent configuration exists
        if (!agentConfig) {
            return res.status(404).json({
                error: 'Agent configuration must exist before adding questions. Please create one first.'
            });
        }
        // Create the new lead capture question
        const newQuestion = await db_1.prisma.leadCaptureQuestion.create({
            data: {
                questionText,
                expectedFormat: expectedFormat || 'TEXT', // Default to TEXT if not provided
                order: Number(order), // Ensure order is a number
                mapsToLeadField: mapsToLeadField || null,
                isEssentialForEmergency: Boolean(isEssentialForEmergency), // Convert to boolean, default false
                configId: agentConfig.id
            }
        });
        // Send back the newly created question with 201 status
        res.status(201).json(newQuestion);
    }
    catch (error) {
        console.error('Error creating lead capture question:', error);
        // Check for specific Prisma errors
        if (error instanceof Error) {
            // Handle unique constraint violation (e.g., duplicate order number)
            if (error.message.includes('Unique constraint')) {
                return res.status(400).json({
                    error: 'A question with this order number already exists for this configuration'
                });
            }
        }
        res.status(500).json({
            error: 'Internal server error while creating lead capture question'
        });
    }
});
// Update Lead Capture Question
router.put('/config/questions/:questionId', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        // Get the businessId from the authenticated user
        const businessId = req.user.businessId;
        const questionId = req.params.questionId;
        // Extract question details from request body
        const { questionText, expectedFormat, order, mapsToLeadField, isEssentialForEmergency } = req.body;
        // Basic validation
        if (!questionText || order === undefined || order === null) {
            return res.status(400).json({
                error: 'Missing required fields: questionText and order are required'
            });
        }
        // Validate expectedFormat against allowed values
        const validFormats = ['TEXT', 'EMAIL', 'PHONE'];
        if (expectedFormat && !validFormats.includes(expectedFormat)) {
            return res.status(400).json({
                error: `Invalid expectedFormat. Must be one of: ${validFormats.join(', ')}`
            });
        }
        // Find the question and verify ownership
        const question = await db_1.prisma.leadCaptureQuestion.findUnique({
            where: { id: questionId },
            include: { config: true }
        });
        // Check if question exists and belongs to the business
        if (!question || question.config.businessId !== businessId) {
            return res.status(404).json({
                error: 'Question not found or you do not have permission to modify it'
            });
        }
        // Update the question
        const updatedQuestion = await db_1.prisma.leadCaptureQuestion.update({
            where: { id: questionId },
            data: {
                questionText,
                expectedFormat: expectedFormat || 'TEXT',
                order: Number(order),
                mapsToLeadField: mapsToLeadField || null,
                isEssentialForEmergency: Boolean(isEssentialForEmergency) // Convert to boolean
            }
        });
        // Send back the updated question
        res.status(200).json(updatedQuestion);
    }
    catch (error) {
        console.error('Error updating lead capture question:', error);
        // Check for specific Prisma errors
        if (error instanceof Error) {
            // Handle unique constraint violation (e.g., duplicate order number)
            if (error.message.includes('Unique constraint')) {
                return res.status(400).json({
                    error: 'A question with this order number already exists for this configuration'
                });
            }
        }
        res.status(500).json({
            error: 'Internal server error while updating lead capture question'
        });
    }
});
// Delete Lead Capture Question
router.delete('/config/questions/:questionId', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        // Get the businessId from the authenticated user
        const businessId = req.user.businessId;
        const questionId = req.params.questionId;
        // Find the question and verify ownership
        const question = await db_1.prisma.leadCaptureQuestion.findUnique({
            where: { id: questionId },
            include: { config: true }
        });
        // Check if question exists and belongs to the business
        if (!question || question.config.businessId !== businessId) {
            return res.status(404).json({
                error: 'Question not found or you do not have permission to delete it'
            });
        }
        // Delete the question
        await db_1.prisma.leadCaptureQuestion.delete({
            where: { id: questionId }
        });
        // Send success response
        res.status(204).send();
    }
    catch (error) {
        console.error('Error deleting lead capture question:', error);
        res.status(500).json({
            error: 'Internal server error while deleting lead capture question'
        });
    }
});
// Create New Knowledge Base Entry
router.post('/knowledgebase', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        // Get the businessId from the authenticated user
        const businessId = req.user.businessId;
        // Extract knowledge base details from request body
        const { content, sourceURL } = req.body;
        // Validation: ensure content is present and not empty
        if (!content || content.trim() === '') {
            return res.status(400).json({
                error: 'Content is required and cannot be empty'
            });
        }
        // Create the new knowledge base entry
        // Note: embedding field will remain null - to be populated by RAG service later
        const newKnowledgeEntry = await db_1.prisma.knowledgeBase.create({
            data: {
                content,
                sourceURL: sourceURL || null, // Include sourceURL if provided
                businessId
                // embedding field is not set here - will be handled by RAG service
            }
        });
        // Generate and store embedding for the new entry
        try {
            await (0, ragService_1.generateAndStoreEmbedding)(newKnowledgeEntry.id);
        }
        catch (embeddingError) {
            // Log the embedding error, but still return success for the KB entry creation
            console.error(`Failed to generate embedding for KB entry ${newKnowledgeEntry.id}:`, embeddingError);
            // We'll let the KB entry creation be considered a success even if embedding fails
            // The embedding can potentially be regenerated later
        }
        // Send back the newly created knowledge base entry with 201 status
        res.status(201).json(newKnowledgeEntry);
    }
    catch (error) {
        console.error('Error creating knowledge base entry:', error);
        res.status(500).json({
            error: 'Internal server error while creating knowledge base entry'
        });
    }
});
// Get All Knowledge Base Entries for the Business
router.get('/knowledgebase', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        // Get the businessId from the authenticated user
        const businessId = req.user.businessId;
        // Fetch all knowledge base entries for this business
        // Order by createdAt descending (newest first)
        const knowledgeBaseEntries = await db_1.prisma.knowledgeBase.findMany({
            where: { businessId },
            orderBy: { createdAt: 'desc' }
        });
        // Send back the array of knowledge base entries with 200 OK status
        // This will be an empty array if no entries exist yet
        res.status(200).json(knowledgeBaseEntries);
    }
    catch (error) {
        console.error('Error fetching knowledge base entries:', error);
        res.status(500).json({
            error: 'Internal server error while fetching knowledge base entries'
        });
    }
});
// Get All Leads for the Business
router.get('/leads', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        // Get the businessId from the authenticated user
        const businessId = req.user.businessId;
        // Fetch all leads for this business
        // Order by createdAt descending (newest first)
        const leads = await db_1.prisma.lead.findMany({
            where: { businessId },
            orderBy: { createdAt: 'desc' }
        });
        // Send back the leads array with 200 OK status
        // This will be an empty array if no leads exist yet
        res.status(200).json(leads);
    }
    catch (error) {
        console.error('Error fetching leads:', error);
        res.status(500).json({
            error: 'Internal server error while fetching leads'
        });
    }
});
// Update Lead Status
router.put('/leads/:leadId/status', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        // Get the businessId from the authenticated user
        const businessId = req.user.businessId;
        const leadId = req.params.leadId;
        const { status } = req.body;
        // Validate status
        const validStatuses = ['NEW', 'CONTACTED', 'QUALIFIED', 'CLOSED_WON', 'CLOSED_LOST'];
        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({
                error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
            });
        }
        // Find the lead and verify ownership
        const lead = await db_1.prisma.lead.findUnique({
            where: { id: leadId }
        });
        // Check if lead exists and belongs to the business
        if (!lead || lead.businessId !== businessId) {
            return res.status(404).json({
                error: 'Lead not found or you do not have permission to modify it'
            });
        }
        // Update the lead status
        const updatedLead = await db_1.prisma.lead.update({
            where: { id: leadId },
            data: { status }
        });
        // Send back the updated lead
        res.status(200).json(updatedLead);
    }
    catch (error) {
        console.error('Error updating lead status:', error);
        res.status(500).json({
            error: 'Internal server error while updating lead status'
        });
    }
});
// Update Lead Notes
router.put('/leads/:leadId', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        // Get the businessId from the authenticated user
        const businessId = req.user.businessId;
        const leadId = req.params.leadId;
        const { notes } = req.body;
        // Find the lead and verify ownership
        const lead = await db_1.prisma.lead.findUnique({
            where: { id: leadId }
        });
        // Check if lead exists and belongs to the business
        if (!lead || lead.businessId !== businessId) {
            return res.status(404).json({
                error: 'Lead not found or you do not have permission to modify it'
            });
        }
        // Update the lead notes
        const updatedLead = await db_1.prisma.lead.update({
            where: { id: leadId },
            data: { notes }
        });
        // Send back the updated lead
        res.status(200).json(updatedLead);
    }
    catch (error) {
        console.error('Error updating lead notes:', error);
        res.status(500).json({
            error: 'Internal server error while updating lead notes'
        });
    }
});
// Add logout route
router.get('/logout', (req, res) => {
    // Clear the 'token' cookie
    res.cookie('token', '', {
        httpOnly: true,
        expires: new Date(0), // Set expiration to a past date
        secure: process.env.NODE_ENV === 'production', // Match your login cookie settings
        sameSite: 'strict' // Match your login cookie settings
    });
    // Redirect to login page
    res.redirect('/admin/login');
});
// Test SendGrid configuration endpoint
router.post('/test-sendgrid', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        const { testEmail } = req.body;
        if (!testEmail || !testEmail.includes('@')) {
            return res.status(400).json({ error: 'Valid test email address required' });
        }
        console.log('=== TESTING SENDGRID CONFIGURATION ===');
        console.log('Test email will be sent to:', testEmail);
        // Check SendGrid configuration
        if (!process.env.SENDGRID_API_KEY) {
            console.log('❌ SENDGRID_API_KEY not found in environment');
            return res.status(500).json({
                error: 'SENDGRID_API_KEY not configured',
                details: 'Environment variable SENDGRID_API_KEY is missing'
            });
        }
        if (!process.env.SENDGRID_API_KEY.startsWith('SG.')) {
            console.log('❌ SENDGRID_API_KEY has invalid format');
            console.log('Key starts with:', process.env.SENDGRID_API_KEY.substring(0, 3));
            return res.status(500).json({
                error: 'Invalid SENDGRID_API_KEY format',
                details: 'API key must start with "SG."'
            });
        }
        console.log('✅ SENDGRID_API_KEY found and has correct format');
        console.log('Key length:', process.env.SENDGRID_API_KEY.length);
        console.log('Key starts with:', process.env.SENDGRID_API_KEY.substring(0, 10) + '...');
        // Test direct SendGrid connection
        const sgTransport = await Promise.resolve().then(() => __importStar(require('nodemailer-sendgrid-transport')));
        const nodemailer = await Promise.resolve().then(() => __importStar(require('nodemailer')));
        const testTransporter = nodemailer.default.createTransport(sgTransport.default({
            auth: { api_key: process.env.SENDGRID_API_KEY }
        }));
        console.log('📧 Testing SendGrid transporter verification...');
        await testTransporter.verify();
        console.log('✅ SendGrid transporter verified successfully');
        // Send test email
        console.log('📤 Sending test email...');
        const testMailOptions = {
            from: process.env.FROM_EMAIL || 'sonia@cincyaisolutions.com',
            to: testEmail,
            subject: '🧪 SendGrid Test Email - Lead Agent System',
            html: `
        <h2>✅ SendGrid Configuration Test Successful!</h2>
        <p>This test email confirms that your SendGrid configuration is working properly.</p>
        <p><strong>Sent at:</strong> ${new Date().toISOString()}</p>
        <p><strong>From:</strong> Your Lead Agent System</p>
        <hr>
        <small>This is an automated test email. You can safely delete it.</small>
      `,
            text: `
SendGrid Configuration Test Successful!

This test email confirms that your SendGrid configuration is working properly.

Sent at: ${new Date().toISOString()}
From: Your Lead Agent System

This is an automated test email. You can safely delete it.
      `
        };
        const info = await testTransporter.sendMail(testMailOptions);
        console.log('✅ Test email sent successfully!');
        console.log('SendGrid response:', JSON.stringify(info, null, 2));
        res.status(200).json({
            success: true,
            message: 'SendGrid test email sent successfully',
            details: {
                sentTo: testEmail,
                messageId: info.messageId,
                sendGridResponse: info
            }
        });
    }
    catch (error) {
        console.error('❌ SendGrid test failed:', error);
        res.status(500).json({
            success: false,
            error: 'SendGrid test failed',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
// Update Knowledge Base Entry
router.put('/knowledgebase/:kbId', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        // Get the businessId from the authenticated user
        const businessId = req.user.businessId;
        const kbId = req.params.kbId;
        // Extract knowledge base details from request body
        const { content, sourceURL } = req.body;
        // Validation: ensure content is present if being updated
        if (content !== undefined && content.trim() === '') {
            return res.status(400).json({
                error: 'Content cannot be empty if provided'
            });
        }
        // Find the KB entry and verify ownership
        const kbEntry = await db_1.prisma.knowledgeBase.findUnique({
            where: { id: kbId }
        });
        // Check if KB entry exists and belongs to the business
        if (!kbEntry || kbEntry.businessId !== businessId) {
            return res.status(404).json({
                error: 'Knowledge base entry not found or you do not have permission to modify it'
            });
        }
        // Update the KB entry
        const updatedKbEntry = await db_1.prisma.knowledgeBase.update({
            where: { id: kbId },
            data: {
                content: content !== undefined ? content : undefined,
                sourceURL: sourceURL !== undefined ? sourceURL : undefined
            }
        });
        // Regenerate embedding if content was updated
        if (content !== undefined && updatedKbEntry) {
            try {
                await (0, ragService_1.generateAndStoreEmbedding)(updatedKbEntry.id);
                console.log(`Embedding regenerated for KB entry: ${updatedKbEntry.id}`);
            }
            catch (embedError) {
                console.error(`Error regenerating embedding for KB entry ${updatedKbEntry.id} after update:`, embedError);
                // We'll let the KB update be considered a success even if embedding regeneration fails
                // The embedding can potentially be regenerated later
            }
        }
        // Send back the updated KB entry
        res.status(200).json(updatedKbEntry);
    }
    catch (error) {
        console.error('Error updating knowledge base entry:', error);
        res.status(500).json({
            error: 'Internal server error while updating knowledge base entry'
        });
    }
});
// Delete Knowledge Base Entry
router.delete('/knowledgebase/:kbId', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        // Get the businessId from the authenticated user
        const businessId = req.user.businessId;
        const kbId = req.params.kbId;
        // Find the KB entry and verify ownership
        const kbEntry = await db_1.prisma.knowledgeBase.findUnique({
            where: { id: kbId }
        });
        // Check if KB entry exists and belongs to the business
        if (!kbEntry || kbEntry.businessId !== businessId) {
            return res.status(404).json({
                error: 'Knowledge base entry not found or you do not have permission to delete it'
            });
        }
        // Delete the KB entry
        await db_1.prisma.knowledgeBase.delete({
            where: { id: kbId }
        });
        // Send success response with 204 No Content
        res.status(204).send();
    }
    catch (error) {
        console.error('Error deleting knowledge base entry:', error);
        res.status(500).json({
            error: 'Internal server error while deleting knowledge base entry'
        });
    }
});
exports.default = router;
//# sourceMappingURL=admin.js.map