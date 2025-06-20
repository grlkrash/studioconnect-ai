# StudioConnect AI - Voice Pipeline Improvement Plan

This document outlines a detailed technical plan to enhance the voice agent's capabilities, enabling secure, context-aware interactions with clients and robust post-call automation.

---

## **Part 1: Critical Floor Requirements (Immediate Fixes)**

**Objective:** To ensure the voice agent is functionally reliable and meets the minimum standard of quality for any user interaction. The following are not enhancements; they are core requirements for a production-ready system.

### **1.1. Custom, High-Quality Voice & Greeting (MUST BE FIXED)**

*   **Problem:** The agent is currently using a generic, robotic voice and not the custom-configured voice and welcome message for the business. This is a critical failure.
*   **Requirement:**
    1.  The agent **MUST** use the specific `AgentConfig` for the business being called.
    2.  It **MUST** use the assigned ElevenLabs voice ID.
    3.  It **MUST** deliver the fully-configured, business-specific `voiceGreetingMessage`.
    4.  The voice **MUST** sound natural and conversational, as expected from ElevenLabs, not a disjointed, robotic default. There will be no silent fallbacks to low-quality TTS.
    5.  The entire welcome message **MUST** be played without being cut off.

### **1.2. Stable & Complete Call Handling (MUST BE FIXED)**

*   **Problem:** Calls are dropping immediately after the welcome message. The agent is not listening for or responding to the caller.
*   **Requirement:**
    1.  After delivering the welcome message, the agent **MUST** transition to a `LISTENING` state.
    2.  It **MUST** actively listen for the caller's response using the Speech-to-Text service.
    3.  It **MUST** process the user's speech and engage in a conversation, using the AI handler and configured tools.
    4.  The call **MUST NOT** end until the user hangs up, the conversation concludes naturally, or an escalation/transfer is triggered.

---

## **Part 2: Advanced Capabilities (Feature Enhancements)**

### **2.1. Inbound Call Handling & Dynamic Personalization**

**Goal:** The agent must answer calls with a personalized greeting specific to the business it represents.

**Current State:** The agent likely uses a generic welcome message.

**Technical Plan:**

1.  **Caller ID to Business Mapping:**
    *   When a call is received via Twilio, the `To` phone number (the number that was called) will be used to look up the corresponding `Business` in the database via the `twilio_phone` field.
    *   This lookup will happen at the very beginning of the call flow in `src/services/voiceSessionService.ts`.

2.  **Dynamic Welcome Message Generation:**
    *   Once the `Business` is identified, fetch its associated `AgentConfig` and `Business` details (e.g., `business.name`, `agentConfig.welcomeMessage`).
    *   The welcome message will be dynamically constructed. Leverage `src/utils/ssml.ts` to create a more natural-sounding and branded greeting using SSML (Speech Synthesis Markup Language).
    *   **Example:** `<speak>Hello, thank you for calling ${business.name}. I'm your AI assistant, ${agentConfig.agentName}. How can I help you today?</speak>`.

---

### **2.2. Secure, Context-Aware Information Retrieval**

**Goal:** Enable the agent to securely access and discuss project details from integrated Project Management (PM) tools like Asana, Jira, or Monday.com.

**Technical Plan:**

1.  **Caller & Project Verification (Security):**
    *   **Phase 1 (Simple Verification):** The agent will ask clarifying questions to identify the caller and project.
        *   *Agent:* "To get you the right information, could you please tell me your name and the project you're calling about?"
    *   **Phase 2 (Client Lookup):** Use the caller's phone number (`From` number in Twilio) to look up a matching `Client` in the database. If found, the agent can confirm:
        *   *Agent:* "Are you calling from The Apollo Team regarding Project Straus?"
    *   **This verification step is crucial** to prevent unauthorized access to project data.

2.  **Real-time Data Fetching from PM Integrations:**
    *   A new function, `getProjectUpdate(businessId: string, projectName: string): Promise<ProjectUpdatePayload>`, will be created in `src/services/integrationService.ts`.
    *   This function will:
        1.  Find the active `Integration` for the given `businessId`.
        2.  Call the appropriate provider-specific method (e.g., `jira.provider.ts`'s `getProjectUpdate`) using the unified `PMProvider` interface. The provider will be responsible for authenticating with the stored (and decrypted) tokens.
        3.  The provider method will query the PM tool's API for recent activity on the specified project (e.g., last 5 updated tasks, comments, status changes).
        4.  It will return a structured payload of the project status.

3.  **LLM-Powered Response Generation:**
    *   The data payload from `getProjectUpdate` will be passed to the Large Language Model (LLM) as context.
    *   The prompt sent to the LLM in `src/core/aiHandler.ts` will be carefully engineered.
    *   **Prompt Example:** `You are a helpful AI project assistant. A client is asking for an update on '${projectName}'. Based on the following data from ${integration.provider}, provide a concise, natural-language summary of the project's current status and timeline. Do not mention ticket numbers or internal jargon. Data: ${JSON.stringify(projectUpdatePayload)}`

---

### **3. Seamless Live Agent Escalation**

**Goal:** Allow the caller to be transferred to a human agent at any point during the conversation.

**Technical Plan:**

1.  **Tool Definition:** A new tool named `transferToHuman` will be defined for the agent. The LLM will be prompted to use this tool when the caller asks to speak to a person, expresses frustration, or asks a question beyond the agent's capabilities.

2.  **Call Transfer Logic:**
    *   When the `transferToHuman` tool is triggered, `realtimeAgentService.ts` will execute the transfer logic.
    *   It will retrieve a designated escalation phone number from the `Business` model (e.g., a new field `agent_escalation_number` or using `notification_phone`).
    *   The service will use the Twilio API to execute a "redirect" or "transfer" command, seamlessly connecting the caller to the human agent's line. The agent should provide a warm handoff message.
    *   **Agent Message:** "Of course. Please hold while I connect you to a member of our team."

---

### **4. Automated Post-Call Wrap-Up**

**Goal:** Automate the creation of call summaries, send email notifications, and update the dashboard analytics.

**Technical Plan:**

1.  **Triggering Post-Call Actions:**
    *   At the end of each call (`hangup` event), `voiceSessionService.ts` will trigger a series of asynchronous background jobs.

2.  **AI-Powered Call Summary:**
    *   A job will take the full call transcript, which must be saved to the `CallLog` entry.
    *   It will call the LLM with a specific prompt to generate a structured summary.
    *   **Prompt Example:** `Summarize the following call transcript. Identify the caller's name, the project discussed, the key discussion points, and list any action items for the team. Format the output as JSON with keys: "callerName", "project", "summary", "actionItems". Transcript: ${transcript}`
    *   The resulting JSON summary will be saved to the `CallLog.metadata` field.

3.  **Email Notification Service:**
    *   Another job will use the generated summary.
    *   It will call `src/services/notificationService.ts` to send a formatted HTML email.
    *   The email will be sent to the business's configured `notification_emails` and, if an email is on file for the client, to the client as well.

4.  **Dashboard Analytics Update:**
    *   The `CallLog` and `Interaction` tables will be updated with all relevant data from the call: the full transcript, the AI-generated summary, call duration, status (e.g., `COMPLETED`, `TRANSFERRED`), and any flagged events. This ensures the dashboard in `/calls` and `/interactions` is immediately updated.

5.  **Scope Creep Analysis (Advanced Feature):**
    *   An additional LLM-powered analysis can be added to the post-call workflow.
    *   **Concept:** This job would compare the call transcript against a stored "project scope" document or description associated with the `Project` model.
    *   **Prompt Example:** `Analyze the following transcript. The original project scope is: '${project.scope}'. Does the client's request deviate from this scope? If yes, flag it as 'Scope Creep' and explain the deviation. Transcript: ${transcript}`
    *   A `scope_creep: true` flag could be added to the `CallLog.metadata` for review in the dashboard. 