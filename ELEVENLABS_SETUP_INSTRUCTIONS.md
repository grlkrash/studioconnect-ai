# ElevenLabs Agent Configuration - URGENT FIX

## 🚨 CRITICAL: Your agent isn't working because webhooks aren't configured

### Step 1: Get Your Business's Twilio Phone Number

1. Go to your dashboard
2. Find your Twilio phone number (example: +15551234567)
3. Note this number - you'll need it

### Step 2: Configure ElevenLabs Agent

1. **Login to ElevenLabs**: https://elevenlabs.io/app/conversational-ai
2. **Find your agent** (or create a new one)
3. **Click "Edit Agent"**

### Step 3: Set Webhook URLs

In your ElevenLabs agent settings, configure these webhooks:

#### 🎯 PERSONALIZATION WEBHOOK (CRITICAL)
- **URL**: `https://your-render-domain.com/api/voice/elevenlabs-personalization`
- **Method**: POST
- **Description**: "Dynamic configuration based on business and caller"

#### 📞 POST-CALL WEBHOOK (CRITICAL)  
- **URL**: `https://your-render-domain.com/api/voice/elevenlabs-post-call`
- **Method**: POST  
- **Description**: "Send call data and analytics to StudioConnect"

### Step 4: Test Your Configuration

1. **Call your Twilio number**
2. **Check server logs** - you should see:
   ```
   [🎯 PERSONALIZATION] INCOMING CALL PERSONALIZATION REQUEST
   [🎯 PERSONALIZATION] Business Found: Your Business Name
   [🎯 PERSONALIZATION] Sending custom configuration
   ```

### Step 5: Verify Post-Call Webhook

After your test call ends, check logs for:
```
[🎯 ELEVENLABS POST-CALL] Payload received for call [call-id]
[🎯 ELEVENLABS POST-CALL] Call stored for business [business-name]
```

### 🚨 IF STILL NOT WORKING

1. **Check webhook URLs are accessible**:
   ```bash
   curl -X POST https://your-domain.com/api/voice/elevenlabs-personalization \
     -H "Content-Type: application/json" \
     -d '{"caller_id": "+15551234567", "called_number": "YOUR_TWILIO_NUMBER", "agent_id": "test"}'
   ```

2. **Check server logs** for any webhook calls
3. **Verify ElevenLabs agent is using the correct webhook URLs**

## 🎯 What Should Happen

When working correctly:
1. **Call comes in** → ElevenLabs calls personalization webhook
2. **Your server** → Returns custom welcome message, system prompt, voice selection  
3. **Agent speaks** → Uses YOUR business name, professional greeting, custom voice
4. **Call ends** → ElevenLabs calls post-call webhook with full conversation data
5. **Your server** → Saves call log, sends email notification

## 🚨 Common Issues

1. **Wrong webhook URL** - Must match your deployed domain exactly
2. **HTTPS required** - ElevenLabs won't call HTTP endpoints
3. **Agent not updated** - Changes take a few minutes to propagate
4. **Wrong agent ID** - Make sure Twilio is routing to the correct ElevenLabs agent

## 🔧 Debug Commands

Test personalization webhook:
```bash
curl -X POST https://your-domain.com/api/voice/elevenlabs-personalization \
  -H "Content-Type: application/json" \
  -d '{"caller_id": "+15551234567", "called_number": "YOUR_TWILIO_NUMBER"}'
```

Test post-call webhook:
```bash
curl -X POST https://your-domain.com/api/voice/elevenlabs-post-call \
  -H "Content-Type: application/json" \
  -d '{"call_sid": "test", "caller_id": "+15551234567", "called_number": "YOUR_TWILIO_NUMBER"}'
``` 