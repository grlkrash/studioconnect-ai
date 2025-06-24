# StudioConnect AI - Voice Agent Recovery & Hardening Plan

**Version:** 2.0  
**Status:** Proposed  
**Author:** Gemini AI  
**Date:** 2025-06-20

## 1. Executive Summary

The current voice agent implementation has critical flaws causing it to ignore custom configurations (prompts, greetings) from the database, resulting in a generic, unprofessional, and unreliable user experience. This behavior is unacceptable for our target of providing a "Fortune 100" quality service.

This document outlines a comprehensive technical plan to not only fix the immediate bugs but to re-architect our ElevenLabs integration for bulletproof reliability, complete observability, and a premium, high-fidelity conversational experience.

The core of the problem lies in flawed server-side logic that incorrectly overrides the database configuration and a complete lack of a feedback loop from the ElevenLabs platform. We are operating blind. This plan will fix that.

## 2. Technical Deep Dive & Step-by-Step Plan

### Step 1: Eliminate Flawed "Smart" Overrides (The Root Cause)

- **Problem:** The primary bug is located in the `POST /api/voice/elevenlabs-personalization` route in `src/api/voiceRoutes.ts`. This endpoint contains logic that attempts to be "smart" by detecting what it considers "generic" prompts in our database. When it detects one, it discards the database configuration entirely and injects a hardcoded, complex default prompt.

- **Evidence:** The Render logs confirm this is happening:
  ```
  [🎯 PERSONALIZATION] ⚠️ Using ENHANCED PROFESSIONAL system prompt (2136 chars) - Database had generic prompt
  ```
  This single log line is the smoking gun for why custom prompts are being ignored.

- **The Fix:** I will perform a surgical removal of this flawed logic. The new principle will be: **The database is the single, undisputed source of truth.**
    1.  **Modify `src/api/voiceRoutes.ts`:**
    2.  Locate the `/elevenlabs-personalization` handler.
    3.  Remove all conditional checks (`if (business.agentConfig?.personaPrompt && ...)`).
    4.  The code will be refactored to directly and unconditionally use `business.agentConfig.personaPrompt` and `business.agentConfig.voiceGreetingMessage`.
    5.  **Add Robust Fallbacks:** If `personaPrompt` or `voiceGreetingMessage` are `null` or empty in the database, the system will:
        -   Log a `CRITICAL` error message clearly stating which business is misconfigured.
        -   Use a simple, safe, and obviously default message (e.g., "Hello. How can I help?"). This makes misconfigurations immediately apparent during testing.

### Step 2: Implement the Post-Call Analytics Webhook for Full Visibility

- **Problem:** We currently have no feedback mechanism. We send a configuration to ElevenLabs at the start of a call and hope for the best. We have no way to know what happened during the call, if errors occurred, or what the final transcript was.

- **The Fix:** I will implement the `POST /api/voice/elevenlabs-post-call` webhook as defined in the PRD. This is non-negotiable for an enterprise-grade system.
    1.  **Create Endpoint:** A new handler will be added to `src/api/voiceRoutes.ts` for `/elevenlabs-post-call`.
    2.  **HMAC Security:** The endpoint will be secured using HMAC SHA256 signature verification.
        -   It will expect a `elevenlabs-signature` header.
        -   It will use a new environment variable, `ELEVENLABS_WEBHOOK_SECRET`, to validate the signature. Any request without a valid signature will be rejected with a `401 Unauthorized`.
    3.  **Data Processing:** The handler will parse the JSON payload from ElevenLabs. Key fields to be processed include:
        -   `call_sid`
        -   `agent_id`
        -   `conversation_summary`
        -   `conversation` (the full transcript array)
        -   `analysis` (sentiment, etc.)
    4.  **Database Persistence:** The captured data will be upserted into our database.
        -   The `Conversation` table will be updated with the full transcript and metadata.
        -   The `CallLog` table will be updated with the `conversation_summary` and call `status`. This ensures the call history in the dashboard is immediately populated with rich data.

### Step 3: Enhance Context with `variables` and Premium Voice Settings

- **Problem:** The agent's prompts are currently static. To create a truly personalized and dynamic experience, the agent needs contextual variables it can reference. Furthermore, we are not enforcing a consistent, premium voice quality.

- **The Fix:** I will enhance the JSON response of the `/elevenlabs-personalization` webhook.
    1.  **Add `variables`:** The response object will now include a `variables` key. This object will pass critical, call-specific data directly to the ElevenLabs agent.
        ```json
        "variables": {
          "business_name": "Aurora Branding & Co.",
          "business_id": "clx...",
          "caller_id": "+1513...",
          "is_existing_client": true,
          "client_name": "John Doe"
        }
        ```
        This allows the system prompt stored in the database to be simplified, using placeholders like `You are an agent for {{business_name}}. The client's name is {{client_name}}.`. This is a powerful feature for creating dynamic, easily manageable prompts.

    2.  **Add `voice_settings`:** To ensure a consistent, high-quality audio experience, a default `voice_settings` object will be added to the response. This enforces our quality standards even if not explicitly configured per-agent.
        ```json
        "voice_settings": {
          "stability": 0.45,
          "similarity_boost": 0.85,
          "style": 0.3,
          "use_speaker_boost": true,
          "speed": 1.0
        }
        ```
        These values are chosen based on ElevenLabs' best practices for a balance of clarity and natural, conversational delivery.

### Step 4: Verify and Document Live Configuration

- **Problem:** It is possible the URLs configured in the ElevenLabs dashboard are incorrect. We need a foolproof way for you to verify this.

- **The Fix:**
    1.  **Create Debug Endpoint:** I will add a new, simple `GET /api/voice/webhook-test` endpoint. When visited in a browser, this will render a simple page displaying the exact, correct webhook URLs for the current environment.
    2.  **Action Required by You:** Once the fixes are deployed, you will need to perform this one-time check:
        -   Navigate to the new `/webhook-test` URL on your live application.
        -   Log into your **ElevenLabs Dashboard**.
        -   Go to **Conversational -> Your Agent**.
        -   In the **Webhooks** section, ensure the following URLs match *exactly* what is shown on the test page:
            -   **Personalization URL:** `https://<your-render-url>/api/voice/elevenlabs-personalization`
            -   **Post-call webhook URL:** `https://<your-render-url>/api/voice/elevenlabs-post-call`
        -   Set the **Post-call webhook secret** in the ElevenLabs dashboard. Ensure the *exact same value* is set as the `ELEVENLABS_WEBHOOK_SECRET` environment variable in Render.

This comprehensive plan will systematically resolve the current failures and establish the robust, observable, and high-quality voice infrastructure required for our product. 