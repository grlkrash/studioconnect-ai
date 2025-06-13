import { Router, Request, Response, RequestHandler, NextFunction } from 'express'
import bcrypt from 'bcrypt'
import jsonwebtoken from 'jsonwebtoken'
import { prisma } from '../services/db'
import { authMiddleware, UserPayload, isAuthenticatedRequest } from './authMiddleware'
import { requirePlan } from '../middleware/planMiddleware'
import { validateRequest } from '../middleware/validateRequest'
import { generateAndStoreEmbedding } from '../core/ragService'
import { NextApiRequest, NextApiResponse } from 'next'
import { getSession } from 'next-auth/react'
import { PrismaClient, Client, Project, Integration, PlanTier, Prisma } from '@prisma/client'
import { z } from 'zod'
import { createRouter } from 'next-connect'
import { ParsedQs } from 'qs'
import { ParamsDictionary } from 'express-serve-static-core'
import { asyncHandler } from '../utils/asyncHandler'
import { sendTestEmail, sendLeadNotificationEmail } from '../services/notificationService'

// Custom type for authenticated request handlers
type AuthenticatedRequestHandler = (
  req: Request & { user?: UserPayload },
  res: Response,
  next: NextFunction
) => Promise<Response | void>

const router = Router()

const clientSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  externalId: z.string().optional(),
  businessId: z.string()
})

const projectSchema = z.object({
  name: z.string().min(1),
  status: z.enum(['NEW', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD']),
  details: z.string().optional(),
  clientId: z.string(),
  businessId: z.string(),
  externalId: z.string().optional()
})

const integrationSchema = z.object({
  type: z.string(),
  apiKey: z.string().optional(),
  webhookSecret: z.string().optional(),
  config: z.record(z.unknown()).optional(),
  isEnabled: z.boolean().optional(),
  businessId: z.string()
})

// Update the session type to include businessId
interface Session {
  user: {
    id: string
    businessId: string
    name?: string | null
    email?: string | null
    image?: string | null
  }
}

// Update project includes
const projectInclude = {
  client: true,
  tasks: true,
  integrations: true,
} as const

router.post('/login', asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body
  console.log('LOGIN ATTEMPT:', { email, receivedPassword: password })

  if (!email || !password) {
    console.log('Login failed: Missing email or password in request body.')
    return res.status(400).json({ 
      error: 'Email and password are required' 
    })
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: { business: true }
  })
  console.log('USER FROM DB:', user ? { ...user, passwordHash: user.passwordHash } : null)

  if (!user || !user.passwordHash) {
    console.log('Login failed: User not found or no password hash for email:', email)
    return res.status(401).json({ 
      error: 'Invalid email or password' 
    })
  }

  // **NEW DETAILED LOGS FOR BCRYPT.COMPARE**
  console.log(`Plaintext password received for bcrypt: "${password}" (length: ${password.length})`)
  console.log(`Stored hash for bcrypt: "${user.passwordHash}" (length: ${user.passwordHash.length})`)

  const passwordMatch = await bcrypt.compare(password, user.passwordHash)
  console.log('PASSWORD MATCH RESULT from bcrypt.compare:', passwordMatch)

  // **EXTRA TEST: Hardcoded comparison (for sanity check)**
  const hardcodedPlainText = "password123"
  const hardcodedHashFromDB = "$2b$10$KFX9Z5vG1ONvZ3pL7dZ8A.J0sU84w6KzSBc.gYmY0kDoN9S3NqU/S"
  if (user.passwordHash === hardcodedHashFromDB) {
      const hardcodedMatchTest = await bcrypt.compare(hardcodedPlainText, hardcodedHashFromDB)
      console.log('HARDCODED bcrypt.compare("password123", known_hash_for_password123) RESULT:', hardcodedMatchTest)
  } else {
      console.log('Stored hash in DB does NOT match the known_hash_for_password123. This is a data entry problem in Prisma Studio.')
  }

  if (!passwordMatch) {
    console.log('Login failed: Password did not match for user:', email)
    return res.status(401).json({ 
      error: 'Invalid email or password' 
    })
  }

  // Authentication successful
  console.log('AUTHENTICATION SUCCESSFUL for user:', email)

  // Create JWT payload
  const payload = {
    userId: user.id,
    businessId: user.businessId,
    role: user.role
  }
  console.log('TOKEN PAYLOAD:', payload)

  // Sign the token
  const token = jsonwebtoken.sign(
    payload,
    process.env.JWT_SECRET!,
    { expiresIn: '7d' }
  )

  // Set HTTP-only cookie
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
  })

  console.log('Token cookie set. Sending success response.')
  
  // Send success response
  return res.status(200).json({
    message: 'Login successful',
    user: {
      id: user.id,
      email: user.email,
      role: user.role
    }
  })
}))

// NEW: Add a protected /me route
router.get('/me', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication failed or user details not found on request.' })
  }
  return res.status(200).json({ currentUser: req.user })
}))

// Get Agent Configuration
router.get('/config', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  // Get the businessId from the authenticated user
  const businessId = req.user!.businessId // Non-null assertion is fine after authMiddleware

  // Find the configuration for this business
  const config = await prisma.agentConfig.findUnique({
    where: { businessId }
  })

  // Check if configuration exists
  if (config) {
    return res.status(200).json(config)
  } else {
    return res.status(404).json({ 
      error: 'Configuration not found. Please create one.' 
    })
  }
}))

// Create/Update Agent Configuration
router.post('/config', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  // Get the businessId from the authenticated user
  const businessId = req.user!.businessId

  // Fetch business to check plan tier
  const business = await prisma.business.findUnique({
    where: { id: businessId }
  })

  if (!business) {
    return res.status(404).json({ 
      error: 'Business not found' 
    })
  }

  // Extract configuration details from request body
  const { 
    agentName, 
    personaPrompt, 
    welcomeMessage, 
    leadCaptureCompletionMessage, 
    colorTheme,
    voiceGreetingMessage,
    voiceCompletionMessage,
    voiceEmergencyMessage,
    voiceEndCallMessage,
    useOpenaiTts,
    openaiVoice,
    openaiModel
  } = req.body

  // Basic validation
  if (!agentName || !personaPrompt || !welcomeMessage) {
    return res.status(400).json({ 
      error: 'Missing required fields: agentName, personaPrompt, and welcomeMessage are required' 
    })
  }

  // Validate OpenAI voice for PRO plan businesses
  if (business.planTier === 'PRO' && openaiVoice) {
    const validVoices = ['ALLOY', 'ECHO', 'FABLE', 'ONYX', 'NOVA', 'SHIMMER']
    const normalizedVoice = openaiVoice.toUpperCase()
    if (!validVoices.includes(normalizedVoice)) {
      return res.status(400).json({ 
        error: `Invalid OpenAI voice. Must be one of: ${validVoices.join(', ')}` 
      })
    }
  }

  // Prepare base config data
  const baseConfigData = {
    agentName,
    personaPrompt,
    welcomeMessage,
    leadCaptureCompletionMessage,
    colorTheme: colorTheme || {}
  }

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
    : baseConfigData

  // Upsert the configuration
  const config = await prisma.agentConfig.upsert({
    where: { businessId },
    create: {
      businessId,
      ...configData
    },
    update: configData
  })

  // Send back the created or updated configuration
  return res.status(200).json(config)
}))

// Get Lead Capture Questions for Agent Configuration
router.get('/config/questions', authMiddleware, asyncHandler(async (req: Request, res: Response): Promise<Response> => {
  // Get the businessId from the authenticated user
  const businessId = req.user!.businessId

  // Find the agent configuration for this business
  const agentConfig = await prisma.agentConfig.findUnique({
    where: { businessId }
  })

  // Check if agent configuration exists
  if (!agentConfig) {
    return res.status(404).json({ 
      error: 'Agent configuration not found for this business. Please create one first.' 
    })
  }

  // Fetch all lead capture questions for this configuration
  const questions = await prisma.leadCaptureQuestion.findMany({
    where: { configId: agentConfig.id },
    orderBy: { order: 'asc' }
  })

  // Send back the questions array (empty array if no questions exist)
  return res.status(200).json(questions)
}))

// Create New Lead Capture Question
router.post('/config/questions', authMiddleware, asyncHandler(async (req: Request, res: Response): Promise<Response> => {
  // Get the businessId from the authenticated user
  const businessId = req.user!.businessId

  // Extract question details from request body
  const { questionText, expectedFormat, order, mapsToLeadField, isEssentialForEmergency } = req.body

  // Basic validation
  if (!questionText || order === undefined || order === null) {
    return res.status(400).json({ 
      error: 'Missing required fields: questionText and order are required' 
    })
  }

  // Validate expectedFormat against allowed values
  const validFormats = ['TEXT', 'EMAIL', 'PHONE']
  if (expectedFormat && !validFormats.includes(expectedFormat)) {
    return res.status(400).json({ 
      error: `Invalid expectedFormat. Must be one of: ${validFormats.join(', ')}` 
    })
  }

  // Find the agent configuration for this business
  const agentConfig = await prisma.agentConfig.findUnique({
    where: { businessId }
  })

  // Check if agent configuration exists
  if (!agentConfig) {
    return res.status(404).json({ 
      error: 'Agent configuration must exist before adding questions. Please create one first.' 
    })
  }

  // Create the new lead capture question
  const newQuestion = await prisma.leadCaptureQuestion.create({
    data: {
      questionText,
      expectedFormat: expectedFormat || 'TEXT', // Default to TEXT if not provided
      order: Number(order), // Ensure order is a number
      mapsToLeadField: mapsToLeadField || null,
      isEssentialForEmergency: Boolean(isEssentialForEmergency), // Convert to boolean, default false
      configId: agentConfig.id
    }
  })

  // Send back the newly created question with 201 status
  return res.status(201).json(newQuestion)
}))

// Update Lead Capture Question
router.put('/config/questions/:questionId', authMiddleware, asyncHandler(async (req: Request, res: Response): Promise<Response> => {
  // Get the businessId from the authenticated user
  const businessId = req.user!.businessId
  const questionId = req.params.questionId

  // Extract question details from request body
  const { questionText, expectedFormat, order, mapsToLeadField, isEssentialForEmergency } = req.body

  // Basic validation
  if (!questionText || order === undefined || order === null) {
    return res.status(400).json({ 
      error: 'Missing required fields: questionText and order are required' 
    })
  }

  // Validate expectedFormat against allowed values
  const validFormats = ['TEXT', 'EMAIL', 'PHONE']
  if (expectedFormat && !validFormats.includes(expectedFormat)) {
    return res.status(400).json({ 
      error: `Invalid expectedFormat. Must be one of: ${validFormats.join(', ')}` 
    })
  }

  // Find the question and verify ownership
  const question = await prisma.leadCaptureQuestion.findUnique({
    where: { id: questionId },
    include: { config: true }
  })

  // Check if question exists and belongs to the business
  if (!question || question.config.businessId !== businessId) {
    return res.status(404).json({ 
      error: 'Question not found or you do not have permission to modify it' 
    })
  }

  // Update the question
  const updatedQuestion = await prisma.leadCaptureQuestion.update({
    where: { id: questionId },
    data: {
      questionText,
      expectedFormat: expectedFormat || 'TEXT',
      order: Number(order),
      mapsToLeadField: mapsToLeadField || null,
      isEssentialForEmergency: Boolean(isEssentialForEmergency) // Convert to boolean
    }
  })

  // Send back the updated question
  return res.status(200).json(updatedQuestion)
}))

// Delete Lead Capture Question
router.delete('/config/questions/:questionId', authMiddleware, asyncHandler(async (req: Request, res: Response): Promise<Response> => {
  // Get the businessId from the authenticated user
  const businessId = req.user!.businessId
  const questionId = req.params.questionId

  // Find the question and verify ownership
  const question = await prisma.leadCaptureQuestion.findUnique({
    where: { id: questionId },
    include: { config: true }
  })

  // Check if question exists and belongs to the business
  if (!question || question.config.businessId !== businessId) {
    return res.status(404).json({ 
      error: 'Question not found or you do not have permission to delete it' 
    })
  }

  // Delete the question
  await prisma.leadCaptureQuestion.delete({
    where: { id: questionId }
  })

  // Send success response
  return res.status(204).send()
}))

// Get Business Notification Settings
router.get('/business/notifications', authMiddleware, asyncHandler(async (req: Request, res: Response): Promise<Response> => {
  // Get the businessId from the authenticated user
  const businessId = req.user!.businessId

  // Fetch business notification settings
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      name: true,
      notificationEmail: true,
      notificationPhoneNumber: true,
      planTier: true
    }
  })

  if (!business) {
    return res.status(404).json({ error: 'Business not found' })
  }

  // Send back the business notification settings
  return res.status(200).json(business)
}))

// Update Business Notification Settings
router.put('/business/notifications', authMiddleware, asyncHandler(async (req: Request, res: Response): Promise<Response> => {
  // Get the businessId from the authenticated user
  const businessId = req.user!.businessId

  // Extract notification settings from request body
  const { notificationEmail, notificationPhoneNumber } = req.body

  // Basic validation for email format
  if (notificationEmail && notificationEmail.trim() !== '') {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(notificationEmail.trim())) {
      return res.status(400).json({ error: 'Invalid email format' })
    }
  }

  // Basic validation for phone number format (allow various formats)
  if (notificationPhoneNumber && notificationPhoneNumber.trim() !== '') {
    const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/
    const cleanedPhone = notificationPhoneNumber.replace(/[\s\-\(\)\.]/g, '')
    if (!phoneRegex.test(cleanedPhone)) {
      return res.status(400).json({ error: 'Invalid phone number format. Please use digits only with optional country code.' })
    }
  }

  // Update the business notification settings
  const updatedBusiness = await prisma.business.update({
    where: { id: businessId },
    data: {
      notificationEmail: notificationEmail?.trim() || null,
      notificationPhoneNumber: notificationPhoneNumber?.trim() || null
    },
    select: {
      id: true,
      name: true,
      notificationEmail: true,
      notificationPhoneNumber: true,
      planTier: true
    }
  })

  // Send back the updated business settings
  return res.status(200).json(updatedBusiness)
}))

// Get All Clients for the Business
router.get('/clients', authMiddleware, asyncHandler(async (req: Request, res: Response): Promise<Response> => {
  // Get the businessId from the authenticated user
  const businessId = req.user!.businessId

  // Fetch all clients for this business
  // Order by createdAt descending (newest first)
  const clients = await prisma.client.findMany({
    where: { businessId },
    orderBy: { createdAt: 'desc' }
  })

  // Send back the clients array (empty array if no clients exist yet)
  return res.status(200).json(clients)
}))

// Create New Client
router.post('/clients', validateRequest(clientSchema), authMiddleware, asyncHandler(async (req: Request, res: Response): Promise<Response> => {
  const { name, email, phone, externalId } = req.body
  
  if (!name) {
    return res.status(400).json({ error: 'Client name is required' })
  }

  const client = await prisma.client.create({
    data: {
      name,
      email,
      phone,
      externalId,
      businessId: req.user!.businessId
    }
  })
  return res.status(201).json(client)
}))

// Update Client
router.put('/clients/:clientId', authMiddleware, asyncHandler(async (req: Request, res: Response): Promise<Response> => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const { clientId } = req.params;
  const parsedData = clientSchema.safeParse(req.body);

  if (!parsedData.success) {
    return res.status(400).json({ error: parsedData.error.errors })
  }
  const data = parsedData.data;

  const client = await prisma.client.update({
    where: { 
      id: clientId as string,
      businessId: req.user.businessId
    },
    data
  })
  return res.json(client)
}))

// Delete Client
router.delete('/clients/:clientId', authMiddleware, asyncHandler(async (req: Request, res: Response): Promise<Response> => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const { clientId } = req.params;
  await prisma.client.delete({
    where: { 
      id: clientId as string,
      businessId: req.user.businessId
    }
  })
  return res.status(204).send()
}))

// Project Management Routes (Enterprise only)
router.get('/projects', authMiddleware, requirePlan('ENTERPRISE'), asyncHandler(async (req: Request, res: Response): Promise<Response> => {
  const { clientId } = req.query;
  const projects = await prisma.project.findMany({
    where: {
      businessId: req.user!.businessId,
      ...(clientId && { clientId: clientId as string })
    },
    include: {
      client: true
    }
  });
  return res.json(projects)
}))

router.post(
  '/projects',
  validateRequest(projectSchema),
  authMiddleware,
  requirePlan('ENTERPRISE'),
  asyncHandler(async (req: Request, res: Response): Promise<Response> => {
    if (!isAuthenticatedRequest(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { name, status, clientId, details, externalId } = req.body;

    if (!name || !status || !clientId) {
      return res.status(400).json({ error: 'Project name, status, and client ID are required' });
    }

    const clientExists = await prisma.client.findFirst({
      where: { 
        id: clientId,
        businessId: req.user.businessId
      }
    });

    if (!clientExists) {
      return res.status(400).json({ error: 'Invalid client ID for this business' });
    }

    const project = await prisma.project.create({
      data: {
        name,
        status,
        details,
        externalId,
        clientId,
        businessId: req.user.businessId
      },
      include: {
        client: true
      }
    });
    return res.status(201).json(project);
  })
)

router.get(
  '/projects/:projectId',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response): Promise<Response> => {
    if (!isAuthenticatedRequest(req)) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { projectId } = req.params
    const project = await prisma.project.findFirst({
      where: { 
        id: projectId,
        businessId: req.user.businessId
      },
      include: {
        client: true
      }
    })

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    return res.json(project);
  })
)

router.put(
  '/projects/:projectId',
  authMiddleware,
  requirePlan('ENTERPRISE'),
  asyncHandler(async (req: Request, res: Response): Promise<Response> => {
    if (!isAuthenticatedRequest(req)) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { projectId } = req.params
    const { name, status, clientId, details, externalId } = req.body

    if (!name || !status || !clientId) {
      return res.status(400).json({ error: 'Project name, status, and client ID are required' });
    }

    // Verify client exists for the business
    const clientExists = await prisma.client.findFirst({
      where: { 
        id: clientId,
        businessId: req.user.businessId
      }
    })

    if (!clientExists) {
      return res.status(400).json({ error: 'Invalid client ID for this business' });
    }

    const project = await prisma.project.update({
      where: { 
        id: projectId,
        businessId: req.user.businessId
      },
      data: {
        name,
        status,
        details,
        externalId,
        clientId
      },
      include: {
        client: true
      }
    })
    return res.json(project);
  })
)

router.delete(
  '/projects/:projectId',
  authMiddleware,
  requirePlan('ENTERPRISE'),
  asyncHandler(async (req: Request, res: Response): Promise<Response> => {
    if (!isAuthenticatedRequest(req)) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { projectId } = req.params
    await prisma.project.delete({
      where: { 
        id: projectId,
        businessId: req.user.businessId
      }
    })
    return res.status(204).send();
  })
)

// Integration Management Routes (Enterprise only)
router.get(
  '/integrations',
  authMiddleware,
  requirePlan('ENTERPRISE'),
  asyncHandler(async (req: Request, res: Response): Promise<Response> => {
    if (!isAuthenticatedRequest(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const integrations = await prisma.integration.findMany({
      where: { businessId: req.user.businessId }
    });
    return res.json(integrations);
  })
)

router.post(
  '/integrations',
  authMiddleware,
  requirePlan('ENTERPRISE'),
  asyncHandler(async (req: Request, res: Response): Promise<Response> => {
    if (!isAuthenticatedRequest(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { type, apiKey, webhookSecret, settings } = req.body;

    if (!type || !apiKey) {
      return res.status(400).json({ error: 'Integration type and API key are required' });
    }

    const integration = await prisma.integration.create({
      data: {
        type,
        apiKey,
        webhookSecret,
        settings,
        businessId: req.user!.businessId
      }
    });
    return res.status(201).json(integration);
  })
)

router.put(
  '/integrations/:integrationId',
  authMiddleware,
  requirePlan('ENTERPRISE'),
  asyncHandler(async (req: Request, res: Response): Promise<Response> => {
    if (!isAuthenticatedRequest(req)) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { integrationId } = req.params
    const { type, apiKey, webhookSecret, config, isEnabled } = req.body

    // Validate integration type if provided
    if (type) {
      const validTypes = ['ASANA', 'JIRA', 'TRELLO', 'GOOGLE_SHEETS']
      if (!validTypes.includes(type)) {
        return res.status(400).json({ 
          error: `Invalid integration type. Must be one of: ${validTypes.join(', ')}` 
        });
      }
    }

    const integration = await prisma.integration.update({
      where: { id: integrationId },
      data: {
        type,
        apiKey,
        webhookSecret,
        isEnabled,
        settings: config ? config : undefined
      }
    })
    return res.json(integration);
  })
)

router.delete(
  '/integrations/:integrationId',
  authMiddleware,
  requirePlan('ENTERPRISE'),
  asyncHandler(async (req: Request, res: Response): Promise<Response> => {
    if (!isAuthenticatedRequest(req)) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { integrationId } = req.params
    await prisma.integration.delete({
      where: { id: integrationId }
    })
    return res.status(204).end();
  })
)

// Manual sync trigger (Enterprise only)
router.post(
  '/integrations/sync-now',
  authMiddleware,
  requirePlan('ENTERPRISE'),
  asyncHandler(async (req: Request, res: Response): Promise<Response> => {
    if (!isAuthenticatedRequest(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { integrationId } = req.query;
    
    const integration = await prisma.integration.findUnique({
      where: { id: integrationId as string }
    });
    
    if (!integration) {
      return res.status(404).json({ error: 'Integration not found' });
    }
    
    switch (integration.type) {
      case 'ASANA':
        await syncAsanaProjects(integration);
        break;
      case 'JIRA':
        await syncJiraProjects(integration);
        break;
      case 'TRELLO':
        await syncTrelloProjects(integration);
        break;
      default:
        return res.status(400).json({ error: `Unsupported integration type: ${integration.type}` });
    }
    
    return res.json({ message: 'Sync initiated successfully' });
  })
)

// Helper functions for sync operations
async function syncAsanaProjects(integration: Integration) {
  // Implement Asana sync logic
  // This would use the Asana API to fetch projects and tasks
  // and update the local database
}

async function syncJiraProjects(integration: Integration) {
  // Implement Jira sync logic
  // This would use the Jira API to fetch projects and issues
  // and update the local database
}

async function syncTrelloProjects(integration: Integration) {
  // Implement Trello sync logic
  // This would use the Trello API to fetch boards and cards
  // and update the local database
}

// Business Management Routes
router.get('/business', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const business = await prisma.business.findUnique({
    where: { id: req.user!.businessId },
    include: {
      users: true,
      agentConfig: true
    }
  })
  return res.json(business)
}))

router.put('/business', authMiddleware, asyncHandler(async (req: Request, res: Response): Promise<Response> => {
  if (!isAuthenticatedRequest(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { name, planTier } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Business name is required' });
  }

  const business = await prisma.business.update({
    where: { id: req.user.businessId },
    data: { name, planTier }
  });
  return res.json(business);
}))

// User Management Routes
router.get('/users', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const users = await prisma.user.findMany({
    where: { businessId: req.user!.businessId }
  })
  return res.json(users)
}))

router.post('/users', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  if (!isAuthenticatedRequest(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { email, role, password } = req.body

  if (!email || !role || !password) {
    return res.status(400).json({ error: 'Email, role, and password are required' })
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' })
  }

  const validRoles = ['ADMIN', 'USER']
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` })
  }

  const existingUser = await prisma.user.findUnique({ where: { email } })
  if (existingUser) {
    return res.status(400).json({ error: 'User with this email already exists' })
  }

  const passwordHash = await bcrypt.hash(password, 10)

  const user = await prisma.user.create({
    data: {
      email,
      role,
      businessId: req.user.businessId,
      passwordHash
    }
  })
  return res.status(201).json(user)
}))

// Get All Knowledge Base Entries for the Business
router.get('/knowledgebase', authMiddleware, asyncHandler(async (req: Request, res: Response): Promise<Response> => {
  const entries = await prisma.knowledgeBase.findMany({
    where: { businessId: req.user!.businessId },
    orderBy: { createdAt: 'desc' }
  });
  return res.json(entries);
}))

// Create New Knowledge Base Entry
router.post('/knowledgebase', authMiddleware, asyncHandler(async (req: Request, res: Response): Promise<Response> => {
  const businessId = req.user!.businessId;
  const { content, sourceURL } = req.body;

  if (!content || content.trim() === '') {
    return res.status(400).json({ error: 'Content is required and cannot be empty' });
  }

  const newKnowledgeEntry = await prisma.knowledgeBase.create({
    data: {
      content,
      sourceURL: sourceURL || null,
      businessId
    }
  });

  try {
    await generateAndStoreEmbedding(newKnowledgeEntry.id);
  } catch (embeddingError) {
    console.error(`Failed to generate embedding for KB entry ${newKnowledgeEntry.id}:`, embeddingError);
  }

  return res.status(201).json(newKnowledgeEntry);
}))

// Update Knowledge Base Entry
router.put('/knowledgebase/:kbId', authMiddleware, asyncHandler(async (req: Request, res: Response): Promise<Response> => {
  const businessId = req.user!.businessId;
  const kbId = req.params.kbId;
  const { content, sourceURL } = req.body;

  if (content !== undefined && content.trim() === '') {
    return res.status(400).json({ error: 'Content cannot be empty if provided' });
  }

  const kbEntry = await prisma.knowledgeBase.findUnique({
    where: { id: kbId }
  });

  if (!kbEntry || kbEntry.businessId !== businessId) {
    return res.status(404).json({ error: 'Knowledge base entry not found or you do not have permission to modify it' });
  }

  const updatedKbEntry = await prisma.knowledgeBase.update({
    where: { id: kbId },
    data: {
      content: content !== undefined ? content : undefined,
      sourceURL: sourceURL !== undefined ? sourceURL : undefined
    }
  });

  if (content !== undefined && updatedKbEntry) {
    try {
      await generateAndStoreEmbedding(updatedKbEntry.id);
    } catch (embedError) {
      console.error(`Error regenerating embedding for KB entry ${updatedKbEntry.id} after update:`, embedError);
    }
  }

  return res.status(200).json(updatedKbEntry);
}))

// Delete Knowledge Base Entry
router.delete('/knowledgebase/:kbId', authMiddleware, asyncHandler(async (req: Request, res: Response): Promise<Response> => {
  const kbId = req.params.kbId;
  const kbEntry = await prisma.knowledgeBase.findUnique({
    where: { id: kbId }
  });

  if (!kbEntry || kbEntry.businessId !== req.user!.businessId) {
    return res.status(404).json({ error: 'Knowledge base entry not found or you do not have permission to delete it' });
  }

  await prisma.knowledgeBase.delete({
    where: { id: kbId }
  });

  return res.status(204).send();
}))

router.get('/logout', (req: Request, res: Response): void => {
  res.cookie('token', '', {
    httpOnly: true,
    expires: new Date(0),
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  });
  res.redirect('/admin/login');
  return;
})

router.post('/test-sendgrid', authMiddleware, asyncHandler(async (req, res) => {
  const { testEmail } = req.body
  
  if (!testEmail || !testEmail.includes('@')) {
    return res.status(400).json({ error: 'Valid test email address required' })
  }

  const result = await sendTestEmail(testEmail)
  
  return res.status(200).json({
    success: true,
    message: 'SendGrid test email sent successfully.',
    result,
  })
}))

export default router 