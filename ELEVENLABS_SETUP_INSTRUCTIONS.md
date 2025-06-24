# ElevenLabs Agent Configuration - Complete Setup Guide

## 🚨 CRITICAL: Proper webhook configuration is required for personalized AI agents

### Step 1: Get Your Business's Twilio Phone Number

1. Go to your dashboard
2. Find your Twilio phone number (example: +15551234567)
3. Note this number - you'll need it for webhook configuration

### Step 2: Configure ElevenLabs Agent

1. **Login to ElevenLabs**: https://elevenlabs.io/app/conversational-ai
2. **Find your agent** (or create a new one)
3. **Click "Edit Agent"**

### Step 3: Set Webhook URLs

In your ElevenLabs agent settings, configure these webhooks:

#### 🎯 PERSONALIZATION WEBHOOK (CRITICAL)
- **URL**: `https://your-render-domain.com/api/voice/elevenlabs-personalization-working`
- **Method**: POST
- **Description**: "Dynamic configuration based on business and caller"
- **Trigger**: Before conversation starts

#### 📞 POST-CALL WEBHOOK (CRITICAL)  
- **URL**: `https://your-render-domain.com/api/voice/elevenlabs-post-call`
- **Method**: POST  
- **Description**: "Send call data and analytics to StudioConnect"
- **Trigger**: After conversation ends

### Step 4: Dynamic Variables Available

Your personalization webhook provides these dynamic variables that can be used in your agent's first message and prompts:

#### 🏢 Business Information
- `{{business_name}}` - Your business name from database
- `{{company_name}}` - Alternative variable for business name
- `{{business_type}}` - Type of business (e.g., "creative_agency")

#### 📞 Caller Information  
- `{{caller_phone}}` - Incoming caller's phone number
- `{{caller_id}}` - Alternative variable for caller phone
- `{{client_status}}` - "existing" or "new" based on database lookup
- `{{client_name}}` - Actual client name if existing, or "valued caller"
- `{{client_type}}` - "returning_client" or "new_prospect"

#### 📋 Call Context
- `{{called_number}}` - Your Twilio number that was called
- `{{agent_id}}` - ElevenLabs agent ID
- `{{call_timestamp}}` - ISO timestamp of call start
- `{{support_available}}` - Always "yes"

#### ⚙️ Configuration Flags
- `{{has_custom_greeting}}` - true/false if custom greeting configured
- `{{has_persona}}` - true/false if custom persona configured  
- `{{voice_configured}}` - true/false if custom voice selected

### Step 5: Example First Message Templates

#### Professional Greeting (Recommended)
```
Hello! Thank you for calling {{business_name}}. I'm your AI assistant, and I'm here to help with any questions about our services and projects. How may I assist you today?
```

#### Personalized for Existing Clients
```
Hello {{client_name}}! Welcome back to {{business_name}}. I'm your AI assistant. How can I help you today?
```

#### Dynamic Based on Client Status
```
Hello! Thank you for calling {{business_name}}. I'm your AI assistant. {{#if client_status === "existing"}}Welcome back, {{client_name}}!{{else}}I'm here to help with any questions about our services.{{/if}} How may I assist you today?
```

### Step 6: System Prompt Configuration

Your agent will automatically receive a customized system prompt based on your dashboard configuration:

#### If Custom Persona Configured
Uses your custom `personaPrompt` from agent settings

#### Default Professional Prompt
```
You are a professional AI assistant for {{business_name}}.

CORE RESPONSIBILITIES:
- Answer questions about projects, services, and creative work
- Provide project status updates and timeline information  
- Help with billing and payment questions
- Qualify new prospects and understand their needs
- Connect callers to appropriate team members
- Handle requests professionally and efficiently

COMMUNICATION STYLE:
- Professional yet conversational tone
- Keep responses concise (1-2 sentences typically)
- Ask clarifying questions when needed
- Always offer to connect with a team member for complex requests
- Be helpful and solution-focused

Remember: You represent {{business_name}} - maintain high professional standards in every interaction.
```

### Step 7: Voice Configuration

Your agent will automatically use:
- **Custom Voice**: If configured in your dashboard (`elevenlabsVoice`)
- **Default Voice**: `pNInz6obpgDQGcFmaJgB` (professional female voice)

### Step 8: Test Your Configuration

1. **Call your Twilio number**
2. **Check server logs** - you should see:
   ```
   [🎯💥 PERSONALIZATION #1] ================================================
   [🎯💥 PERSONALIZATION #1] 📞 INCOMING CALL
   [🎯💥 PERSONALIZATION #1] 📞 Caller: +15551234567
   [🎯💥 PERSONALIZATION #1] 📞 Called: +15551234567
   [🎯💥 PERSONALIZATION #1] 🤖 Agent: agent_12345
   [🎯💥 PERSONALIZATION #1] ✅ FOUND BUSINESS: Your Business Name
   [🎯💥 PERSONALIZATION #1] ✅ Using voiceGreetingMessage: "Hello! Thank you..."
   [🎯💥 PERSONALIZATION #1] ✅ SENDING CORRECT FORMAT RESPONSE
   ```

### Step 9: Verify Post-Call Webhook

After your test call ends, check logs for:
```
[🎯 ELEVENLABS POST-CALL] Payload received for call [call-id]
[🎯 ELEVENLABS POST-CALL] Call stored for business [business-name]
```

### Step 10: Advanced Configuration

#### Business Lookup Strategy
The system finds your business using this priority:
1. **Direct Twilio number match** - Exact match on `twilioPhoneNumber`
2. **Normalized digits match** - Partial match on phone digits
3. **Agent ID reverse lookup** - Match on `elevenlabsAgentId` (if stored)

#### Client Recognition
- **Existing clients** are identified by matching `caller_id` to client phone numbers
- **New callers** are treated as prospects
- **Personalized greetings** use actual client names when available

### 🚨 IF STILL NOT WORKING

1. **Check webhook URLs are accessible**:
   ```bash
   curl -X POST https://your-domain.com/api/voice/elevenlabs-personalization-working \
     -H "Content-Type: application/json" \
     -d '{"caller_id": "+15551234567", "called_number": "YOUR_TWILIO_NUMBER", "agent_id": "test"}'
   ```

2. **Verify response format**:
   ```json
   {
     "type": "conversation_initiation_client_data",
     "dynamic_variables": {
       "business_name": "Your Business",
       "caller_phone": "+15551234567",
       "client_status": "new"
     },
     "conversation_config_override": {
       "agent": {
         "prompt": {
           "prompt": "Your custom system prompt..."
         },
         "first_message": "Hello! Thank you for calling...",
         "language": "en"
       },
       "tts": {
         "voice_id": "pNInz6obpgDQGcFmaJgB"
       }
     }
   }
   ```

3. **Check server logs** for any webhook calls
4. **Verify ElevenLabs agent is using the correct webhook URLs**

## 🎯 What Should Happen

When working correctly:
1. **Call comes in** → ElevenLabs calls personalization webhook
2. **Your server** → Looks up business by phone number
3. **Database query** → Finds existing client (if any)
4. **Dynamic response** → Returns custom welcome message, system prompt, voice selection with all variables populated
5. **Agent speaks** → Uses YOUR business name, professional greeting, custom voice, personalized for the caller
6. **Call ends** → ElevenLabs calls post-call webhook with full conversation data
7. **Your server** → Saves call log, sends email notification

## 🚨 Common Issues

1. **Wrong webhook URL** - Must match your deployed domain exactly and use `/elevenlabs-personalization-working`
2. **HTTPS required** - ElevenLabs won't call HTTP endpoints
3. **Agent not updated** - Changes take a few minutes to propagate
4. **Wrong agent ID** - Make sure Twilio is routing to the correct ElevenLabs agent
5. **Business not found** - Verify your Twilio phone number is saved in the business record
6. **Invalid response format** - Must use exact ElevenLabs API format

## 🔧 Debug Commands

Test personalization webhook:
```bash
curl -X POST https://your-domain.com/api/voice/elevenlabs-personalization-working \
  -H "Content-Type: application/json" \
  -d '{
    "caller_id": "+15551234567", 
    "called_number": "YOUR_TWILIO_NUMBER",
    "agent_id": "your_agent_id",
    "call_sid": "test_call_123"
  }'
```

Test post-call webhook:
```bash
curl -X POST https://your-domain.com/api/voice/elevenlabs-post-call \
  -H "Content-Type: application/json" \
  -d '{
    "call_sid": "test", 
    "caller_id": "+15551234567", 
    "called_number": "YOUR_TWILIO_NUMBER",
    "conversation_summary": "Test call summary"
  }'
```

## 📊 Monitoring

Your server logs will show detailed information for each call:
- Personalization request processing
- Business lookup results
- Client recognition status
- Response configuration sent to ElevenLabs
- Post-call data processing

Look for the `[🎯💥 PERSONALIZATION #X]` log entries to track each call's processing. 