import nodemailer from 'nodemailer'
import Mail from 'nodemailer/lib/mailer'
import twilio from 'twilio'
import sgTransport from 'nodemailer-sendgrid-transport'
import { PrismaClient } from '@prisma/client'

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
)

// Initialize Prisma client for AgentConfig fetching
const prisma = new PrismaClient()

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
  toEmail: string,
  leadDetails: any,
  leadPriority: string | null,
  businessName: string
): Promise<void> {
  if (!transporter) {
    console.error('Email transporter not initialized. Cannot send HSP notification.');
    return;
  }

  const fromEmail = process.env.FROM_EMAIL || '"AI Lead Agent" <noreply@example.com>';
  const contactName = leadDetails.contactName || (leadDetails.capturedData && leadDetails.capturedData["What is your full name, please?"]) || "N/A";
  const subject = `New ${leadPriority || 'NORMAL'} Priority Lead for ${businessName}: ${contactName}`;

  // --- Start Building Human-Readable HTML Body ---
  let htmlBody = `<p>Hello ${businessName} team,</p>`;
  
  // URGENT ALERT SECTION - Make emergency transcription highly visible at the top
  if (leadPriority === 'URGENT' && leadDetails.capturedData && leadDetails.capturedData.emergency_notes) {
    htmlBody += `
      <div style="background-color: #fef2f2; border: 3px solid #ef4444; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
        <h2 style="color: #dc2626; margin: 0 0 15px 0; font-size: 24px; text-transform: uppercase;">🚨 URGENT EMERGENCY ALERT 🚨</h2>
        <p style="font-size: 18px; font-weight: bold; color: #991b1b; margin: 0; line-height: 1.4;">
          Customer Stated: "${leadDetails.capturedData.emergency_notes}"
        </p>
      </div>
    `;
  }
  
  htmlBody += `<p>You have a new <strong>${leadPriority || 'NORMAL'} priority</strong> lead captured by your AI Assistant.</p>`;
  
  htmlBody += `<h3>Lead Details:</h3>`;
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
  if (leadDetails.notes) {
    htmlBody += `<li><strong>Notes/Description:</strong> ${leadDetails.notes}</li>`;
  }
  htmlBody += `<li><strong>Status:</strong> ${leadDetails.status || 'NEW'}</li>`;
  htmlBody += `<li><strong>Captured At:</strong> ${new Date(leadDetails.createdAt).toLocaleString()}</li>`;
  htmlBody += "</ul>";

  // Format Captured Data (the Q&A from lead capture flow)
  if (leadDetails.capturedData && typeof leadDetails.capturedData === 'object') {
    htmlBody += `<h3>All Captured Information:</h3>`;
    htmlBody += "<ul>";
    for (const [question, answer] of Object.entries(leadDetails.capturedData)) {
      // Skip internal notes if you don't want them repeated here
      if (question !== 'emergency_notes') {
         htmlBody += `<li><strong>${question.replace(/_/g, ' ')}:</strong> ${answer}</li>`;
      }
    }
    htmlBody += "</ul>";
  }

  // Format Conversation Transcript
  if (leadDetails.conversationTranscript) {
    try {
      const transcript = JSON.parse(leadDetails.conversationTranscript); // It's stored as a JSON string
      if (Array.isArray(transcript) && transcript.length > 0) {
        htmlBody += `<h3>Conversation Snippet:</h3>`;
        htmlBody += "<div style='border:1px solid #eee; padding:10px; max-height:300px; overflow-y:auto;'>";
        transcript.forEach((entry: { role: string, content: string }) => {
          if (entry.role === 'user') {
            htmlBody += `<p><strong>User:</strong> ${entry.content}</p>`;
          } else if (entry.role === 'assistant') {
            htmlBody += `<p><em>Assistant:</em> ${entry.content}</p>`;
          }
        });
        htmlBody += "</div>";
      }
    } catch (e) {
      console.error("Could not parse conversation transcript for email:", e);
      htmlBody += `<p><em>Conversation transcript was not available in a readable format.</em></p>`;
    }
  }
  
  htmlBody += `<p>Please log in to your dashboard to view full details and manage this lead.</p>`;
  htmlBody += `<p>Thank you,<br>Your AI Lead Agent</p>`;
  // --- End Building Human-Readable HTML Body ---

  const mailOptions = {
    from: fromEmail,
    to: toEmail,
    subject,
    html: htmlBody
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`HSP lead notification email sent. Full info object:`, JSON.stringify(info, null, 2));
    if (info && (info.messageId || (info.message && info.message.includes('success')) || (info.response && info.response.includes('250')) )) { // Broader check for success
      console.log(`HSP Email successfully processed by provider. Message ID (if available from info object): ${info.messageId}`);
    } else {
      console.warn('HSP Email processed by provider, but messageId might be missing or in a different field. Response:', info);
    }
  } catch (error) {
    console.error(`Error sending HSP notification email to ${toEmail}:`, error);
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
      console.error(`Missing required environment variables: ${missingVars.join(', ')}`);
      return;
    }

    const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
    if (!twilioPhoneNumber) {
      console.error('TWILIO_PHONE_NUMBER environment variable is not set')
      return
    }

    // Fetch AgentConfig for voice settings
    let agentConfig = null
    try {
      agentConfig = await prisma.agentConfig.findUnique({
        where: { businessId }
      })
      console.log('[Emergency Call] Found AgentConfig:', agentConfig ? 'Yes' : 'No')
    } catch (configError) {
      console.error('[Emergency Call] Error fetching AgentConfig:', configError)
    }

    // Configure voice settings with fallbacks - prioritize ENV var for HSP alerts
    // Note: Using hardcoded defaults since we've migrated to OpenAI for voice customization
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
      `This is an emergency <phoneme alphabet="ipa" ph="liːd">lead</phoneme> notification for ${safeBusinessName}.` +
      `<break strength="medium"/>` +
      `A customer has reported an emergency. Issue stated: <prosody rate="medium"><emphasis level="moderate">${safeLeadSummary}</emphasis></prosody>.` +
      `<break strength="medium"/>` +
      `Please check your email or dashboard immediately for full details and contact information.` +
      `<break strength="strong"/>` +
      `Repeating: <break time="300ms"/> ` +
      `<emphasis level="strong">Urgent</emphasis> emergency <phoneme alphabet="ipa" ph="liːd">lead</phoneme> for ${safeBusinessName}. ` +
      `Issue: <emphasis level="moderate">${safeLeadSummary}</emphasis>. ` +
      `Check your email for complete details.`

    // Create TwiML response using Twilio VoiceResponse class
    const twiml = new twilio.twiml.VoiceResponse()
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