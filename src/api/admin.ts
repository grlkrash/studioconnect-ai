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
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' })
    return
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: { business: true }
  })

  if (!user || !user.passwordHash) {
    res.status(401).json({ error: 'Invalid email or password' })
    return
  }

  const passwordMatch = await bcrypt.compare(password, user.passwordHash)
  if (!passwordMatch) {
    res.status(401).json({ error: 'Invalid email or password' })
    return
  }

  const payload = {
    userId: user.id,
    businessId: user.businessId,
    role: user.role
  }

  const token = jsonwebtoken.sign(payload, process.env.JWT_SECRET!, { expiresIn: '7d' })
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
  })

  res.status(200).json({
    message: 'Login successful',
    user: { id: user.id, email: user.email, role: user.role }
  })
}))

// NEW: Add a protected /me route
router.get('/me', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication failed or user details not found on request.' })
    return
  }
  res.status(200).json({ currentUser: req.user })
}))

// Get Agent Configuration
router.get('/config', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const businessId = req.user!.businessId
  const config = await prisma.agentConfig.findUnique({ where: { businessId } })
  
  if (config) {
    res.status(200).json(config)
  } else {
    res.status(404).json({ error: 'Configuration not found. Please create one.' })
  }
}))

// Create/Update Agent Configuration
router.post('/config', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const businessId = req.user!.businessId
  const business = await prisma.business.findUnique({ where: { id: businessId } })
  
  if (!business) {
    res.status(404).json({ error: 'Business not found' })
    return
  }

  const { agentName, personaPrompt, welcomeMessage, leadCaptureCompletionMessage, colorTheme, voiceGreetingMessage, voiceCompletionMessage, voiceEmergencyMessage, voiceEndCallMessage, useOpenaiTts, openaiVoice, openaiModel } = req.body

  if (!agentName || !personaPrompt || !welcomeMessage) {
    res.status(400).json({ error: 'Missing required fields: agentName, personaPrompt, and welcomeMessage are required' })
    return
  }

  const baseConfigData = { agentName, personaPrompt, welcomeMessage, leadCaptureCompletionMessage, colorTheme: colorTheme || {} }
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

  const config = await prisma.agentConfig.upsert({
    where: { businessId },
    create: { businessId, ...configData },
    update: configData
  })

  res.status(200).json(config)
}))

// Get Lead Capture Questions for Agent Configuration
router.get('/config/questions', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const businessId = req.user!.businessId
  const agentConfig = await prisma.agentConfig.findUnique({ where: { businessId } })
  
  if (!agentConfig) {
    res.status(404).json({ error: 'Agent configuration not found for this business. Please create one first.' })
    return
  }

  const questions = await prisma.leadCaptureQuestion.findMany({
    where: { configId: agentConfig.id },
    orderBy: { order: 'asc' }
  })

  res.status(200).json(questions)
}))

// Create New Lead Capture Question
router.post('/config/questions', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const businessId = req.user!.businessId
  const { questionText, expectedFormat, order, mapsToLeadField, isEssentialForEmergency } = req.body

  if (!questionText || order === undefined || order === null) {
    res.status(400).json({ error: 'Missing required fields: questionText and order are required' })
    return
  }

  const agentConfig = await prisma.agentConfig.findUnique({ where: { businessId } })
  if (!agentConfig) {
    res.status(404).json({ error: 'Agent configuration must exist before adding questions. Please create one first.' })
    return
  }

  const newQuestion = await prisma.leadCaptureQuestion.create({
    data: {
      questionText,
      expectedFormat: expectedFormat || 'TEXT',
      order: Number(order),
      mapsToLeadField: mapsToLeadField || null,
      isEssentialForEmergency: Boolean(isEssentialForEmergency),
      configId: agentConfig.id
    }
  })

  res.status(201).json(newQuestion)
}))

// Update Lead Capture Question
router.put('/config/questions/:questionId', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const businessId = req.user!.businessId
  const questionId = req.params.questionId
  const { questionText, expectedFormat, order, mapsToLeadField, isEssentialForEmergency } = req.body

  if (!questionText || order === undefined || order === null) {
    res.status(400).json({ error: 'Missing required fields: questionText and order are required' })
    return
  }

  const question = await prisma.leadCaptureQuestion.findUnique({
    where: { id: questionId },
    include: { config: true }
  })

  if (!question || question.config.businessId !== businessId) {
    res.status(404).json({ error: 'Question not found or you do not have permission to modify it' })
    return
  }

  const updatedQuestion = await prisma.leadCaptureQuestion.update({
    where: { id: questionId },
    data: {
      questionText,
      expectedFormat: expectedFormat || 'TEXT',
      order: Number(order),
      mapsToLeadField: mapsToLeadField || null,
      isEssentialForEmergency: Boolean(isEssentialForEmergency)
    }
  })

  res.status(200).json(updatedQuestion)
}))

// Delete Lead Capture Question
router.delete('/config/questions/:questionId', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const businessId = req.user!.businessId
  const questionId = req.params.questionId

  const question = await prisma.leadCaptureQuestion.findUnique({
    where: { id: questionId },
    include: { config: true }
  })

  if (!question || question.config.businessId !== businessId) {
    res.status(404).json({ error: 'Question not found or you do not have permission to delete it' })
    return
  }

  await prisma.leadCaptureQuestion.delete({ where: { id: questionId } })
  res.status(204).send()
}))

// Get Business Notification Settings
router.get('/business/notifications', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const businessId = req.user!.businessId
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, name: true, notificationEmail: true, notificationPhoneNumber: true, planTier: true }
  })

  if (!business) {
    res.status(404).json({ error: 'Business not found' })
    return
  }

  res.status(200).json(business)
}))

// Update Business Notification Settings
router.put('/business/notifications', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const businessId = req.user!.businessId
  const { notificationEmail, notificationPhoneNumber } = req.body

  const updatedBusiness = await prisma.business.update({
    where: { id: businessId },
    data: {
      notificationEmail: notificationEmail?.trim() || null,
      notificationPhoneNumber: notificationPhoneNumber?.trim() || null
    },
    select: { id: true, name: true, notificationEmail: true, notificationPhoneNumber: true, planTier: true }
  })

  res.status(200).json(updatedBusiness)
}))

// Get All Clients for the Business
router.get('/clients', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const businessId = req.user!.businessId
  const clients = await prisma.client.findMany({
    where: { businessId },
    orderBy: { createdAt: 'desc' }
  })

  res.status(200).json(clients)
}))

// Create New Client
router.post('/clients', validateRequest(clientSchema), authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const { name, email, phone, externalId } = req.body
  if (!name) {
    res.status(400).json({ error: 'Client name is required' })
    return
  }

  const client = await prisma.client.create({
    data: { name, email, phone, externalId, businessId: req.user!.businessId }
  })

  res.status(201).json(client)
}))

// Update Client
router.put('/clients/:clientId', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { clientId } = req.params
  const parsedData = clientSchema.safeParse(req.body)
  
  if (!parsedData.success) {
    res.status(400).json({ error: parsedData.error.errors })
    return
  }

  const client = await prisma.client.update({
    where: { id: clientId as string, businessId: req.user.businessId },
    data: parsedData.data
  })

  res.json(client)
}))

// Delete Client
router.delete('/clients/:clientId', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { clientId } = req.params
  await prisma.client.delete({
    where: { id: clientId as string, businessId: req.user.businessId }
  })

  res.status(204).send()
}))

// Project Management Routes (Enterprise only)
router.get('/projects', authMiddleware, requirePlan('ENTERPRISE'), asyncHandler(async (req: Request, res: Response) => {
  const { clientId } = req.query
  const projects = await prisma.project.findMany({
    where: {
      businessId: req.user!.businessId,
      ...(clientId && { clientId: clientId as string })
    },
    include: { client: true }
  })

  res.json(projects)
}))

router.post('/projects', validateRequest(projectSchema), authMiddleware, requirePlan('ENTERPRISE'), asyncHandler(async (req: Request, res: Response) => {
  if (!isAuthenticatedRequest(req)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { name, status, clientId, details, externalId } = req.body
  if (!name || !status || !clientId) {
    res.status(400).json({ error: 'Project name, status, and client ID are required' })
    return
  }

  const clientExists = await prisma.client.findFirst({
    where: { id: clientId, businessId: req.user.businessId }
  })

  if (!clientExists) {
    res.status(400).json({ error: 'Invalid client ID for this business' })
    return
  }

  const project = await prisma.project.create({
    data: { name, status, details, externalId, clientId, businessId: req.user.businessId },
    include: { client: true }
  })

  res.status(201).json(project)
}))

router.get('/projects/:projectId', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  if (!isAuthenticatedRequest(req)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { projectId } = req.params
  const project = await prisma.project.findFirst({
    where: { id: projectId, businessId: req.user.businessId },
    include: { client: true }
  })

  if (!project) {
    res.status(404).json({ error: 'Project not found' })
    return
  }

  res.json(project)
}))

router.put('/projects/:projectId', authMiddleware, requirePlan('ENTERPRISE'), asyncHandler(async (req: Request, res: Response) => {
  if (!isAuthenticatedRequest(req)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { projectId } = req.params
  const { name, status, clientId, details, externalId } = req.body

  if (!name || !status || !clientId) {
    res.status(400).json({ error: 'Project name, status, and client ID are required' })
    return
  }

  const clientExists = await prisma.client.findFirst({
    where: { id: clientId, businessId: req.user.businessId }
  })

  if (!clientExists) {
    res.status(400).json({ error: 'Invalid client ID for this business' })
    return
  }

  const project = await prisma.project.update({
    where: { id: projectId, businessId: req.user.businessId },
    data: { name, status, details, externalId, clientId },
    include: { client: true }
  })

  res.json(project)
}))

router.delete('/projects/:projectId', authMiddleware, requirePlan('ENTERPRISE'), asyncHandler(async (req: Request, res: Response) => {
  if (!isAuthenticatedRequest(req)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { projectId } = req.params
  await prisma.project.delete({
    where: { id: projectId, businessId: req.user.businessId }
  })

  res.status(204).send()
}))

// Integration Management Routes (Enterprise only)
router.get('/integrations', authMiddleware, requirePlan('ENTERPRISE'), asyncHandler(async (req: Request, res: Response) => {
  if (!isAuthenticatedRequest(req)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const integrations = await prisma.integration.findMany({
    where: { businessId: req.user.businessId }
  })

  res.json(integrations)
}))

router.post('/integrations', authMiddleware, requirePlan('ENTERPRISE'), asyncHandler(async (req: Request, res: Response) => {
  if (!isAuthenticatedRequest(req)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { type, apiKey, webhookSecret, settings } = req.body
  if (!type || !apiKey) {
    res.status(400).json({ error: 'Integration type and API key are required' })
    return
  }

  const integration = await prisma.integration.create({
    data: { type, apiKey, webhookSecret, settings, businessId: req.user!.businessId }
  })

  res.status(201).json(integration)
}))

router.put('/integrations/:integrationId', authMiddleware, requirePlan('ENTERPRISE'), asyncHandler(async (req: Request, res: Response) => {
  if (!isAuthenticatedRequest(req)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { integrationId } = req.params
  const { type, apiKey, webhookSecret, config, isEnabled } = req.body

  const integration = await prisma.integration.update({
    where: { id: integrationId },
    data: { type, apiKey, webhookSecret, isEnabled, settings: config ? config : undefined }
  })

  res.json(integration)
}))

router.delete('/integrations/:integrationId', authMiddleware, requirePlan('ENTERPRISE'), asyncHandler(async (req: Request, res: Response) => {
  if (!isAuthenticatedRequest(req)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { integrationId } = req.params
  await prisma.integration.delete({ where: { id: integrationId } })
  res.status(204).end()
}))

// Manual sync trigger (Enterprise only)
router.post('/integrations/sync-now', authMiddleware, requirePlan('ENTERPRISE'), asyncHandler(async (req: Request, res: Response) => {
  if (!isAuthenticatedRequest(req)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  res.json({ message: 'Sync initiated successfully' })
}))

// Business Management Routes
router.get('/business', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const business = await prisma.business.findUnique({
    where: { id: req.user!.businessId },
    include: { users: true, agentConfig: true }
  })

  res.json(business)
}))

router.put('/business', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  if (!isAuthenticatedRequest(req)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { name, planTier } = req.body
  if (!name) {
    res.status(400).json({ error: 'Business name is required' })
    return
  }

  const business = await prisma.business.update({
    where: { id: req.user.businessId },
    data: { name, planTier }
  })

  res.json(business)
}))

// User Management Routes
router.get('/users', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const users = await prisma.user.findMany({
    where: { businessId: req.user!.businessId }
  })

  res.json(users)
}))

router.post('/users', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  if (!isAuthenticatedRequest(req)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { email, role, password } = req.body
  if (!email || !role || !password) {
    res.status(400).json({ error: 'Email, role, and password are required' })
    return
  }

  const existingUser = await prisma.user.findUnique({ where: { email } })
  if (existingUser) {
    res.status(400).json({ error: 'User with this email already exists' })
    return
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const user = await prisma.user.create({
    data: { email, role, businessId: req.user.businessId, passwordHash }
  })

  res.status(201).json(user)
}))

// Get All Knowledge Base Entries for the Business
router.get('/knowledgebase', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const entries = await prisma.knowledgeBase.findMany({
    where: { businessId: req.user!.businessId },
    orderBy: { createdAt: 'desc' }
  })

  res.json(entries)
}))

// Create New Knowledge Base Entry
router.post('/knowledgebase', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const businessId = req.user!.businessId
  const { content, sourceURL } = req.body

  if (!content || content.trim() === '') {
    res.status(400).json({ error: 'Content is required and cannot be empty' })
    return
  }

  const newKnowledgeEntry = await prisma.knowledgeBase.create({
    data: { content, sourceURL: sourceURL || null, businessId }
  })

  generateAndStoreEmbedding(newKnowledgeEntry.id).catch(console.error)
  res.status(201).json(newKnowledgeEntry)
}))

// Update Knowledge Base Entry
router.put('/knowledgebase/:kbId', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const businessId = req.user!.businessId
  const kbId = req.params.kbId
  const { content, sourceURL } = req.body

  const kbEntry = await prisma.knowledgeBase.findUnique({ where: { id: kbId } })
  if (!kbEntry || kbEntry.businessId !== businessId) {
    res.status(404).json({ error: 'Knowledge base entry not found or you do not have permission to modify it' })
    return
  }

  const updatedKbEntry = await prisma.knowledgeBase.update({
    where: { id: kbId },
    data: { 
      content: content !== undefined ? content : undefined, 
      sourceURL: sourceURL !== undefined ? sourceURL : undefined 
    }
  })

  if (content !== undefined && updatedKbEntry) {
    generateAndStoreEmbedding(updatedKbEntry.id).catch(console.error)
  }

  res.status(200).json(updatedKbEntry)
}))

// Delete Knowledge Base Entry
router.delete('/knowledgebase/:kbId', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const kbId = req.params.kbId
  const kbEntry = await prisma.knowledgeBase.findUnique({ where: { id: kbId } })

  if (!kbEntry || kbEntry.businessId !== req.user!.businessId) {
    res.status(404).json({ error: 'Knowledge base entry not found or you do not have permission to delete it' })
    return
  }

  await prisma.knowledgeBase.delete({ where: { id: kbId } })
  res.status(204).send()
}))

router.get('/logout', (req: Request, res: Response) => {
  res.cookie('token', '', {
    httpOnly: true,
    expires: new Date(0),
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  })
  res.redirect('/admin/login')
})

router.post('/test-sendgrid', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const { testEmail } = req.body
  if (!testEmail || !testEmail.includes('@')) {
    res.status(400).json({ error: 'Valid test email address required' })
    return
  }

  const result = await sendTestEmail(testEmail)
  res.status(200).json({
    success: true,
    message: 'SendGrid test email sent successfully.',
    result,
  })
}))

export default router 