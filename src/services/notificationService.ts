// Updated: Added emergency voice call functionality and improved email notifications
import nodemailer from 'nodemailer'
import Mail from 'nodemailer/lib/mailer'
import twilio from 'twilio'
import sgTransport from 'nodemailer-sendgrid-transport'
import { PrismaClient } from '@prisma/client'
import VoiceResponse = require('twilio/lib/twiml/VoiceResponse')
import crypto from 'crypto'

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
)

// Initialize Prisma client for AgentConfig fetching
const prisma = new PrismaClient()

/**
 * Validates that all required Twilio environment variables are set
 * @returns {boolean} True if all required variables are present
 */
function validateTwilioConfig(): boolean {
  const requiredVars = [
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_PHONE_NUMBER'
  ];
  
  const missing = requiredVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    console.error(`[NotificationService] Missing required Twilio environment variables: ${missing.join(', ')}`);
    return false;
  }
  
  return true;
}

// Initialize email transporter
let transporter: nodemailer.Transporter

const initializeTransporter = async () => {
  // Debug logging for Render environment
  console.log('=== EMAIL TRANSPORTER DEBUG ===')
  console.log('NODE_ENV:', process.env.NODE_ENV)
  console.log('SENDGRID_API_KEY exists:', !!process.env.SENDGRID_API_KEY)
  console.log('SENDGRID_API_KEY starts with SG.:', process.env.SENDGRID_API_KEY?.startsWith('SG.'))
  console.log('SENDGRID_API_KEY length:', process.env.SENDGRID_API_KEY?.length || 0)
  console.log('Production check:', process.env.NODE_ENV === 'production')
  console.log('================================')
  
  // Try SendGrid first if API key is properly configured
  if (process.env.SENDGRID_API_KEY && process.env.SENDGRID_API_KEY.startsWith('SG.')) {
    console.log('Email Service: Initializing SendGrid transporter.')
    console.log('SendGrid API Key (first 10 chars):', process.env.SENDGRID_API_KEY.substring(0, 10) + '...')
    const options = { auth: { api_key: process.env.SENDGRID_API_KEY } }
    console.log('SendGrid options created:', JSON.stringify(options, null, 2))
    try {
      transporter = nodemailer.createTransport(sgTransport(options))
      console.log('SendGrid transporter created successfully')
      
      // Verify the transporter works
      await transporter.verify()
      console.log('SendGrid transporter verified successfully - emails will be sent via SendGrid')
      return // Exit successfully
    } catch (error) {
      console.error('Error with SendGrid transporter:', error)
      console.log('SendGrid verification failed, falling back to test email...')
    }
  } else {
    console.log('Email Service: SendGrid not properly configured.')
    if (!process.env.SENDGRID_API_KEY) {
      console.log('Reason: SENDGRID_API_KEY environment variable not set')
    } else if (!process.env.SENDGRID_API_KEY.startsWith('SG.')) {
      console.log('Reason: SENDGRID_API_KEY does not start with "SG." - invalid format')
      console.log('Current key starts with:', process.env.SENDGRID_API_KEY.substring(0, 3))
    }
  }
  
  // Fallback to test email service
  console.log('Using Ethereal test email service - emails will NOT be delivered to real addresses')
  try {
    const testAccount = await nodemailer.createTestAccount()
    console.log('Ethereal test account User: %s Pass: %s', testAccount.user, testAccount.pass)
    transporter = nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: { user: testAccount.user, pass: testAccount.pass },
    })
    console.log('Ethereal transporter created - check logs for preview URLs')
  } catch (err) {
    console.error('Failed to create Ethereal test account, email sending will fail:', err)
    transporter = nodemailer.createTransport({ jsonTransport: true })
    console.log('Using jsonTransport fallback - emails will be logged but not sent')
  }
}

// Initialize transporter when module loads
initializeTransporter()

/**
 * Sends an email notification to the HSP when a new lead is captured
 * @param toEmail - The HSP's notification email address
 * @param leadDetails - Object containing lead information (capturedData, conversationTranscript, contactName, contactEmail, etc.)
 * @param leadPriority - The priority level of the lead (LOW, NORMAL, HIGH, URGENT)
 * @param businessName - The name of the business
 */
export async function sendLeadNotificationEmail(
  toEmail: string | string[],
  leadDetails: any,
  leadPriority: string | null,
  businessName: string
): Promise<void> {
  // Normalize to array for unified processing
  const recipients = Array.isArray(toEmail) ? toEmail : [toEmail]

  if (!transporter) {
    console.error('Email transporter not initialized. Cannot send HSP notification.');
    return;
  }

  const fromEmail = process.env.FROM_EMAIL || '"AI Lead Agent" <noreply@example.com>';
  const contactName = leadDetails.contactName || (leadDetails.capturedData && leadDetails.capturedData["What is your full name, please?"]) || "N/A";
  const subject = `New ${leadPriority || 'NORMAL'} Priority Request for ${businessName}: ${contactName}`;

  // --- Start Building Human-Readable HTML Body ---
  let htmlBody = `<p>Hello ${businessName} team,</p>`;
  
  // URGENT ALERT SECTION - Make emergency transcription highly visible at the top
  if (leadPriority === 'URGENT' && leadDetails.capturedData && leadDetails.capturedData.emergency_notes) {
    htmlBody += `
      <div style="background-color: #fef2f2; border: 3px solid #ef4444; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
        <h2 style="color: #dc2626; margin: 0 0 15px 0; font-size: 24px; text-transform: uppercase;">🚨 URGENT PROJECT REQUEST 🚨</h2>
        <p style="font-size: 18px; font-weight: bold; color: #991b1b; margin: 0; line-height: 1.4;">
          Customer Stated: "${leadDetails.capturedData.emergency_notes}"
        </p>
      </div>
    `;
  }
  
  htmlBody += `<p>You have a new <strong>${leadPriority || 'NORMAL'} priority</strong> request captured by your AI Studio Manager.</p>`;
  
  htmlBody += `<h3>Request Details:</h3>`;
  htmlBody += "<ul>";
  if (leadDetails.contactName) {
    htmlBody += `<li><strong>Contact Name:</strong> ${leadDetails.contactName}</li>`;
  }
  if (leadDetails.contactEmail) {
    htmlBody += `<li><strong>Contact Email:</strong> ${leadDetails.contactEmail}</li>`;
  }
  if (leadDetails.contactPhone) {
    htmlBody += `<li><strong>Contact Phone:</strong> ${leadDetails.contactPhone}</li>`;
  }
  if (leadDetails.projectType) {
    htmlBody += `<li><strong>Project Type:</strong> ${leadDetails.projectType}</li>`;
  }
  if (leadDetails.budget) {
    htmlBody += `<li><strong>Budget Range:</strong> ${leadDetails.budget}</li>`;
  }
  if (leadDetails.timeline) {
    htmlBody += `<li><strong>Timeline:</strong> ${leadDetails.timeline}</li>`;
  }
  if (leadDetails.notes) {
    htmlBody += `<li><strong>Project Description:</strong> ${leadDetails.notes}</li>`;
  }
  htmlBody += `<li><strong>Status:</strong> ${leadDetails.status || 'NEW'}</li>`;
  htmlBody += `<li><strong>Captured At:</strong> ${new Date(leadDetails.createdAt).toLocaleString()}</li>`;
  htmlBody += "</ul>";

  // Format Captured Data (the Q&A from lead capture flow)
  if (leadDetails.capturedData && typeof leadDetails.capturedData === 'object') {
    htmlBody += `<h3>Project Requirements:</h3>`;
    htmlBody += "<ul>";
    for (const [question, answer] of Object.entries(leadDetails.capturedData)) {
      if (question !== 'emergency_notes') {
        const formattedQuestion = question
          .replace(/_/g, ' ')
          .replace(/^what is your/i, '')
          .replace(/^please tell us about/i, '')
          .replace(/^can you describe/i, '')
          .trim();
        htmlBody += `<li><strong>${formattedQuestion}:</strong> ${answer}</li>`;
      }
    }
    htmlBody += "</ul>";
  }

  // Format Conversation Transcript
  if (leadDetails.conversationTranscript) {
    try {
      const transcript = JSON.parse(leadDetails.conversationTranscript);
      if (Array.isArray(transcript) && transcript.length > 0) {
        htmlBody += `<h3>Initial Consultation Notes:</h3>`;
        htmlBody += "<div style='border:1px solid #eee; padding:10px; max-height:300px; overflow-y:auto;'>";
        transcript.forEach((entry: { role: string, content: string }) => {
          if (entry.role === 'user') {
            htmlBody += `<p><strong>Client:</strong> ${entry.content}</p>`;
          } else if (entry.role === 'assistant') {
            htmlBody += `<p><em>AI Studio Manager:</em> ${entry.content}</p>`;
          }
        });
        htmlBody += "</div>";
      }
    } catch (e) {
      console.error("Could not parse conversation transcript for email:", e);
      htmlBody += `<p><em>Initial consultation notes were not available in a readable format.</em></p>`;
    }
  }
  
  htmlBody += `<p>Please log in to your dashboard to view full details and manage this request.</p>`;
  htmlBody += `<p>Best regards,<br>Your AI Studio Manager</p>`;

  const mailOptionsBase = {
    from: fromEmail,
    subject,
    html: htmlBody,
  } as const

  try {
    for (const recipient of recipients) {
      const info = await transporter.sendMail({ ...mailOptionsBase, to: recipient })

      console.log(`Studio lead notification email sent to ${recipient}.`, info.messageId)
    }
  } catch (error) {
    console.error(`Error sending studio notification email to recipients:`, error);
  }
}

/**
 * Test function to verify email configuration
 */
export async function testEmailConfiguration(): Promise<void> {
  try {
    const testAccount = await nodemailer.createTestAccount()
    console.log('Email test account created successfully!')
    console.log('User:', testAccount.user)
    console.log('Pass:', testAccount.pass)
    console.log('SMTP Host:', 'smtp.ethereal.email')
    console.log('SMTP Port:', 587)
  } catch (error) {
    console.error('Failed to create test email account:', error)
    throw error
  }
}

/**
 * Initiates an emergency voice call to the HSP when a high-priority lead is captured
 * @param toPhoneNumber - The HSP's phone number to call
 * @param businessName - The name of the business
 * @param leadSummary - A brief summary of the lead details
 * @param businessId - The business ID to fetch voice configuration
 */
export async function initiateEmergencyVoiceCall(
  toPhoneNumber: string,
  businessName: string,
  leadSummary: string,
  businessId: string
): Promise<void> {
  try {
    // Validate required environment variables
    const requiredEnvVars = {
      TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
      TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER
    };

    const missingVars = Object.entries(requiredEnvVars)
      .filter(([_, value]) => !value)
      .map(([key]) => key);

    if (missingVars.length > 0) {
      console.error(`[Emergency Call] Missing required environment variables: ${missingVars.join(', ')}`);
      return;
    }

    const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
    if (!twilioPhoneNumber) {
      console.error('[Emergency Call] TWILIO_PHONE_NUMBER environment variable is not set');
      return;
    }

    // Fetch AgentConfig for voice settings
    let agentConfig = null;
    try {
      agentConfig = await prisma.agentConfig.findUnique({
        where: { businessId }
      });
      console.log('[Emergency Call] Found AgentConfig:', agentConfig ? 'Yes' : 'No');
    } catch (configError) {
      console.error('[Emergency Call] Error fetching AgentConfig:', configError);
    }

    // Configure voice settings with fallbacks
    const voiceToUse = (process.env.AGENT_VOICE_FOR_HSP_ALERTS || 'alice') as any
    const languageToUse = 'en-US' as any
    console.log('[Emergency Call] Voice settings:', { voice: voiceToUse, language: languageToUse })

    // Enhanced XML escaping function for safe text insertion in SSML
    const escapeXml = (unsafe: string): string => {
      return unsafe.replace(/[<>&'"]/g, function (c: string) {
        switch (c) {
          case '<': return '&lt;'
          case '>': return '&gt;'
          case '&': return '&amp;'
          case '\'': return '&apos;'
          case '"': return '&quot;'
          default: return c
        }
      })
    }

    // Escape the dynamic content
    const safeBusinessName = escapeXml(businessName)
    const safeLeadSummary = escapeXml(leadSummary)

    // Create enhanced SSML message with strategic pauses, emphasis, and professional urgency
    const messageToSay = 
      `<prosody rate="fast"><emphasis level="strong">Urgent Alert!</emphasis></prosody>` +
      `<break strength="medium"/>` +
      `This is an urgent project request notification for ${safeBusinessName}.` +
      `<break strength="medium"/>` +
      `A customer has requested immediate assistance. Details: <prosody rate="medium"><emphasis level="moderate">${safeLeadSummary}</emphasis></prosody>.` +
      `<break strength="medium"/>` +
      `Please check your email or dashboard right away for full information.` +
      `<break strength="strong"/>` +
      `Repeating: <break time="300ms"/> ` +
      `<emphasis level="strong">Urgent</emphasis> project request for ${safeBusinessName}. ` +
      `Details: <emphasis level="moderate">${safeLeadSummary}</emphasis>. ` +
      `Check your email for complete details.`

    // Create TwiML response using Twilio VoiceResponse class
    const twiml = new VoiceResponse()
    twiml.say({ voice: voiceToUse, language: languageToUse }, messageToSay)

    try {
      // Validate Twilio client
      if (!twilioClient) {
        console.error('Twilio client not initialized');
        return;
      }

      // Log emergency call attempt
      console.log('[Emergency Call] Initiating call with details:', {
        to: toPhoneNumber,
        from: twilioPhoneNumber,
        businessId,
        businessName,
        timestamp: new Date().toISOString()
      });

      // Create the call with error handling
      const call = await twilioClient.calls.create({
        twiml: twiml.toString(),
        to: toPhoneNumber,
        from: twilioPhoneNumber
      });

      // Log successful call creation
      console.log('[Emergency Call] Call created successfully:', {
        callSid: call.sid,
        status: call.status,
        timestamp: new Date().toISOString()
      });

      // Add call status monitoring
      const callStatus = await call.fetch();
      console.log('[Emergency Call] Initial call status:', {
        callSid: call.sid,
        status: callStatus.status,
        timestamp: new Date().toISOString()
      });

      // Add call log entry for emergency call
      const callLog = await prisma.callLog.create({
        data: {
          businessId,
          conversationId: crypto.randomUUID(),
          callSid: call.sid,
          from: twilioPhoneNumber,
          to: toPhoneNumber,
          direction: 'OUTBOUND',
          status: (call.status ? call.status.replace(/-/g, '_').toUpperCase() : 'INITIATED') as any,
          source: 'EMERGENCY_CALL_NOTIFICATION',
          type: 'VOICE',
          metadata: {
            leadSummary: safeLeadSummary,
            leadId: businessId
          }
        }
      });

    } catch (twilioError: any) {
      console.error('[Emergency Call] Twilio API error:', {
        code: twilioError.code,
        message: twilioError.message,
        status: twilioError.status,
        moreInfo: twilioError.moreInfo,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('[Emergency Call] Failed to initiate emergency voice call:', error);
  }
}

/**
 * Sends a confirmation email to the customer after their lead is captured
 * @param customerEmail - The customer's email address
 * @param businessName - The name of the business
 * @param leadDetails - Object containing lead information
 * @param isEmergency - Whether this was marked as an emergency request
 */
export async function sendLeadConfirmationToCustomer(
  customerEmail: string,
  businessName: string,
  leadDetails: any,
  isEmergency: boolean
): Promise<void> {
  try {
    if (!transporter) {
      console.error('Email transporter not initialized. Cannot send customer confirmation.')
      return
    }

    console.log(`Sending confirmation email to customer ${customerEmail}...`)

    // Extract customer name from various possible sources
    const customerName = leadDetails.contactName || 
      (leadDetails.capturedData && leadDetails.capturedData["What is your full name?"]) || 
      'Valued Customer'

    // Build the captured details HTML
    let capturedDetailsHtml = '<ul>'
    if (leadDetails.capturedData && typeof leadDetails.capturedData === 'object') {
      for (const [key, value] of Object.entries(leadDetails.capturedData)) {
        if (key !== 'emergency_notes') { // Don't show internal emergency notes to customer
          capturedDetailsHtml += `<li><strong>${key.replace(/_/g, ' ')}:</strong> ${value}</li>`
        }
      }
    }
    capturedDetailsHtml += '</ul>'

    // Build the HTML email content
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #f8f9fa; padding: 20px; border-radius: 8px 8px 0 0; }
          .content { background-color: white; padding: 20px; border: 1px solid #e9ecef; }
          .footer { 
            background-color: #f8f9fa; 
            padding: 15px; 
            text-align: center; 
            font-size: 12px; 
            color: #666;
            border-radius: 0 0 8px 8px;
          }
          .urgent-notice {
            background-color: #fee2e2;
            border: 2px solid #ef4444;
            color: #991b1b;
            padding: 15px;
            border-radius: 5px;
            margin: 15px 0;
            font-weight: bold;
          }
          ul { list-style-type: none; padding-left: 0; }
          li { margin-bottom: 10px; }
          strong { color: #4b5563; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2 style="margin: 0;">Thank You for Contacting ${businessName}</h2>
          </div>
          
          <div class="content">
            <p>Hi ${customerName},</p>
            
            <p>Thank you for contacting ${businessName}. We've received your details regarding your service request and our team will be in touch with you shortly.</p>
            
            ${isEmergency ? '<div class="urgent-notice">We\'ve noted your request as urgent and will prioritize it accordingly.</div>' : ''}
            
            <p>For your records, here's a summary of the information you provided:</p>
            ${capturedDetailsHtml}
            
            <p>Sincerely,<br>The Team at ${businessName}</p>
          </div>
          
          <div class="footer">
            <p>This is an automated message. Please do not reply to this email.</p>
          </div>
        </div>
      </body>
      </html>
    `

    // Send the email
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: customerEmail,
      subject: `Thank You for Contacting ${businessName}`,
      html: htmlContent
    })

    console.log(`Confirmation email sent successfully to ${customerEmail}`)
  } catch (error) {
    console.error('Failed to send customer confirmation email:', error)
    throw error
  }
}

export interface ClickToCallParams {
  phoneNumber: string
  businessNotificationPhoneNumber: string
  businessName: string
  conversationHistory: any[]
}

export async function initiateClickToCall({
  phoneNumber,
  businessNotificationPhoneNumber,
  businessName,
  conversationHistory
}: ClickToCallParams): Promise<{ success: boolean; callSid: string }> {
  try {
    // Validate Twilio configuration
    if (!validateTwilioConfig()) throw new Error('Twilio configuration is incomplete.')

    // Format conversation history for context
    const formattedHistory = conversationHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n')

    // Create TwiML for the call
    const twiml = new VoiceResponse()
    twiml.say(
      { voice: 'Polly.Amy', language: 'en-GB' },
      `You have an emergency call request from a chat user for ${businessName}. Here's the conversation history: ${formattedHistory}`
    )

    // Initiate the call using Twilio
    const call = await twilioClient.calls.create({
      to: businessNotificationPhoneNumber,
      from: process.env.TWILIO_PHONE_NUMBER as string,
      twiml: twiml.toString(),
      statusCallback: `${process.env.API_BASE_URL}/api/calls/status`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST'
    })

    // Retrieve business by notification number
    const business = await prisma.business.findFirst({ where: { notificationPhoneNumber: businessNotificationPhoneNumber } })

    if (!business) {
      console.error('Business not found for logging click-to-call.')
      return { success: true, callSid: call.sid }
    }

    // Create a new conversation for the call
    const conversation = await prisma.conversation.create({
      data: {
        businessId: business.id,
        sessionId: crypto.randomUUID(),
        metadata: {
          chatConversationHistory: formattedHistory,
          customerPhoneNumber: phoneNumber
        }
      }
    })

    // Log the call initiation
    await prisma.callLog.create({
      data: {
        businessId: business.id,
        conversationId: conversation.id,
        callSid: call.sid,
        from: process.env.TWILIO_PHONE_NUMBER as string,
        to: businessNotificationPhoneNumber,
        direction: 'OUTBOUND',
        type: 'VOICE',
        status: 'INITIATED',
        source: 'CLICK_TO_CALL'
      }
    })

    return { success: true, callSid: call.sid }
  } catch (error) {
    console.error('Error initiating click-to-call:', error)
    throw error
  }
}

export async function sendTestEmail(email: string) {
  // Implementation for sending test email
  return { success: true, message: 'Test email sent' }
}

export async function initiateCall(to: string, from: string, businessId: string) {
  // Implementation for initiating a call
  return 'test-call-sid'
}

/**
 * Sends an after-call summary email to all business notification recipients.
 * This is triggered for every completed call (new or existing client).
 */
export async function sendCallSummaryEmail(
  toEmails: string[] | string,
  summary: {
    businessName: string
    caller: string
    callee?: string
    durationSec: number
    transcript?: string
  },
): Promise<void> {
  const recipients = Array.isArray(toEmails) ? toEmails : [toEmails]
  if (!recipients.length) return

  if (!transporter) {
    console.error('[NotificationService] Transporter not initialised – cannot send call summary')
    return
  }

  const fromEmail = process.env.FROM_EMAIL || 'noreply@studioconnect.ai'
  const subject = `Call Summary – ${summary.businessName}`

  const bodyLines: string[] = [
    `<p>Hello ${summary.businessName} team,</p>`,
    `<p>Here is the summary of the recent call:</p>`,
    '<ul>',
    `<li><strong>Caller:</strong> ${summary.caller}</li>`,
    summary.callee ? `<li><strong>To:</strong> ${summary.callee}</li>` : '',
    `<li><strong>Duration:</strong> ${Math.round(summary.durationSec)} seconds</li>`,
    '</ul>',
  ]

  if (summary.transcript) {
    bodyLines.push('<h3>Transcript</h3>')
    bodyLines.push(`<pre style="background:#f8fafc;padding:12px;border-radius:6px;font-family:monospace;white-space:pre-wrap;">${summary.transcript}</pre>`)
  }

  bodyLines.push('<p>Best regards,<br/>StudioConnect AI</p>')

  const htmlBody = bodyLines.filter(Boolean).join('\n')

  const base = { from: fromEmail, subject, html: htmlBody }

  try {
    for (const to of recipients) {
      await transporter.sendMail({ ...base, to })
    }
    console.log(`[NotificationService] Call summary email sent to ${recipients.join(', ')}`)
  } catch (err) {
    console.error('[NotificationService] Failed to send call summary email', err)
  }
}

/**
 * 🎯 STEP 3: ENTERPRISE MONITORING ALERT EMAIL
 * Sends critical system alerts via email using existing SendGrid setup
 */
export async function sendStep3Alert(alertData: {
  alertType: string
  severity: string
  metric: number
  threshold: number
  businessId: string
  systemStatus: {
    memoryUsage: number
    uptime: number
    nodeVersion: string
  }
}): Promise<void> {
  try {
    if (!transporter) {
      console.error('[🎯 STEP 3] Email transporter not initialized - cannot send alert')
      return
    }

    console.log('[🎯 STEP 3] Sending alert email:', alertData.alertType, alertData.severity)

    // Get notification recipients from business configuration
    let recipients: string[] = []
    
    if (alertData.businessId && alertData.businessId !== 'system') {
      try {
        const business = await prisma.business.findUnique({
          where: { id: alertData.businessId },
          select: { notificationEmails: true, name: true }
        })
        
        if (business?.notificationEmails?.length) {
          recipients = business.notificationEmails
          console.log('[🎯 STEP 3] Using business notification emails:', recipients)
        }
      } catch (err) {
        console.error('[🎯 STEP 3] Error fetching business emails:', err)
      }
    }
    
    // Fallback to configured admin email if no business emails found
    if (recipients.length === 0) {
      const adminEmail = process.env.ADMIN_EMAIL || process.env.FROM_EMAIL || 'admin@studioconnect.ai'
      recipients = [adminEmail]
      console.log('[🎯 STEP 3] Using fallback admin email:', adminEmail)
    }

    const fromEmail = process.env.FROM_EMAIL || '"StudioConnect AI Alerts" <alerts@studioconnect.ai>'
    const subject = `🚨 ${alertData.severity} Alert: ${alertData.alertType} - StudioConnect AI`

    // Create rich HTML alert email
    const htmlBody = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .alert-header { 
            background-color: ${alertData.severity === 'CRITICAL' ? '#ef4444' : '#f59e0b'}; 
            color: white; 
            padding: 20px; 
            border-radius: 8px 8px 0 0; 
            text-align: center;
          }
          .alert-content { 
            background-color: white; 
            padding: 20px; 
            border: 1px solid #e5e7eb; 
            border-radius: 0 0 8px 8px;
          }
          .metric-box {
            background-color: #f3f4f6;
            padding: 15px;
            border-radius: 6px;
            margin: 15px 0;
            border-left: 4px solid ${alertData.severity === 'CRITICAL' ? '#ef4444' : '#f59e0b'};
          }
          .system-info {
            background-color: #f8fafc;
            padding: 15px;
            border-radius: 6px;
            margin: 15px 0;
            font-family: monospace;
            font-size: 12px;
          }
          ul { list-style-type: none; padding-left: 0; }
          li { margin-bottom: 8px; }
          strong { color: #374151; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="alert-header">
            <h1 style="margin: 0;">🚨 ${alertData.severity} System Alert</h1>
            <p style="margin: 10px 0 0 0; font-size: 18px;">${alertData.alertType}</p>
          </div>
          
          <div class="alert-content">
            <p><strong>Alert Details:</strong></p>
            
            <div class="metric-box">
              <h3 style="margin: 0 0 10px 0; color: ${alertData.severity === 'CRITICAL' ? '#dc2626' : '#d97706'};">
                Performance Threshold Exceeded
              </h3>
              <ul>
                <li><strong>Metric Value:</strong> ${alertData.metric}</li>
                <li><strong>Threshold:</strong> ${alertData.threshold}</li>
                <li><strong>Alert Type:</strong> ${alertData.alertType}</li>
                <li><strong>Severity:</strong> ${alertData.severity}</li>
                <li><strong>Business ID:</strong> ${alertData.businessId}</li>
                <li><strong>Timestamp:</strong> ${new Date().toLocaleString()}</li>
              </ul>
            </div>

            <div class="system-info">
              <h4 style="margin: 0 0 10px 0;">System Status</h4>
              <ul>
                <li><strong>Memory Usage:</strong> ${Math.round(alertData.systemStatus.memoryUsage / 1024 / 1024)} MB</li>
                <li><strong>Uptime:</strong> ${Math.round(alertData.systemStatus.uptime / 3600)} hours</li>
                <li><strong>Node Version:</strong> ${alertData.systemStatus.nodeVersion}</li>
                <li><strong>Environment:</strong> ${process.env.NODE_ENV || 'unknown'}</li>
                <li><strong>Service URL:</strong> ${process.env.APP_PRIMARY_URL || 'https://leads-support-agent.onrender.com'}</li>
              </ul>
            </div>

            <p><strong>Recommended Actions:</strong></p>
            <ul>
              <li>• Check the monitoring dashboard: <a href="${process.env.APP_PRIMARY_URL || 'https://leads-support-agent.onrender.com'}/api/voice/step3/monitoring-dashboard">View Dashboard</a></li>
              <li>• Review system health: <a href="${process.env.APP_PRIMARY_URL || 'https://leads-support-agent.onrender.com'}/api/voice/step3/enterprise-health">Health Check</a></li>
              <li>• Verify failover status: <a href="${process.env.APP_PRIMARY_URL || 'https://leads-support-agent.onrender.com'}/api/voice/step3/failover-status">Failover Status</a></li>
            </ul>

            <p>This alert was generated by the Step 3 Enterprise Monitoring system.</p>
            <p><strong>StudioConnect AI Monitoring Team</strong></p>
          </div>
        </div>
      </body>
      </html>
    `

    // Send alert to all recipients
    for (const recipient of recipients) {
      await transporter.sendMail({
        from: fromEmail,
        to: recipient,
        subject,
        html: htmlBody
      })
    }

    console.log(`[🎯 STEP 3] ✅ Alert email sent to ${recipients.length} recipients:`, recipients.join(', '))

  } catch (error) {
    console.error('[🎯 STEP 3] ❌ Failed to send alert email:', error)
    throw error
  }
}