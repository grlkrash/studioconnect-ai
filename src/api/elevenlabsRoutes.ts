import express from 'express'
import axios from 'axios'
import { generateSpeechWithElevenLabs } from '../services/elevenlabs'
import { prisma } from '../services/db'
import { refreshProjectStatus } from '../services/projectStatusService'
import { normalizePhoneNumber } from '../utils/phoneHelpers'
import { sendLeadNotificationEmail } from '../services/notificationService'

export const elevenLabsRouter = express.Router()

elevenLabsRouter.get('/voices', async (req, res) => {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY
    if (!apiKey) return res.status(400).json({ error: 'ELEVENLABS_API_KEY missing' })
    const { data } = await axios.get('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey },
    })
    res.json(data)
  } catch (err: any) {
    console.error('[11Labs] voice list error', err.message)
    res.status(500).json({ error: 'Failed to fetch voices' })
  }
})

// Voice preview endpoint for admin UI
elevenLabsRouter.post('/preview', async (req, res) => {
  try {
    const { text, voiceId, voiceSettings } = req.body
    
    if (!text || !voiceId) {
      return res.status(400).json({ error: 'Text and voiceId are required' })
    }

    const audioPath = await generateSpeechWithElevenLabs(
      text,
      voiceId,
      'eleven_turbo_v2_5',
      voiceSettings
    )

    if (!audioPath) {
      return res.status(500).json({ error: 'Failed to generate speech' })
    }

    // Stream the audio file
    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Content-Disposition', 'inline; filename="voice-preview.mp3"')
    
    const fs = require('fs')
    const stream = fs.createReadStream(audioPath)
    stream.pipe(res)
    
    // Clean up file after streaming
    stream.on('end', () => {
      fs.unlink(audioPath, (err: any) => {
        if (err) console.error('Failed to cleanup preview file:', err)
      })
    })
    
  } catch (err: any) {
    console.error('[11Labs] voice preview error', err.message)
    res.status(500).json({ error: 'Failed to generate voice preview' })
  }
})

/**
 * 🎯 ELEVENLABS CLIENT TOOLS - REAL-TIME DATA ACCESS FOR CONVERSATIONS
 * 
 * These are custom functions that ElevenLabs agents can call during conversations
 * to retrieve live project status, client data, and other real-time information
 */

/**
 * 🔍 GET REAL-TIME PROJECT STATUS - CLIENT TOOL
 * This endpoint is called by ElevenLabs agents during conversations
 */
elevenLabsRouter.post('/client-tools/get-project-status', async (req, res) => {
  try {
    const { client_phone, project_name, business_phone } = req.body

    console.log('[🔍 CLIENT TOOL] Project status lookup requested:', {
      client_phone,
      project_name,
      business_phone
    })

    // Find business by phone number
    const business = await prisma.business.findFirst({
      where: { twilioPhoneNumber: business_phone }
    })

    if (!business) {
      return res.json({
        success: false,
        message: "I'm sorry, I couldn't locate your business account. Let me transfer you to a team member."
      })
    }

    // Find client by phone number
    const normalizedPhone = normalizePhoneNumber(client_phone)
    const client = await prisma.client.findFirst({
      where: {
        businessId: business.id,
        OR: [
          { phone: normalizedPhone },
          { phone: client_phone }
        ]
      }
    })

    if (!client) {
      return res.json({
        success: false,
        message: "I don't have your contact information in our system yet. Let me connect you with someone who can help you immediately."
      })
    }

    // Search for projects
    let projects = await prisma.project.findMany({
      where: {
        clientId: client.id,
        AND: project_name ? [
          {
            name: {
              contains: project_name,
              mode: 'insensitive'
            }
          }
        ] : []
      },
      orderBy: { updatedAt: 'desc' },
      take: 5
    })

    if (projects.length === 0) {
      return res.json({
        success: false,
        message: `I don't see any projects matching "${project_name || 'your search'}" in our system. Let me connect you with your project manager who can provide the most current information.`
      })
    }

    // Refresh project status from PM tools
    for (const project of projects) {
      try {
        await refreshProjectStatus(project.id)
      } catch (error) {
        console.warn('[🔍 CLIENT TOOL] Could not refresh project:', project.name, error)
      }
    }

    // Get updated project data
    const updatedProjects = await prisma.project.findMany({
      where: { id: { in: projects.map(p => p.id) } },
      orderBy: { updatedAt: 'desc' }
    })

    if (updatedProjects.length === 1) {
      const project = updatedProjects[0]
      const statusText = project.status?.toLowerCase().replace(/_/g, ' ') || 'in progress'
      const lastUpdate = project.lastSyncedAt || project.updatedAt
      
      return res.json({
        success: true,
        message: `Great news! I found your "${project.name}" project. Current status: ${statusText}. ${project.details ? `Latest update: ${project.details}` : ''} Last synced: ${lastUpdate.toLocaleDateString()}. Would you like me to connect you with your project manager for more detailed information?`
      })
    } else {
      // Multiple projects found
      const projectList = updatedProjects.map((p, index) => {
        const status = p.status?.toLowerCase().replace(/_/g, ' ') || 'in progress'
        return `${index + 1}. "${p.name}" - Status: ${status}`
      }).join('\n')

      return res.json({
        success: true,
        message: `I found ${updatedProjects.length} projects for you:\n\n${projectList}\n\nWhich project would you like to know more about? Or would you prefer to speak with your project manager directly?`
      })
    }

  } catch (error) {
    console.error('[🔍 CLIENT TOOL] Project status error:', error)
    return res.json({
      success: false,
      message: "I'm experiencing a technical issue accessing our project management system. Let me connect you with your project manager right away for the most current information."
    })
  }
})

/**
 * 🔍 GET CLIENT INFORMATION - CLIENT TOOL
 * This endpoint is called by ElevenLabs agents to get client context
 */
elevenLabsRouter.post('/client-tools/get-client-info', async (req, res) => {
  try {
    const { client_phone, business_phone } = req.body

    console.log('[🔍 CLIENT TOOL] Client lookup requested:', {
      client_phone,
      business_phone
    })

    // Find business
    const business = await prisma.business.findFirst({
      where: { twilioPhoneNumber: business_phone }
    })

    if (!business) {
      return res.json({
        success: false,
        client_status: 'unknown',
        message: "Welcome! I'll need to gather some information to best assist you."
      })
    }

    // Find client
    const normalizedPhone = normalizePhoneNumber(client_phone)
    const client = await prisma.client.findFirst({
      where: {
        businessId: business.id,
        OR: [
          { phone: normalizedPhone },
          { phone: client_phone }
        ]
      }
    })

    if (!client) {
      return res.json({
        success: true,
        client_status: 'new',
        message: `Welcome to ${business.name}! I don't have your information in our system yet, but I'm here to help. Are you interested in learning about our creative services or do you have a specific project in mind?`
      })
    }

    // Get project count separately
    const projectCount = await prisma.project.count({
      where: { clientId: client.id }
    })
    
    const firstName = client.name?.split(' ')[0] || 'there'

    return res.json({
      success: true,
      client_status: 'existing',
      client_name: firstName,
      project_count: projectCount,
      message: `Hello ${firstName}! Great to hear from you again. I see you have ${projectCount} project${projectCount !== 1 ? 's' : ''} with us. How can I help you today?`
    })

  } catch (error) {
    console.error('[🔍 CLIENT TOOL] Client lookup error:', error)
    return res.json({
      success: false,
      client_status: 'unknown',
      message: "Welcome! How can I assist you today?"
    })
  }
})

/**
 * 🔍 ESCALATE TO TEAM - CLIENT TOOL
 * This endpoint handles escalation requests during conversations
 */
elevenLabsRouter.post('/client-tools/escalate-to-team', async (req, res) => {
  try {
    const { client_phone, business_phone, reason, urgency } = req.body

    console.log('[🔍 CLIENT TOOL] Escalation requested:', {
      client_phone,
      business_phone,
      reason,
      urgency
    })

    // Find business
    const business = await prisma.business.findFirst({
      where: { twilioPhoneNumber: business_phone }
    })

    if (!business) {
      return res.json({
        success: false,
        message: "I'm having trouble with our system. Please try calling back in a few minutes."
      })
    }

    // Create escalation record as a lead
    const newLead = await prisma.lead.create({
      data: {
        businessId: business.id,
        capturedData: {
          phone: client_phone,
          reason: reason || 'General inquiry',
          urgency: urgency || 'normal',
          timestamp: new Date().toISOString(),
          type: 'ESCALATION'
        },
        contactPhone: client_phone,
        status: 'NEW',
        priority: urgency === 'urgent' || urgency === 'emergency' ? 'HIGH' : 'NORMAL',
        notes: `Escalation from voice call: ${reason || 'General inquiry'}`
      }
    })

    // Fire-and-forget email notification
    if (business.notificationEmails?.length || business.notificationEmail) {
      const recipients = business.notificationEmails?.length ? business.notificationEmails : (business.notificationEmail ? [business.notificationEmail] : [])
      sendLeadNotificationEmail(recipients, newLead, newLead.priority, business.name).catch(console.error)
    }

    // Determine escalation message based on urgency
    let escalationMessage = "I'm connecting you with one of our team members right now. "
    
    if (urgency === 'urgent' || urgency === 'emergency') {
      escalationMessage += "This is marked as urgent, so you'll be prioritized in our queue. Please hold while I transfer you."
    } else {
      escalationMessage += "Someone will be with you shortly to provide the detailed assistance you need."
    }

    return res.json({
      success: true,
      action: 'transfer',
      message: escalationMessage
    })

  } catch (error) {
    console.error('[🔍 CLIENT TOOL] Escalation error:', error)
    return res.json({
      success: false,
      message: "I'm having trouble connecting you right now. Please try calling back, or if this is urgent, please call our main number directly."
    })
  }
})

/**
 * 🔍 GET BUSINESS HOURS - CLIENT TOOL
 * This endpoint provides current business hours and availability
 */
elevenLabsRouter.post('/client-tools/get-business-hours', async (req, res) => {
  try {
    const { business_phone } = req.body

    // Find business
    const business = await prisma.business.findFirst({
      where: { twilioPhoneNumber: business_phone }
    })

    if (!business) {
      return res.json({
        success: false,
        message: "I'm having trouble accessing our schedule. Please try calling back."
      })
    }

    // Get current time info
    const now = new Date()
    const currentHour = now.getHours()
    const currentDay = now.getDay() // 0 = Sunday, 1 = Monday, etc.
    
    // Basic business hours logic (can be enhanced with actual business.businessHours data)
    const isWeekday = currentDay >= 1 && currentDay <= 5
    const isBusinessHours = isWeekday && currentHour >= 9 && currentHour < 17

    let message = `Our regular business hours are Monday through Friday, 9 AM to 5 PM. `
    
    if (isBusinessHours) {
      message += "We're currently open! How can I help you today?"
    } else {
      message += "We're currently outside of regular business hours, but I'm here to help. For urgent matters, I can connect you with our on-call team."
    }

    return res.json({
      success: true,
      is_open: isBusinessHours,
      message
    })

  } catch (error) {
    console.error('[🔍 CLIENT TOOL] Business hours error:', error)
    return res.json({
      success: false,
      message: "I'm here to help! How can I assist you today?"
    })
  }
})

// Export the main router - client tools are already mounted on elevenLabsRouter 