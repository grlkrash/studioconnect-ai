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

// Custom type for authenticated request handlers
type AuthenticatedRequestHandler = (
  req: Request & { user?: UserPayload },
  res: Response,
  next: NextFunction
) => Promise<void>

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

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body
    console.log('LOGIN ATTEMPT:', { email, receivedPassword: password })

    if (!email || !password) {
      console.log('Login failed: Missing email or password in request body.')
      res.status(400).json({ 
        error: 'Email and password are required' 
      })
      return
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { business: true }
    })
    console.log('USER FROM DB:', user ? { ...user, passwordHash: user.passwordHash } : null)

    if (!user || !user.passwordHash) {
      console.log('Login failed: User not found or no password hash for email:', email)
      res.status(401).json({ 
        error: 'Invalid email or password' 
      })
      return
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
      res.status(401).json({ 
        error: 'Invalid email or password' 
      })
      return
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
    res.status(200).json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        role: user.role
      }
    });
    return;

  } catch (error) {
    console.error('ERROR IN LOGIN ROUTE:', error)
    res.status(500).json({ 
      error: 'Internal server error during login' 
    });
    return;
  }
})

// NEW: Add a protected /me route
router.get('/me', authMiddleware, (req: Request, res: Response): void => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication failed or user details not found on request.' })
    return
  }
  res.status(200).json({ currentUser: req.user })
  return
})

// Get Agent Configuration
router.get('/config', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    // Get the businessId from the authenticated user
    const businessId = req.user!.businessId // Non-null assertion is fine after authMiddleware

    // Find the configuration for this business
    const config = await prisma.agentConfig.findUnique({
      where: { businessId }
    })

    // Check if configuration exists
    if (config) {
      res.status(200).json(config)
      return;
    } else {
      res.status(404).json({ 
        error: 'Configuration not found. Please create one.' 
      });
      return;
    }

  } catch (error) {
    console.error('Error fetching agent configuration:', error)
    res.status(500).json({ error: 'Internal server error' })
    return;
  }
})

// Create/Update Agent Configuration
router.post('/config', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    // Get the businessId from the authenticated user
    const businessId = req.user!.businessId

    // Fetch business to check plan tier
    const business = await prisma.business.findUnique({
      where: { id: businessId }
    })

    if (!business) {
      res.status(404).json({ 
        error: 'Business not found' 
      })
      return
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
      res.status(400).json({ 
        error: 'Missing required fields: agentName, personaPrompt, and welcomeMessage are required' 
      })
      return
    }

    // Validate OpenAI voice for PRO plan businesses
    if (business.planTier === 'PRO' && openaiVoice) {
      const validVoices = ['ALLOY', 'ECHO', 'FABLE', 'ONYX', 'NOVA', 'SHIMMER']
      const normalizedVoice = openaiVoice.toUpperCase()
      if (!validVoices.includes(normalizedVoice)) {
        res.status(400).json({ 
          error: `Invalid OpenAI voice. Must be one of: ${validVoices.join(', ')}` 
        })
        return
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
    res.status(200).json(config)

  } catch (error) {
    console.error('Error creating/updating agent configuration:', error)
    res.status(500).json({ 
      error: 'Internal server error while saving configuration' 
    })
  }
})

// Get Lead Capture Questions for Agent Configuration
router.get('/config/questions', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    // Get the businessId from the authenticated user
    const businessId = req.user!.businessId

    // Find the agent configuration for this business
    const agentConfig = await prisma.agentConfig.findUnique({
      where: { businessId }
    })

    // Check if agent configuration exists
    if (!agentConfig) {
      res.status(404).json({ 
        error: 'Agent configuration not found for this business. Please create one first.' 
      })
      return
    }

    // Fetch all lead capture questions for this configuration
    const questions = await prisma.leadCaptureQuestion.findMany({
      where: { configId: agentConfig.id },
      orderBy: { order: 'asc' }
    })

    // Send back the questions array (empty array if no questions exist)
    res.status(200).json(questions)

  } catch (error) {
    console.error('Error fetching lead capture questions:', error)
    res.status(500).json({ 
      error: 'Internal server error while fetching lead capture questions' 
    })
  }
})

// Create New Lead Capture Question
router.post('/config/questions', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    // Get the businessId from the authenticated user
    const businessId = req.user!.businessId

    // Extract question details from request body
    const { questionText, expectedFormat, order, mapsToLeadField, isEssentialForEmergency } = req.body

    // Basic validation
    if (!questionText || order === undefined || order === null) {
      res.status(400).json({ 
        error: 'Missing required fields: questionText and order are required' 
      })
      return
    }

    // Validate expectedFormat against allowed values
    const validFormats = ['TEXT', 'EMAIL', 'PHONE']
    if (expectedFormat && !validFormats.includes(expectedFormat)) {
      res.status(400).json({ 
        error: `Invalid expectedFormat. Must be one of: ${validFormats.join(', ')}` 
      })
      return
    }

    // Find the agent configuration for this business
    const agentConfig = await prisma.agentConfig.findUnique({
      where: { businessId }
    })

    // Check if agent configuration exists
    if (!agentConfig) {
      res.status(404).json({ 
        error: 'Agent configuration must exist before adding questions. Please create one first.' 
      })
      return
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
    res.status(201).json(newQuestion)
    return
  } catch (error) {
    console.error('Error creating lead capture question:', error)
    
    // Check for specific Prisma errors
    if (error instanceof Error) {
      // Handle unique constraint violation (e.g., duplicate order number)
      if (error.message.includes('Unique constraint')) {
        res.status(400).json({ 
          error: 'A question with this order number already exists for this configuration' 
        })
        return
      }
    }
    
    res.status(500).json({ error: 'Internal server error while creating lead capture question' })
    return
  }
})

// Update Lead Capture Question
router.put('/config/questions/:questionId', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    // Get the businessId from the authenticated user
    const businessId = req.user!.businessId
    const questionId = req.params.questionId

    // Extract question details from request body
    const { questionText, expectedFormat, order, mapsToLeadField, isEssentialForEmergency } = req.body

    // Basic validation
    if (!questionText || order === undefined || order === null) {
      res.status(400).json({ 
        error: 'Missing required fields: questionText and order are required' 
      })
      return
    }

    // Validate expectedFormat against allowed values
    const validFormats = ['TEXT', 'EMAIL', 'PHONE']
    if (expectedFormat && !validFormats.includes(expectedFormat)) {
      res.status(400).json({ 
        error: `Invalid expectedFormat. Must be one of: ${validFormats.join(', ')}` 
      })
      return
    }

    // Find the question and verify ownership
    const question = await prisma.leadCaptureQuestion.findUnique({
      where: { id: questionId },
      include: { config: true }
    })

    // Check if question exists and belongs to the business
    if (!question || question.config.businessId !== businessId) {
      res.status(404).json({ 
        error: 'Question not found or you do not have permission to modify it' 
      })
      return
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
    res.status(200).json(updatedQuestion)

  } catch (error) {
    console.error('Error updating lead capture question:', error)
    
    // Check for specific Prisma errors
    if (error instanceof Error) {
      // Handle unique constraint violation (e.g., duplicate order number)
      if (error.message.includes('Unique constraint')) {
        res.status(400).json({ 
          error: 'A question with this order number already exists for this configuration' 
        })
        return
      }
    }
    
    res.status(500).json({ 
      error: 'Internal server error while updating lead capture question' 
    })
  }
})

// Delete Lead Capture Question
router.delete('/config/questions/:questionId', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
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
      res.status(404).json({ 
        error: 'Question not found or you do not have permission to delete it' 
      })
      return
    }

    // Delete the question
    await prisma.leadCaptureQuestion.delete({
      where: { id: questionId }
    })

    // Send success response
    res.status(204).send()

  } catch (error) {
    console.error('Error deleting lead capture question:', error)
    res.status(500).json({ 
      error: 'Internal server error while deleting lead capture question' 
    })
  }
})

// Get Business Notification Settings
router.get('/business/notifications', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
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
      res.status(404).json({ error: 'Business not found' })
      return
    }

    // Send back the business notification settings
    res.status(200).json(business)
    return;

  } catch (error) {
    console.error('Error fetching business notification settings:', error)
    res.status(500).json({ error: 'Internal server error while fetching notification settings' })
    return;
  }
})

// Update Business Notification Settings
router.put('/business/notifications', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    // Get the businessId from the authenticated user
    const businessId = req.user!.businessId

    // Extract notification settings from request body
    const { notificationEmail, notificationPhoneNumber } = req.body

    // Basic validation for email format
    if (notificationEmail && notificationEmail.trim() !== '') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(notificationEmail.trim())) {
        res.status(400).json({ error: 'Invalid email format' })
        return
      }
    }

    // Basic validation for phone number format (allow various formats)
    if (notificationPhoneNumber && notificationPhoneNumber.trim() !== '') {
      const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/
      const cleanedPhone = notificationPhoneNumber.replace(/[\s\-\(\)\.]/g, '')
      if (!phoneRegex.test(cleanedPhone)) {
        res.status(400).json({ error: 'Invalid phone number format. Please use digits only with optional country code.' })
        return
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
    res.status(200).json(updatedBusiness)

  } catch (error) {
    console.error('Error updating business notification settings:', error)
    res.status(500).json({ error: 'Internal server error while updating notification settings' })
  }
})

// Get All Clients for the Business
router.get('/clients', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    // Get the businessId from the authenticated user
    const businessId = req.user!.businessId

    // Fetch all clients for this business
    // Order by createdAt descending (newest first)
    const clients = await prisma.client.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' }
    })

    // Send back the clients array (empty array if no clients exist yet)
    res.status(200).json(clients); return;

  } catch (error) {
    console.error('Error fetching clients:', error)
    res.status(500).json({ 
      error: 'Internal server error while fetching clients' 
    }); return;
  }
})

// Create New Client
router.post('/clients', validateRequest(clientSchema), authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, phone, externalId } = req.body
    
    if (!name) {
      res.status(400).json({ error: 'Client name is required' }); return;
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
    res.status(201).json(client); return;
  } catch (error) {
    console.error('Error creating client:', error)
    res.status(500).json({ error: 'Failed to create client' }); return;
  }
})

// Update Client
router.put('/clients/:clientId', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }
    const { clientId } = req.params;
    const parsedData = clientSchema.safeParse(req.body);

    if (!parsedData.success) {
      res.status(400).json({ error: parsedData.error.errors }); return;
    }
    const data = parsedData.data;

    const client = await prisma.client.update({
      where: { 
        id: clientId as string,
        businessId: req.user.businessId
      },
      data
    })
    res.json(client); return;
  } catch (error) {
    console.error('Error updating client:', error);
    res.status(500).json({ error: 'Failed to update client' }); return;
  }
})

// Delete Client
router.delete('/clients/:clientId', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }
    const { clientId } = req.params;
    await prisma.client.delete({
      where: { 
        id: clientId as string,
        businessId: req.user.businessId
      }
    })
    res.status(204).send(); return;
  } catch (error) {
    console.error('Error deleting client:', error);
    res.status(500).json({ error: 'Failed to delete client' }); return;
  }
})

// Project Management Routes (Enterprise only)
router.get('/projects', authMiddleware, requirePlan('ENTERPRISE'), async (req: Request, res: Response): Promise<void> => {
  try {
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
    res.json(projects);
    return;
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
    return;
  }
});

router.post(
  '/projects',
  validateRequest(projectSchema),
  authMiddleware,
  requirePlan('ENTERPRISE'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!isAuthenticatedRequest(req)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { name, status, clientId, details, externalId } = req.body;

      if (!name || !status || !clientId) {
        res.status(400).json({ error: 'Project name, status, and client ID are required' });
        return;
      }

      const clientExists = await prisma.client.findFirst({
        where: { 
          id: clientId,
          businessId: req.user.businessId
        }
      });

      if (!clientExists) {
        res.status(400).json({ error: 'Invalid client ID for this business' });
        return;
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
      res.status(201).json(project);
      return;
    } catch (error) {
      console.error('Error creating project:', error);
      res.status(500).json({ error: 'Failed to create project' });
      return;
    }
  }
);

router.get(
  '/projects/:projectId',
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!isAuthenticatedRequest(req)) {
        res.status(401).json({ error: 'Unauthorized' })
        return
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
        res.status(404).json({ error: 'Project not found' }); return;
      }

      res.json(project); return;
    } catch (error) {
      console.error('Error fetching project:', error)
      res.status(500).json({ error: 'Failed to fetch project' }); return;
    }
  }
)

router.put(
  '/projects/:projectId',
  authMiddleware,
  requirePlan('ENTERPRISE'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!isAuthenticatedRequest(req)) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }

      const { projectId } = req.params
      const { name, status, clientId, details, externalId } = req.body

      if (!name || !status || !clientId) {
        res.status(400).json({ error: 'Project name, status, and client ID are required' }); return;
      }

      // Verify client exists for the business
      const clientExists = await prisma.client.findFirst({
        where: { 
          id: clientId,
          businessId: req.user.businessId
        }
      })

      if (!clientExists) {
        res.status(400).json({ error: 'Invalid client ID for this business' }); return;
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
      res.json(project); return;
    } catch (error) {
      console.error('Error updating project:', error)
      res.status(500).json({ error: 'Failed to update project' }); return;
    }
  }
)

router.delete(
  '/projects/:projectId',
  authMiddleware,
  requirePlan('ENTERPRISE'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!isAuthenticatedRequest(req)) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }

      const { projectId } = req.params
      await prisma.project.delete({
        where: { 
          id: projectId,
          businessId: req.user.businessId
        }
      })
      res.status(204).send(); return;
    } catch (error) {
      console.error('Error deleting project:', error)
      res.status(500).json({ error: 'Failed to delete project' }); return;
    }
  }
)

// Integration Management Routes (Enterprise only)
router.get(
  '/integrations',
  authMiddleware,
  requirePlan('ENTERPRISE'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!isAuthenticatedRequest(req)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const integrations = await prisma.integration.findMany({
        where: { businessId: req.user.businessId }
      });
      res.json(integrations);
      return;
    } catch (error) {
      console.error('Error fetching integrations:', error);
      res.status(500).json({ error: 'Failed to fetch integrations' });
      return;
    }
  }
);

router.post(
  '/integrations',
  authMiddleware,
  requirePlan('ENTERPRISE'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!isAuthenticatedRequest(req)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { type, apiKey, webhookSecret, settings } = req.body;

      if (!type || !apiKey) {
        res.status(400).json({ error: 'Integration type and API key are required' });
        return;
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
      res.status(201).json(integration);
      return;
    } catch (error) {
      console.error('Error creating integration:', error);
      res.status(500).json({ error: 'Failed to create integration' });
      return;
    }
  }
);

router.put(
  '/integrations/:integrationId',
  authMiddleware,
  requirePlan('ENTERPRISE'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!isAuthenticatedRequest(req)) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }

      const { integrationId } = req.params
      const { type, apiKey, webhookSecret, config, isEnabled } = req.body

      // Validate integration type if provided
      if (type) {
        const validTypes = ['ASANA', 'JIRA', 'TRELLO', 'GOOGLE_SHEETS']
        if (!validTypes.includes(type)) {
          res.status(400).json({ 
            error: `Invalid integration type. Must be one of: ${validTypes.join(', ')}` 
          }); return;
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
      res.json(integration); return;
    } catch (error) {
      console.error('Error updating integration:', error);
      res.status(500).json({ error: 'Failed to update integration' }); return;
    }
  }
)

router.delete(
  '/integrations/:integrationId',
  authMiddleware,
  requirePlan('ENTERPRISE'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!isAuthenticatedRequest(req)) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }

      const { integrationId } = req.params
      await prisma.integration.delete({
        where: { id: integrationId }
      })
      res.status(204).end(); return;
    } catch (error) {
      console.error('Error deleting integration:', error)
      res.status(500).json({ error: 'Failed to delete integration' })
    }
  }
)

// Manual sync trigger (Enterprise only)
router.post(
  '/integrations/sync-now',
  authMiddleware,
  requirePlan('ENTERPRISE'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!isAuthenticatedRequest(req)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { integrationId } = req.query;
      
      const integration = await prisma.integration.findUnique({
        where: { id: integrationId as string }
      });
      
      if (!integration) {
        res.status(404).json({ error: 'Integration not found' });
        return;
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
          res.status(400).json({ error: `Unsupported integration type: ${integration.type}` });
          return;
      }
      
      res.json({ message: 'Sync initiated successfully' });
      return;
    } catch (error) {
      console.error('Sync error:', error);
      res.status(500).json({ error: 'Failed to initiate sync' });
      return;
    }
  }
);

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
router.get('/business', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const business = await prisma.business.findUnique({
      where: { id: req.user!.businessId },
      include: {
        users: true,
        agentConfig: true
      }
    });
    res.json(business);
    return;
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch business' });
    return;
  }
});

router.put('/business', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    if (!isAuthenticatedRequest(req)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { name, planTier } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Business name is required' });
      return;
    }

    const business = await prisma.business.update({
      where: { id: req.user.businessId },
      data: { name, planTier }
    });
    res.json(business);
    return;
  } catch (error) {
    res.status(500).json({ error: 'Failed to update business' });
    return;
  }
});

// User Management Routes
router.get('/users', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      where: { businessId: req.user!.businessId }
    });
    res.json(users);
    return;
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
    return;
  }
});

router.post('/users', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    if (!isAuthenticatedRequest(req)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { email, role, password } = req.body;

    if (!email || !role || !password) {
      res.status(400).json({ error: 'Email, role, and password are required' });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({ error: 'Invalid email format' });
      return;
    }

    const validRoles = ['ADMIN', 'USER'];
    if (!validRoles.includes(role)) {
      res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
      return;
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      res.status(400).json({ error: 'User with this email already exists' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        role,
        businessId: req.user.businessId,
        passwordHash
      }
    });
    res.status(201).json(user);
    return;
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Failed to create user' });
    return;
  }
});

// Get All Knowledge Base Entries for the Business
router.get('/knowledgebase', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const entries = await prisma.knowledgeBase.findMany({
      where: { businessId: req.user!.businessId },
      orderBy: { createdAt: 'desc' }
    });
    res.json(entries);
    return;
  } catch (error) {
    console.error('Error fetching knowledge base entries:', error);
    res.status(500).json({ error: 'Internal server error while fetching knowledge base entries' });
    return;
  }
})

// Create New Knowledge Base Entry
router.post('/knowledgebase', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const businessId = req.user!.businessId;
    const { content, sourceURL } = req.body;

    if (!content || content.trim() === '') {
      res.status(400).json({ error: 'Content is required and cannot be empty' });
      return;
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

    res.status(201).json(newKnowledgeEntry);
    return;
  } catch (error) {
    console.error('Error creating knowledge base entry:', error);
    res.status(500).json({ error: 'Internal server error while creating knowledge base entry' });
    return;
  }
})

// Update Knowledge Base Entry
router.put('/knowledgebase/:kbId', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const businessId = req.user!.businessId;
    const kbId = req.params.kbId;
    const { content, sourceURL } = req.body;

    if (content !== undefined && content.trim() === '') {
      res.status(400).json({ error: 'Content cannot be empty if provided' });
      return;
    }

    const kbEntry = await prisma.knowledgeBase.findUnique({
      where: { id: kbId }
    });

    if (!kbEntry || kbEntry.businessId !== businessId) {
      res.status(404).json({ error: 'Knowledge base entry not found or you do not have permission to modify it' });
      return;
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

    res.status(200).json(updatedKbEntry);
    return;
  } catch (error) {
    console.error('Error updating knowledge base entry:', error);
    res.status(500).json({ error: 'Internal server error while updating knowledge base entry' });
    return;
  }
})

// Delete Knowledge Base Entry
router.delete('/knowledgebase/:kbId', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const kbId = req.params.kbId;
    const kbEntry = await prisma.knowledgeBase.findUnique({
      where: { id: kbId }
    });

    if (!kbEntry || kbEntry.businessId !== req.user!.businessId) {
      res.status(404).json({ error: 'Knowledge base entry not found or you do not have permission to delete it' });
      return;
    }

    await prisma.knowledgeBase.delete({
      where: { id: kbId }
    });

    res.status(204).send();
    return;
  } catch (error) {
    console.error('Error deleting knowledge base entry:', error);
    res.status(500).json({ error: 'Internal server error while deleting knowledge base entry' });
    return;
  }
})

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

export default router 