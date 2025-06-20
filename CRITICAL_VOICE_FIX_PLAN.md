# Critical Voice Agent Repair Plan

This document outlines the immediate, code-level actions required to fix the unacceptable failures in the voice agent pipeline.

---

## **Diagnosis**

Based on the server logs and user experience, there are two primary, critical failures:

1.  **Premature Call Termination:** The agent delivers a message and immediately disconnects. It never listens for the user's response. The logs show a `Twilio STOP event` immediately after the welcome message is supposedly sent. This points to a broken state machine in the agent's lifecycle.
2.  **Silent TTS Fallback:** Despite logs indicating that the correct ElevenLabs voice and message are being processed, the user hears a generic, robotic voice. This proves the system is silently failing to generate or stream the ElevenLabs audio and is falling back to a low-quality default TTS without logging the error.

---

## **3-Step Repair Plan**

### **Step 1: Fix Premature Call Termination**

*   **File to Modify:** `src/services/realtimeAgentService.ts`
*   **Problem:** The `handleWelcomeMessage` (or equivalent function) completes, and nothing holds the call open. The service doesn't transition into a listening state.
*   **Action:**
    1.  Locate the logic that executes after the welcome message audio is streamed to Twilio.
    2.  Immediately after the stream ends, explicitly transition the agent's state. I will add a call to a new function, `this.startListening()`.
    3.  This `startListening()` function will:
        *   Set an internal state flag, e.g., `this.state.isListening = true`.
        *   Ensure the Speech-to-Text (STT) service is active and processing inbound audio from the user.
        *   Crucially, it will prevent the service from shutting down the WebSocket connection, thus keeping the line open.
    4.  The agent will now wait for the user to speak. When the STT service transcribes user speech, it will be fed to the `aiHandler` for a conversational response.

---

### **Step 2: Eliminate Silent TTS Fallback & Force Correct Voice**

*   **Files to Modify:** `src/services/elevenlabs.ts` and the "Bulletproof" TTS wrapper service.
*   **Problem:** The ElevenLabs TTS generation is failing, but the error is being swallowed and a default TTS is used instead.
*   **Action:**
    1.  **Inject Hard-Failure Logging:** I will go into the core `elevenlabs.ts` service and wrap the API call to `elevenlabs.textToSpeech.generate` in a new, aggressive `try...catch` block.
    2.  **Remove Fallback:** The `catch` block will NOT attempt to use a fallback. It will log a detailed, critical error message specifying `ELEVENLABS_GENERATION_FAILED` with the voice ID, model, and the error message from the API.
    3.  **Throw Exception:** The `catch` block will then re-throw the error. This ensures that a failure in TTS generation is a fatal, logged event for that interaction, preventing the agent from proceeding with a bad voice. This will make it immediately obvious in the logs if the ElevenLabs API call is the source of the problem.
    4.  **Verify Audio Conversion:** I will add similar `try...catch` blocks around the `ffmpeg` command that converts the downloaded `.mp3` to `.ulaw`. If the conversion fails, it will also throw a fatal, logged error, preventing a corrupted or silent audio file from being sent.

---

### **Step 3: Harden Business ID Context**

*   **File to Modify:** `src/api/webhookRoutes.ts` (or equivalent file handling the initial Twilio webhook).
*   **Problem:** The `businessId` is not being passed in the WebSocket URL, forcing the agent to derive it later. This is fragile.
*   **Action:**
    1.  In the initial webhook handler that receives the call from Twilio (`/api/voice/calls`), I will immediately use the `To` phone number from the payload to look up the `Business`.
    2.  I will then append the `businessId` as a query parameter directly to the WebSocket URL provided in the TwiML response to Twilio.
    3.  **Example TwiML Change:**
        *   **Before:** `<Connect><Stream url="wss://.../"/></Connect>`
        *   **After:** `<Connect><Stream url="wss://.../?businessId=cmbwm1ne30001w4l6w858wkai"/></Connect>`
    4.  This ensures the WebSocket server knows the business context the moment the connection is established, making the entire pipeline more robust and initialization faster.

---

I will await your confirmation before applying these changes. This plan directly addresses the critical failures and will restore the voice agent to the required baseline of functionality. 