import nodemailer from 'nodemailer'
import Mail from 'nodemailer/lib/mailer'
import twilio from 'twilio'
import sgTransport from 'nodemailer-sendgrid-transport'

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
)

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
  console.log('Both conditions:', process.env.NODE_ENV === 'production' && process.env.SENDGRID_API_KEY)
  console.log('================================')
  
  if (process.env.SENDGRID_API_KEY) {
    console.log('Email Service: Initializing SendGrid transporter.')
    console.log('SendGrid API Key (first 10 chars):', process.env.SENDGRID_API_KEY.substring(0, 10) + '...')
    const options = { auth: { api_key: process.env.SENDGRID_API_KEY } }
    console.log('SendGrid options created:', JSON.stringify(options, null, 2))
    try {
      transporter = nodemailer.createTransport(sgTransport(options))
      console.log('SendGrid transporter created successfully')
    } catch (error) {
      console.error('Error creating SendGrid transporter:', error)
      throw error
    }
  } else {
    console.log('Email Service: SendGrid not configured or not in production. Initializing Ethereal transporter.')
    try {
      const testAccount = await nodemailer.createTestAccount()
      console.log('Ethereal test account User: %s Pass: %s', testAccount.user, testAccount.pass)
      transporter = nodemailer.createTransport({
        host: testAccount.smtp.host,
        port: testAccount.smtp.port,
        secure: testAccount.smtp.secure,
        auth: { user: testAccount.user, pass: testAccount.pass },
      })
    } catch (err) {
      console.error('Failed to create Ethereal test account, email sending will fail:', err)
      transporter = nodemailer.createTransport({ jsonTransport: true })
    }
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
  try {
    if (!transporter) {
      console.error('Email transporter not initialized. Cannot send notification.')
      return
    }

    console.log(`Sending lead notification email to ${toEmail}...`)

    // Extract contact info from capturedData if not in dedicated fields
    let contactName = leadDetails.contactName
    let contactEmail = leadDetails.contactEmail
    let contactPhone = leadDetails.contactPhone

    // If dedicated fields are empty, try to extract from capturedData
    if (!contactName || !contactEmail || !contactPhone) {
      const capturedData = leadDetails.capturedData || {}
      
      // Look for name in common question patterns
      for (const [question, answer] of Object.entries(capturedData)) {
        const lowerQuestion = question.toLowerCase()
        if (!contactName && (lowerQuestion.includes('name') || lowerQuestion.includes('full name'))) {
          contactName = answer as string
        }
        if (!contactEmail && (lowerQuestion.includes('email') || lowerQuestion.includes('e-mail'))) {
          contactEmail = answer as string
        }
        if (!contactPhone && (lowerQuestion.includes('phone') || lowerQuestion.includes('number'))) {
          contactPhone = answer as string
        }
      }
    }

    // Format the priority for display
    const priorityDisplay = leadPriority || 'NORMAL'
    const priorityColor = {
      'URGENT': '#ef4444',
      'HIGH': '#f59e0b',
      'NORMAL': '#3b82f6',
      'LOW': '#6b7280'
    }[priorityDisplay] || '#3b82f6'

    // Build the HTML email content
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #f8f9fa; padding: 20px; border-radius: 8px 8px 0 0; }
          .priority-badge { 
            display: inline-block; 
            padding: 5px 15px; 
            border-radius: 20px; 
            color: white; 
            font-weight: bold;
            background-color: ${priorityColor};
          }
          .content { background-color: white; padding: 20px; border: 1px solid #e9ecef; }
          .field { margin-bottom: 15px; }
          .field-label { font-weight: bold; color: #666; }
          .data-box { 
            background-color: #f8f9fa; 
            padding: 15px; 
            border-radius: 5px; 
            margin-top: 10px;
            font-family: monospace;
            font-size: 14px;
            white-space: pre-wrap;
            word-wrap: break-word;
          }
          .transcript-box {
            background-color: #f1f5f9;
            padding: 15px;
            border-radius: 5px;
            margin-top: 10px;
            font-size: 14px;
            max-height: 400px;
            overflow-y: auto;
            white-space: pre-wrap;
            word-wrap: break-word;
          }
          .footer { 
            background-color: #f8f9fa; 
            padding: 15px; 
            text-align: center; 
            font-size: 12px; 
            color: #666;
            border-radius: 0 0 8px 8px;
          }
          .emergency-notice {
            background-color: #fee2e2;
            border: 2px solid #ef4444;
            color: #991b1b;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2 style="margin: 0;">New Lead Captured</h2>
            <p style="margin: 10px 0 0 0;">
              <span class="priority-badge">${priorityDisplay} PRIORITY</span>
            </p>
          </div>
          
          <div class="content">
            ${priorityDisplay === 'URGENT' ? '<div class="emergency-notice">⚠️ URGENT: This lead indicated an emergency situation and requires immediate attention!</div>' : ''}
            
            <div class="field">
              <span class="field-label">Business:</span> ${businessName}
            </div>
            
            <div class="field">
              <span class="field-label">Contact Name:</span> ${contactName || 'Not provided'}
            </div>
            
            <div class="field">
              <span class="field-label">Contact Email:</span> ${contactEmail || 'Not provided'}
            </div>
            
            <div class="field">
              <span class="field-label">Contact Phone:</span> ${contactPhone || 'Not provided'}
            </div>
            
            ${leadDetails.notes ? `
            <div class="field">
              <span class="field-label">Notes:</span>
              <div class="data-box">${leadDetails.notes}</div>
            </div>
            ` : ''}
            
            <div class="field">
              <span class="field-label">Captured Data:</span>
              <div class="data-box">${JSON.stringify(leadDetails.capturedData, null, 2)}</div>
            </div>
            
            <div class="field">
              <span class="field-label">Conversation Transcript:</span>
              <div class="transcript-box">${leadDetails.conversationTranscript}</div>
            </div>
            
            <div class="field">
              <span class="field-label">Lead Created:</span> ${new Date().toLocaleString()}
            </div>
          </div>
          
          <div class="footer">
            <p>This is an automated notification from your AI Lead Agent.</p>
            <p>To manage lead notifications, please update your settings in the admin dashboard.</p>
          </div>
        </div>
      </body>
      </html>
    `

    // Construct the email options
    const mailOptions: Mail.Options = {
      from: process.env.FROM_EMAIL || 'sonia@cincyaisolutions.com',
      to: toEmail,
      subject: `New ${priorityDisplay} Priority Lead from ${businessName} AI Agent: ${contactName || 'N/A'}`,
      html: htmlContent,
      text: `
New ${priorityDisplay} Priority Lead

Business: ${businessName}
Contact Name: ${contactName || 'Not provided'}
Contact Email: ${contactEmail || 'Not provided'}
Contact Phone: ${contactPhone || 'Not provided'}
${leadDetails.notes ? `Notes: ${leadDetails.notes}` : ''}

Captured Data:
${JSON.stringify(leadDetails.capturedData, null, 2)}

Conversation Transcript:
${leadDetails.conversationTranscript}

Lead Created: ${new Date().toLocaleString()}

---
This is an automated notification from your AI Lead Agent.
      `.trim()
    }

    // Send the email
    try {
      console.log('About to send email using transporter type:', transporter.transporter?.name || 'unknown')
      console.log('Transporter options:', JSON.stringify(transporter.options, null, 2))
      
      const info = await transporter.sendMail(mailOptions)
      console.log('Email sent. Full info object:', JSON.stringify(info, null, 2))
      
      if (info && info.messageId) {
        console.log(`Email Message ID: ${info.messageId}`)
      } else {
        console.warn('Email sent, but no messageId found in info object.')
        console.warn('This suggests Ethereal or jsonTransport is being used instead of SendGrid')
      }
      
      // If using Ethereal (i.e., if NODE_ENV !== 'production' or SendGrid key is missing)
      if (process.env.NODE_ENV !== 'production' && nodemailer.getTestMessageUrl(info)) {
        console.log('Preview URL (Ethereal): %s', nodemailer.getTestMessageUrl(info))
      }
    } catch (error) {
      console.error(`Error sending email to ${mailOptions.to}:`, error)
    }

  } catch (error) {
    console.error('Failed to send lead notification email:', error)
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
 */
export async function initiateEmergencyVoiceCall(
  toPhoneNumber: string,
  businessName: string,
  leadSummary: string
): Promise<void> {
  try {
    const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER
    if (!twilioPhoneNumber) {
      console.error('TWILIO_PHONE_NUMBER environment variable is not set')
      return
    }

    // XML escaping function for safe text insertion
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

    // Construct message with SSML phoneme tag for "lead"
    const messageToSay = `Urgent <phoneme alphabet="ipa" ph="liːd">lead</phoneme> for ${safeBusinessName}. ${safeLeadSummary}. Please check your system for details. Repeating: Urgent <phoneme alphabet="ipa" ph="liːd">lead</phoneme> for ${safeBusinessName}. ${safeLeadSummary}.`

    // Create TwiML response with proper SSML
    const twiml = `<Response><Say voice="alice" language="en-US">${messageToSay}</Say></Response>`

    await twilioClient.calls.create({
      twiml,
      to: toPhoneNumber,
      from: twilioPhoneNumber
    })

    console.log(`Emergency voice call initiated to ${toPhoneNumber} for business ${businessName}`)
  } catch (error) {
    console.error('Failed to initiate emergency voice call:', error)
    // Don't throw the error - we don't want call failures to break the lead capture flow
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

    // Construct the email options
    const mailOptions: Mail.Options = {
      from: process.env.FROM_EMAIL || 'sonia@cincyaisolutions.com',
      to: customerEmail,
      subject: `Your inquiry with ${businessName} has been received!`,
      html: htmlContent,
      text: `
Hi ${customerName},

Thank you for contacting ${businessName}. We've received your details regarding your service request and our team will be in touch with you shortly.

${isEmergency ? 'We\'ve noted your request as urgent and will prioritize it accordingly.\n\n' : ''}
For your records, here's a summary of the information you provided:

${Object.entries(leadDetails.capturedData || {})
  .filter(([key]) => key !== 'emergency_notes')
  .map(([key, value]) => `${key.replace(/_/g, ' ')}: ${value}`)
  .join('\n')}

Sincerely,
The Team at ${businessName}

---
This is an automated message. Please do not reply to this email.
      `.trim()
    }

    // Send the email
    try {
      console.log('About to send email using transporter type:', transporter.transporter?.name || 'unknown')
      console.log('Transporter options:', JSON.stringify(transporter.options, null, 2))
      
      const info = await transporter.sendMail(mailOptions)
      console.log('Email sent. Full info object:', JSON.stringify(info, null, 2))
      
      if (info && info.messageId) {
        console.log(`Email Message ID: ${info.messageId}`)
      } else {
        console.warn('Email sent, but no messageId found in info object.')
        console.warn('This suggests Ethereal or jsonTransport is being used instead of SendGrid')
      }
      
      // If using Ethereal (i.e., if NODE_ENV !== 'production' or SendGrid key is missing)
      if (process.env.NODE_ENV !== 'production' && nodemailer.getTestMessageUrl(info)) {
        console.log('Preview URL (Ethereal): %s', nodemailer.getTestMessageUrl(info))
      }
    } catch (error) {
      console.error(`Error sending email to ${mailOptions.to}:`, error)
    }

  } catch (error) {
    console.error('Failed to send customer confirmation email:', error)
  }
}