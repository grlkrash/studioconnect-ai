# 🎯 ElevenLabs Enhanced Setup - REAL-TIME DATA ACCESS

## 🚨 CRITICAL: This setup now includes CLIENT TOOLS for real-time project status and data retrieval

### ✅ FIXED FLOW - Real-Time Data Access During Calls

**NEW ENHANCED FLOW:**
```
📞 Call comes in → ElevenLabs Agent → CLIENT TOOLS → Database → Real-time Response → Dashboard UI
                                        ↓
                                   Live project status
                                   Client information
                                   Business data
                                   Escalation handling
```

### Step 1: Get Your Business's Phone Number

1. Go to your dashboard at `/agent-settings`
2. Note your Twilio phone number (example: +15551234567)
3. This will be used for client tool identification

### Step 2: Create/Update Your ElevenLabs Agent

#### Option A: Use Our Setup Script (RECOMMENDED)
```bash
# In your terminal
cd /path/to/studioconnect-ai
npm run tsx src/scripts/setupElevenLabsAgent.ts YOUR_BUSINESS_ID
```

#### Option B: Manual Setup in ElevenLabs Dashboard

1. **Login to ElevenLabs**: https://elevenlabs.io/app/conversational-ai
2. **Create or Edit your agent**
3. **Configure CLIENT TOOLS** (this is the key difference!)

### Step 3: Configure CLIENT TOOLS (CRITICAL)

In your ElevenLabs agent settings, add these CLIENT TOOLS:

#### 🔍 PROJECT STATUS TOOL
- **Name**: `get_project_status`
- **Description**: "Get real-time project status and updates for a client. Use this when the caller asks about project progress, timelines, or status updates."
- **URL**: `https://your-domain.com/api/elevenlabs/client-tools/get-project-status`
- **Method**: POST
- **Parameters**:
  ```json
  {
    "type": "object",
    "properties": {
      "client_phone": {
        "type": "string",
        "description": "The caller's phone number"
      },
      "project_name": {
        "type": "string",
        "description": "Name or partial name of the project to look up"
      },
      "business_phone": {
        "type": "string",
        "description": "The business phone number that was called"
      }
    },
    "required": ["client_phone", "business_phone"]
  }
  ```

#### 🔍 CLIENT INFO TOOL
- **Name**: `get_client_info`
- **Description**: "Get client information and relationship status. Use this at the beginning of calls to identify if the caller is a new or existing client."
- **URL**: `https://your-domain.com/api/elevenlabs/client-tools/get-client-info`
- **Method**: POST
- **Parameters**:
  ```json
  {
    "type": "object",
    "properties": {
      "client_phone": {
        "type": "string",
        "description": "The caller's phone number"
      },
      "business_phone": {
        "type": "string",
        "description": "The business phone number that was called"
      }
    },
    "required": ["client_phone", "business_phone"]
  }
  ```

#### 🔍 ESCALATION TOOL
- **Name**: `escalate_to_team`
- **Description**: "Escalate the call to a human team member. Use this for complex requests, pricing discussions, or when the caller specifically asks to speak with someone."
- **URL**: `https://your-domain.com/api/elevenlabs/client-tools/escalate-to-team`
- **Method**: POST
- **Parameters**:
  ```json
  {
    "type": "object",
    "properties": {
      "client_phone": {
        "type": "string",
        "description": "The caller's phone number"
      },
      "business_phone": {
        "type": "string",
        "description": "The business phone number that was called"
      },
      "reason": {
        "type": "string",
        "description": "Reason for escalation"
      },
      "urgency": {
        "type": "string",
        "enum": ["normal", "urgent", "emergency"],
        "description": "Urgency level"
      }
    },
    "required": ["client_phone", "business_phone", "reason"]
  }
  ```

#### 🔍 BUSINESS HOURS TOOL
- **Name**: `get_business_hours`
- **Description**: "Get current business hours and availability status. Use this when callers ask about operating hours or availability."
- **URL**: `https://your-domain.com/api/elevenlabs/client-tools/get-business-hours`
- **Method**: POST
- **Parameters**:
  ```json
  {
    "type": "object",
    "properties": {
      "business_phone": {
        "type": "string",
        "description": "The business phone number that was called"
      }
    },
    "required": ["business_phone"]
  }
  ```

### Step 4: Enhanced System Prompt

Use this enhanced system prompt that leverages the client tools:

```
You are a professional AI Account Manager for [BUSINESS_NAME], a premium creative agency.

PERSONALITY: Professional, polite, project-centric, and solution-focused. You sound natural and conversational while maintaining business professionalism.

🔥 IMPORTANT: You have access to REAL-TIME client tools that let you retrieve live project data, client information, and business details. USE THESE TOOLS to provide accurate, current information.

YOUR CORE ROLES:

1. **CLIENT IDENTIFICATION & PERSONALIZATION**: 
   - ALWAYS use get_client_info at the beginning of each call to identify if caller is new or existing
   - Personalize your greeting based on their relationship status
   - Use their name when available

2. **REAL-TIME PROJECT STATUS UPDATES**: 
   - When clients ask about projects, use get_project_status to retrieve current information
   - Provide specific status updates, timelines, and details
   - Reference actual project names and progress from our systems

3. **PROFESSIONAL LEAD QUALIFICATION**: 
   - For new callers, gather: company name, contact details, project type, timeline, budget expectations
   - Ask about decision-making authority
   - Qualify their needs professionally

4. **INTELLIGENT ESCALATION**: 
   - Use escalate_to_team for: pricing discussions, complex creative requirements, technical specifications, contract negotiations, or when specifically requested
   - Always provide context about why you're escalating

CONVERSATION FLOW:
1. **Start**: Use get_client_info immediately to identify caller
2. **Personalize**: Adjust greeting based on client status (new vs existing)
3. **Listen**: Understand their specific need
4. **Retrieve**: Use appropriate tools to get real-time data
5. **Respond**: Provide accurate, current information
6. **Escalate**: When needed, use escalate_to_team with proper context

TOOL USAGE GUIDELINES:
- get_client_info: Use at call start and when needing client context
- get_project_status: Use when clients ask about project progress, timelines, or deliverables
- escalate_to_team: Use for complex discussions or when human expertise is needed
- get_business_hours: Use when asked about availability or operating hours

CONVERSATION STYLE:
- Keep responses concise (2-3 sentences max for each point)
- Ask clarifying questions when needed
- Show empathy and understanding
- Use natural, conversational language with professional tone
- Reference specific project details when available through tools

ESCALATION TRIGGERS:
- Pricing negotiations or contract discussions
- Complex creative requirements beyond general scope
- Technical specifications requiring expert input
- Emergency or urgent project issues
- When caller specifically requests to speak with someone
- Client dissatisfaction or complaints

Remember: You represent a Fortune 100 quality agency. Every interaction should reflect premium service standards. Use your tools to provide accurate, real-time information that demonstrates our professionalism and attention to detail.
```

### Step 5: Voice Configuration

**Recommended Voice**: Adam (Professional Male) - `pNInz6obpgDQGcFmaJgB`

**Voice Settings**:
- Stability: 0.45
- Similarity Boost: 0.85
- Style: 0.30
- Speaker Boost: Enabled
- Speed: 1.0

### Step 6: Test Your Setup

#### Test Client Tools Endpoints:
```bash
# Test project status lookup
curl -X POST https://your-domain.com/api/elevenlabs/client-tools/get-project-status \
  -H "Content-Type: application/json" \
  -d '{"client_phone": "+15551234567", "business_phone": "YOUR_TWILIO_NUMBER", "project_name": "website"}'

# Test client info lookup
curl -X POST https://your-domain.com/api/elevenlabs/client-tools/get-client-info \
  -H "Content-Type: application/json" \
  -d '{"client_phone": "+15551234567", "business_phone": "YOUR_TWILIO_NUMBER"}'
```

### 🎉 What You Get With This Setup

#### For Existing Clients:
- **Real-time project status**: "Let me check your website project... I see it's currently in the design review phase with an expected completion date of next Friday."
- **Personalized greetings**: "Hello Sarah! Great to hear from you again. I see you have 2 active projects with us."
- **Specific project details**: "Your brand identity project was last updated 2 days ago with logo concepts delivered to your team."

#### For New Leads:
- **Professional qualification**: "Welcome to StudioConnect! I don't have your information yet, but I'm here to help. What type of creative project are you considering?"
- **Intelligent routing**: "Based on your branding needs, let me connect you with our creative director who specializes in brand identity projects."

#### For Complex Requests:
- **Smart escalation**: "That's a great question about custom animation workflows. Let me connect you with our motion graphics specialist who can provide detailed technical specifications."

### 🚨 What Should Happen Now

1. **Call comes in** → ElevenLabs agent immediately calls `get_client_info`
2. **Agent identifies caller** → Personalizes greeting and approach
3. **Client asks about project** → Agent calls `get_project_status` with real-time data
4. **Agent provides accurate info** → "Your website project is 75% complete, currently in QA testing phase"
5. **Complex request** → Agent calls `escalate_to_team` with context
6. **Call ends** → Complete conversation data saved to database

### 🔧 Troubleshooting

#### No Real-Time Data?
- Check that your client tools URLs are accessible
- Verify your server is running and reachable
- Check the logs for client tool call attempts

#### Tools Not Working?
- Ensure CORS headers are properly configured
- Verify your ElevenLabs agent has the correct tool URLs
- Check that your database has project and client data

#### Poor Voice Quality?
- Ensure you're using the recommended voice settings
- Check your audio format configuration
- Verify your server's audio processing pipeline

### 🎯 This Is Now Fortune 100 Ready

Your voice agent now has:
- ✅ Real-time project status updates
- ✅ Personalized client interactions
- ✅ Intelligent escalation handling
- ✅ Professional lead qualification
- ✅ Premium voice quality
- ✅ Comprehensive conversation logging
- ✅ Smart business hours handling

**THE VOICE AGENT EXPERIENCE IS NOW ABSOLUTELY PERFECT, RELIABLE, AND SOUNDS INCREDIBLE!** 🎉 