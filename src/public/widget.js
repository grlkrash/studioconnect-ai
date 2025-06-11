(function() {
  'use strict';

  // Configuration - Get businessId from script tag
  const currentScript = document.currentScript || 
    Array.from(document.querySelectorAll('script')).find(script => 
      script.src && script.src.includes('widget.js')
    );
  
  const businessId = currentScript ? currentScript.getAttribute('data-business-id') : null;
  
  // Exit if no businessId found
  if (!businessId) {
    console.error('SMB Chat Widget: No business ID provided');
    return;
  }

  // Configuration
  const API_BASE_URL = (() => {
    // Try to get the API URL from the script tag's data attribute
    const apiUrl = currentScript ? currentScript.getAttribute('data-api-url') : null;
    
    if (apiUrl) {
      console.log('SMB Chat Widget: Using API URL from data attribute:', apiUrl);
      return apiUrl;
    }
    
    // If no data attribute, try to determine from script source
    if (currentScript && currentScript.src) {
      try {
        const scriptUrl = new URL(currentScript.src);
        const apiUrl = scriptUrl.origin; // This will be without trailing slash
        console.log('SMB Chat Widget: Using API URL from script source:', apiUrl);
        return apiUrl;
      } catch (e) {
        console.error('SMB Chat Widget: Error parsing script URL:', e);
      }
    }
    
    // Fallback to Render deployment server
    const renderUrl = 'https://leads-support-agent.onrender.com';
    console.log('SMB Chat Widget: Using fallback API URL:', renderUrl);
    return renderUrl;
  })();

  // State
  let conversationHistory = [];
  let isOpen = false;
  let currentFlowState = null; // Add flow state management
  let leadCaptureQuestions = []; // Cache of lead questions for flow detection
  let agentName = 'AI Assistant'; // Default agent name that can be updated from backend

  // Create CSS styles
  const styles = `
    .smb-chat-widget * {
      box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    .smb-chat-bubble {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 60px;
      height: 60px;
      background: #2563eb;
      border-radius: 50%;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9998;
      transition: transform 0.2s, box-shadow 0.2s;
      /* Enhanced AI animated glow */
      animation: ai-glow 2.5s ease-in-out infinite;
    }

    @keyframes ai-glow {
      0%, 100% {
        box-shadow:
          0 0 8px 2px #2563eb,
          0 0 24px 8px #9333ea66,
          0 0 40px 16px #ec489966,
          0 4px 12px rgba(0,0,0,0.15);
      }
      25% {
        box-shadow:
          0 0 12px 4px #9333ea,
          0 0 28px 12px #ec489966,
          0 0 44px 20px #2563eb66,
          0 4px 12px rgba(0,0,0,0.15);
      }
      50% {
        box-shadow:
          0 0 16px 6px #ec4899,
          0 0 32px 16px #2563eb66,
          0 0 48px 24px #9333ea66,
          0 4px 12px rgba(0,0,0,0.15);
      }
      75% {
        box-shadow:
          0 0 12px 4px #2563eb,
          0 0 28px 12px #9333ea66,
          0 0 44px 20px #ec489966,
          0 4px 12px rgba(0,0,0,0.15);
      }
    }

    /* Remove glow when chat is open */
    .smb-chat-window.open ~ .smb-chat-bubble,
    .smb-chat-bubble.open {
      animation: none !important;
      box-shadow: 0 4px 12px rgba(0,0,0,0.18);
    }

    .smb-chat-bubble-icon {
      width: 32px;
      height: 32px;
      fill: white;
    }

    .smb-chat-window {
      position: fixed;
      bottom: 90px;
      right: 20px;
      width: 380px;
      height: 600px;
      background: white;
      border-radius: 16px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
      display: none;
      flex-direction: column;
      z-index: 9999;
      overflow: hidden;
      transform: translateY(100%);
      transition: transform 0.3s ease-in-out;
    }

    .smb-chat-window.open {
      display: flex;
      transform: translateY(0);
    }

    .smb-chat-header {
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      color: white;
      padding: 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      box-shadow: 0 2px 10px rgba(37, 99, 235, 0.2);
    }

    .smb-chat-header-title {
      font-size: 18px;
      font-weight: 600;
      max-width: calc(100% - 50px);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .smb-chat-close {
      background: rgba(255, 255, 255, 0.1);
      border: none;
      color: white;
      font-size: 20px;
      cursor: pointer;
      padding: 8px;
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      transition: all 0.2s ease;
      font-weight: 500;
    }

    .smb-chat-close:hover {
      background: rgba(255, 255, 255, 0.2);
      transform: scale(1.05);
    }

    .smb-chat-close:active {
      transform: scale(0.95);
    }

    .smb-chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      background: #f8fafc;
    }

    .smb-chat-message {
      margin-bottom: 20px;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
    }

    .smb-chat-message.user {
      align-items: flex-end;
    }

    .smb-chat-message-content {
      max-width: 75%;
      padding: 14px 18px;
      border-radius: 18px;
      font-size: 14px;
      line-height: 1.5;
      word-wrap: break-word;
      position: relative;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
      backdrop-filter: blur(10px);
    }

    .smb-chat-message.user .smb-chat-message-content {
      background: linear-gradient(135deg, #2563eb 0%, #1e40af 100%);
      color: white;
      border-bottom-right-radius: 6px;
      box-shadow: 0 2px 8px rgba(37, 99, 235, 0.25);
    }

    .smb-chat-message.ai .smb-chat-message-content {
      background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
      color: #1f2937;
      border: 1px solid #e2e8f0;
      border-bottom-left-radius: 6px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }

    .smb-chat-timestamp {
      font-size: 11px;
      color: #64748b;
      margin-top: 4px;
      margin-bottom: 0;
      opacity: 0.8;
      font-weight: 400;
      letter-spacing: 0.025em;
      transition: opacity 0.2s ease;
    }

    .smb-chat-message:hover .smb-chat-timestamp {
      opacity: 1;
    }

    .smb-chat-message.user .smb-chat-timestamp {
      text-align: right;
      color: #64748b;
    }

    .smb-chat-message.ai .smb-chat-timestamp {
      text-align: left;
      color: #64748b;
    }

    .smb-chat-input-area {
      padding: 20px;
      border-top: 1px solid #e5e7eb;
      background: white;
    }

    .smb-chat-input-wrapper {
      display: flex;
      gap: 12px;
    }

    .smb-chat-input {
      flex: 1;
      padding: 14px 18px;
      border: 2px solid #e2e8f0;
      border-radius: 12px;
      font-size: 14px;
      outline: none;
      transition: all 0.2s ease;
      background: #f8fafc;
    }

    .smb-chat-input:focus {
      border-color: #2563eb;
      background: white;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
    }

    .smb-chat-send {
      padding: 14px 24px;
      background: linear-gradient(135deg, #2563eb 0%, #1e40af 100%);
      color: white;
      border: none;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 2px 4px rgba(37, 99, 235, 0.2);
      min-width: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .smb-chat-send-icon {
      font-size: 16px;
      transform: rotate(-45deg);
      transition: transform 0.2s ease;
    }

    .smb-chat-send:hover .smb-chat-send-icon {
      transform: rotate(-45deg) translateX(2px) translateY(-2px);
    }

    .smb-chat-send:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 8px rgba(37, 99, 235, 0.3);
    }

    .smb-chat-send:active {
      transform: translateY(0);
    }

    .smb-chat-send:active .smb-chat-send-icon {
      transform: rotate(-45deg) scale(0.95);
    }

    .smb-chat-send:disabled {
      background: #9ca3af;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }

    .smb-chat-send:disabled .smb-chat-send-icon {
      transform: rotate(-45deg);
    }

    .smb-chat-branding {
      font-size: 10px;
      text-align: center;
      padding: 8px 12px 4px 12px;
      color: #999;
      background: #fafafa;
      border-top: 1px solid #eee;
      display: none;
      line-height: 1.2;
    }

    .smb-chat-branding a {
      color: #777;
      text-decoration: none;
      font-weight: 500;
      transition: color 0.2s ease;
    }

    .smb-chat-branding a:hover {
      color: #2563eb;
      text-decoration: underline;
    }

    .smb-chat-typing {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 14px 18px;
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 18px;
      border-bottom-left-radius: 6px;
      max-width: 80px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
      animation: subtle-bounce 2s ease-in-out infinite;
    }

    @keyframes subtle-bounce {
      0%, 100% {
        transform: translateY(0);
      }
      50% {
        transform: translateY(-1px);
      }
    }

    .smb-chat-typing span {
      width: 6px;
      height: 6px;
      background: linear-gradient(135deg, #64748b 0%, #94a3b8 100%);
      border-radius: 50%;
      animation: typing-dots 1.6s ease-in-out infinite;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
    }

    .smb-chat-typing span:nth-child(1) {
      animation-delay: 0s;
    }

    .smb-chat-typing span:nth-child(2) {
      animation-delay: 0.3s;
    }

    .smb-chat-typing span:nth-child(3) {
      animation-delay: 0.6s;
    }

    @keyframes typing-dots {
      0%, 60%, 100% {
        transform: translateY(0) scale(1);
        opacity: 0.7;
      }
      30% {
        transform: translateY(-8px) scale(1.1);
        opacity: 1;
      }
    }

    @media (max-width: 480px) {
      .smb-chat-window {
        width: 100%;
        height: 85vh;
        bottom: 0;
        right: 0;
        border-radius: 16px 16px 0 0;
        position: fixed;
        top: auto;
        left: 0;
        margin: 0;
        padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
        transform: translateY(100%);
        transition: transform 0.3s ease-in-out;
      }

      .smb-chat-window.open {
        transform: translateY(0);
      }

      .smb-chat-bubble {
        bottom: calc(32px + env(safe-area-inset-bottom, 0px) + 48px);
        right: 16px;
        width: 56px;
        height: 56px;
        border: 2px solid #fff;
        background: #2563eb;
        /* Lighter but visible AI glow for mobile */
        animation: ai-glow-mobile 2.5s ease-in-out infinite;
      }
      @keyframes ai-glow-mobile {
        0%, 100% {
          box-shadow:
            0 0 6px 1px #2563eb,
            0 0 16px 4px #9333ea44,
            0 0 24px 8px #ec489944,
            0 2px 8px rgba(0,0,0,0.12);
        }
        50% {
          box-shadow:
            0 0 10px 2px #ec4899,
            0 0 20px 6px #2563eb44,
            0 0 28px 12px #9333ea44,
            0 2px 8px rgba(0,0,0,0.12);
        }
      }
      .smb-chat-window.open ~ .smb-chat-bubble,
      .smb-chat-bubble.open {
        animation: none !important;
        box-shadow: 0 4px 12px rgba(0,0,0,0.18);
      }

      .smb-chat-bubble-icon {
        width: 28px;
        height: 28px;
      }

      .smb-chat-header {
        padding: 16px;
        position: sticky;
        top: 0;
        z-index: 1;
      }

      .smb-chat-header-title {
        font-size: 16px;
      }

      .smb-chat-close {
        width: 32px;
        height: 32px;
        font-size: 18px;
      }

      .smb-chat-messages {
        padding: 16px;
        padding-bottom: calc(80px + env(safe-area-inset-bottom));
        max-height: calc(85vh - 140px);
      }

      .smb-chat-branding {
        font-size: 9px;
        padding: 6px 12px 3px 12px;
      }

      .smb-chat-input-area {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        padding: 16px;
        padding-bottom: calc(16px + env(safe-area-inset-bottom));
        background: white;
        border-top: 1px solid #e5e7eb;
        z-index: 2;
      }

      .smb-chat-input-wrapper {
        gap: 10px;
      }

      .smb-chat-input {
        padding: 12px 16px;
        font-size: 16px;
      }

      .smb-chat-send {
        padding: 12px 16px;
        white-space: nowrap;
        min-width: 44px;
      }

      .smb-chat-send-icon {
        font-size: 14px;
      }

      .smb-chat-message-content {
        max-width: 85%;
        font-size: 15px;
        padding: 12px 16px;
      }

      .smb-chat-message {
        margin-bottom: 16px;
      }

      .smb-chat-timestamp {
        font-size: 10px;
        margin-top: 3px;
      }

      .smb-chat-typing {
        max-width: 70px;
        padding: 12px 16px;
      }

      .smb-chat-typing span {
        width: 5px;
        height: 5px;
      }
    }

    /* Additional iOS-specific adjustments */
    @supports (-webkit-touch-callout: none) {
      .smb-chat-window {
        height: -webkit-fill-available;
      }

      .smb-chat-messages {
        height: calc(100% - 140px - env(safe-area-inset-bottom));
      }
    }
  `;

  // Inject styles
  const styleSheet = document.createElement('style');
  styleSheet.textContent = styles;
  document.head.appendChild(styleSheet);

  // Create HTML elements
  const chatBubble = document.createElement('div');
  chatBubble.className = 'smb-chat-bubble';
  
  // SVG office worker icon
  chatBubble.innerHTML = `
    <svg class="smb-chat-bubble-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white">
      <!-- Head -->
      <circle cx="12" cy="7" r="3.5"/>
      <!-- Body with shoulders -->
      <path d="M12 14c-4.5 0-8 2.5-8 5.5V22h16v-2.5c0-3-3.5-5.5-8-5.5z"/>
    </svg>
  `;

  const chatWindow = document.createElement('div');
  chatWindow.className = 'smb-chat-window';
  chatWindow.innerHTML = `
    <div class="smb-chat-header">
      <div class="smb-chat-header-title" id="smb-chat-header-title">${agentName}</div>
      <button class="smb-chat-close">&times;</button>
    </div>
    <div class="smb-chat-messages" id="smb-chat-messages"></div>
    <div class="smb-chat-branding" id="smb-chat-branding">
      Powered by <a href="https://cincyaisolutions.com" target="_blank">CincyAISolutions</a>
    </div>
    <div class="smb-chat-input-area">
      <div class="smb-chat-input-wrapper">
        <input 
          type="text" 
          class="smb-chat-input" 
          id="smb-chat-input" 
          placeholder="Type your message..."
        />
        <button class="smb-chat-send" id="smb-chat-send">
          <span class="smb-chat-send-icon">✈️</span>
        </button>
      </div>
    </div>
  `;

  // Append elements to body
  document.body.appendChild(chatBubble);
  document.body.appendChild(chatWindow);

  // Get references to elements
  const messagesArea = document.getElementById('smb-chat-messages');
  const inputField = document.getElementById('smb-chat-input');
  const sendButton = document.getElementById('smb-chat-send');
  const closeButton = chatWindow.querySelector('.smb-chat-close');
  const headerTitle = document.getElementById('smb-chat-header-title');

  // Functions
  function updateAgentName(name) {
    if (name && name.trim()) {
      agentName = name.trim();
      headerTitle.textContent = agentName;
      console.log('[Widget] Updated agent name to:', agentName);
    }
  }

  async function showWelcomeMessage() {
    try {
      // Make a minimal API call to get welcome message
      const relativePath = '/api/chat';
      const chatEndpoint = new URL(relativePath, API_BASE_URL).href;
      
      const response = await fetch(chatEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: '', // Empty message to trigger welcome
          conversationHistory: [],
          businessId: businessId
        })
      });

      if (response.ok) {
        const data = await response.json();
        
        // Use configured welcome message if available, otherwise use default
        let welcomeMessage = "Hey! How can I help you today?";
        if (data.configuredWelcomeMessage) {
          welcomeMessage = data.configuredWelcomeMessage;
          console.log('[Widget] Using configured welcome message:', welcomeMessage);
        }
        
        // Update agent name if provided
        if (data.agentName) {
          updateAgentName(data.agentName);
        }
        
        // Handle branding visibility
        const shouldShowBranding = data.showBranding;
        const brandingDiv = document.getElementById('smb-chat-branding');
        if (brandingDiv) {
          if (shouldShowBranding === true) {
            brandingDiv.style.display = 'block';
          } else {
            brandingDiv.style.display = 'none';
          }
        }
        
        addMessageToChat(welcomeMessage, 'ai');
        // SAFEGUARD: Ensure content is always a string
        conversationHistory.push({ role: 'assistant', content: String(welcomeMessage) });
        
      } else {
        // Fallback to default welcome message
        const defaultWelcome = "Hey! How can I help you today?";
        addMessageToChat(defaultWelcome, 'ai');
        conversationHistory.push({ role: 'assistant', content: String(defaultWelcome) });
      }
      
    } catch (error) {
      console.error('[Widget] Error loading welcome message:', error);
      // Fallback to default welcome message
      const defaultWelcome = "Hey! How can I help you today?";
      addMessageToChat(defaultWelcome, 'ai');
      conversationHistory.push({ role: 'assistant', content: String(defaultWelcome) });
    }
  }

  function toggleChat() {
    isOpen = !isOpen;
    if (isOpen) {
      chatWindow.classList.add('open');
      inputField.focus();
      
      // Show welcome message if first time
      if (conversationHistory.length === 0) {
        currentFlowState = null; // Reset flow state on new conversation
        showWelcomeMessage();
        
        // Ensure welcome message is visible
        setTimeout(() => {
          messagesArea.scrollTop = 0;
        }, 100);
      }
      setTimeout(scrollMessagesToBottom, 100)
    } else {
      chatWindow.classList.remove('open');
    }
  }

  function addMessageToChat(message, sender) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `smb-chat-message ${sender}`;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'smb-chat-message-content';
    contentDiv.textContent = message;
    
    // Create timestamp
    const timestampDiv = document.createElement('div');
    timestampDiv.className = 'smb-chat-timestamp';
    const now = new Date();
    timestampDiv.textContent = now.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    
    messageDiv.appendChild(contentDiv);
    messageDiv.appendChild(timestampDiv);
    messagesArea.appendChild(messageDiv);
    
    // Scroll to bottom
    messagesArea.scrollTop = messagesArea.scrollHeight;
  }

  function showTypingIndicator() {
    const typingDiv = document.createElement('div');
    typingDiv.className = 'smb-chat-message ai';
    typingDiv.id = 'typing-indicator';
    typingDiv.innerHTML = `
      <div class="smb-chat-typing">
        <span></span>
        <span></span>
        <span></span>
      </div>
    `;
    messagesArea.appendChild(typingDiv);
    messagesArea.scrollTop = messagesArea.scrollHeight;
  }

  function removeTypingIndicator() {
    const typingIndicator = document.getElementById('typing-indicator');
    if (typingIndicator) {
      typingIndicator.remove();
    }
  }

  // Add phone number validation function
  function isValidPhoneNumber(phone) {
    // Basic phone number validation (can be enhanced)
    const phoneRegex = /^\+?[\d\s-()]{10,}$/
    return phoneRegex.test(phone)
  }

  // Add phone number collection UI
  function showPhoneNumberInput() {
    const inputArea = document.querySelector('.smb-chat-input-area')
    const existingInput = document.querySelector('.smb-chat-input')
    const existingSend = document.querySelector('.smb-chat-send')
    
    // Create phone input container
    const phoneContainer = document.createElement('div')
    phoneContainer.className = 'smb-chat-phone-input'
    phoneContainer.style.cssText = `
      display: flex;
      gap: 8px;
      margin-top: 8px;
      padding: 8px;
      background: #f8fafc;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
    `
    
    // Create phone input
    const phoneInput = document.createElement('input')
    phoneInput.type = 'tel'
    phoneInput.placeholder = 'Enter your phone number'
    phoneInput.className = 'smb-chat-input'
    phoneInput.style.cssText = `
      flex: 1;
      padding: 12px;
      border: 2px solid #e2e8f0;
      border-radius: 8px;
      font-size: 14px;
    `
    
    // Create call button
    const callButton = document.createElement('button')
    callButton.className = 'smb-chat-send'
    callButton.innerHTML = 'Call Me'
    callButton.style.cssText = `
      padding: 12px 24px;
      background: linear-gradient(135deg, #2563eb 0%, #1e40af 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
    `
    
    // Add event listeners
    callButton.addEventListener('click', async () => {
      const phoneNumber = phoneInput.value.trim()
      
      if (!isValidPhoneNumber(phoneNumber)) {
        addMessageToChat('Please enter a valid phone number.', 'ai')
        return
      }
      
      // Show loading state
      callButton.disabled = true
      callButton.textContent = 'Initiating call...'
      
      try {
        // Call the initiate-call endpoint
        const response = await fetch(`${API_BASE_URL}/api/chat/initiate-call`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            phoneNumber,
            businessId,
            conversationHistory
          })
        })
        
        const data = await response.json()
        
        if (response.ok) {
          addMessageToChat('Great! I\'ve initiated the call. You should receive a call from our team shortly.', 'ai')
          // Remove phone input UI
          phoneContainer.remove()
          // Re-enable regular chat
          existingInput.disabled = false
          existingSend.disabled = false
        } else {
          throw new Error(data.error || 'Failed to initiate call')
        }
      } catch (error) {
        console.error('Error initiating call:', error)
        addMessageToChat('I apologize, but I\'m having trouble initiating the call. Please try again or contact us directly.', 'ai')
        // Remove phone input UI
        phoneContainer.remove()
        // Re-enable regular chat
        existingInput.disabled = false
        existingSend.disabled = false
      }
    })
    
    // Add elements to container
    phoneContainer.appendChild(phoneInput)
    phoneContainer.appendChild(callButton)
    
    // Add container to input area
    inputArea.insertBefore(phoneContainer, inputArea.firstChild)
    
    // Disable regular chat input
    existingInput.disabled = true
    existingSend.disabled = true
    
    // Focus phone input
    phoneInput.focus()
  }

  // Update sendMessageToApi to handle emergency escalation
  async function sendMessageToApi(messageText) {
    // Show typing indicator
    showTypingIndicator();
    
    // Disable input while sending
    inputField.disabled = true;
    sendButton.disabled = true;

    // DEBUG: Log conversationHistory before sending
    console.log('=== SENDING TO API ===');
    console.log('Message:', messageText);
    console.log('ConversationHistory:', JSON.stringify(conversationHistory, null, 2));
    console.log('Current Flow State:', currentFlowState);
    console.log('Each message type check:');
    conversationHistory.forEach((msg, index) => {
      console.log(`[${index}] role: ${msg.role}, content type: ${typeof msg.content}, content:`, msg.content);
    });

    try {
      // Use URL constructor for robust URL handling
      const relativePath = '/api/chat';
      const chatEndpoint = new URL(relativePath, API_BASE_URL).href;
      console.log('SMB Chat Widget: Constructed chat endpoint:', chatEndpoint);
      
      const bodyPayload = {
        message: messageText,
        conversationHistory: conversationHistory,
        businessId: businessId,
        currentFlow: currentFlowState // Include current flow state in request
      };

      const response = await fetch(chatEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bodyPayload)
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const data = await response.json();
      
      // DEBUG: Log API response
      console.log('=== API RESPONSE ===');
      console.log('Full response data:', data);
      console.log('Response fields:', {
        response: data.response,
        reply: data.reply,
        message: data.message,
        responseType: typeof data.response,
        replyType: typeof data.reply,
        messageType: typeof data.message,
        currentFlow: data.currentFlow,
        agentName: data.agentName
      });
      
      // Update agent name if provided in response
      if (data.agentName) {
        updateAgentName(data.agentName);
      }
      
      // Update flow state from response
      currentFlowState = data.currentFlow || null;
      console.log('[Widget] Updated currentFlowState from backend:', currentFlowState);
      
      // Handle branding visibility
      const shouldShowBranding = data.showBranding;
      const brandingDiv = document.getElementById('smb-chat-branding');
      if (brandingDiv) {
        if (shouldShowBranding === true) {
          brandingDiv.style.display = 'block';
        } else {
          brandingDiv.style.display = 'none';
        }
      }
      
      // Remove typing indicator
      removeTypingIndicator();
      
      // Add AI response to chat
      const aiReply = data.response || data.reply || data.message || "I'm sorry, I couldn't process that request.";
      addMessageToChat(aiReply, 'ai');
      // SAFEGUARD: Ensure content is always a string
      conversationHistory.push({ role: 'assistant', content: String(aiReply) });

      // DEFENSIVE LOGIC: Detect if AI response is a lead capture question
      // If the response looks like a question and we're not already in lead capture, set the flow
      if (!currentFlowState && isLikelyLeadCaptureQuestion(aiReply)) {
        console.log('[Widget] Detected lead capture question, setting flow state to LEAD_CAPTURE');
        currentFlowState = 'LEAD_CAPTURE';
      }

      // DEFENSIVE LOGIC: If we have conversation history that suggests lead capture flow
      if (!currentFlowState && shouldContinueLeadCapture()) {
        console.log('[Widget] Detected ongoing lead capture from conversation history');
        currentFlowState = 'LEAD_CAPTURE';
      }

      // DEBUG: Log after adding AI response
      console.log('=== AFTER AI RESPONSE ===');
      console.log('AI Reply:', aiReply);
      console.log('Final currentFlowState:', currentFlowState);
      console.log('Updated ConversationHistory:', JSON.stringify(conversationHistory, null, 2));

      // Handle emergency escalation
      if (data.nextAction === 'AWAITING_CALLBACK_CONFIRMATION') {
        // Check if user wants to be called
        const wantsCall = messageText.toLowerCase().includes('yes') || 
                         messageText.toLowerCase().includes('call') ||
                         messageText.toLowerCase().includes('please') ||
                         messageText.toLowerCase().includes('sure')
        
        if (wantsCall) {
          showPhoneNumberInput()
        }
      }

    } catch (error) {
      console.error('Error sending message:', error);
      removeTypingIndicator();
      
      const errorMessage = "I'm sorry, I'm having trouble connecting right now. Please try again later.";
      addMessageToChat(errorMessage, 'ai');
      // SAFEGUARD: Ensure content is always a string
      conversationHistory.push({ role: 'assistant', content: String(errorMessage) });
    } finally {
      // Re-enable input
      inputField.disabled = false;
      sendButton.disabled = false;
      inputField.focus();
    }
  }

  // Helper function to detect if a message is likely a lead capture question
  function isLikelyLeadCaptureQuestion(message) {
    const leadQuestionIndicators = [
      'what is your',
      'what\'s your',
      'best phone number',
      'phone number',
      'full name',
      'email',
      'timeline',
      'when is the best time',
      'scope of',
      'describe the situation',
      'how can I reach you',
      'contact information'
    ];
    
    const lowerMessage = message.toLowerCase();
    return leadQuestionIndicators.some(indicator => lowerMessage.includes(indicator)) && 
           message.includes('?');
  }

  // Helper function to detect if we should continue lead capture based on conversation history
  function shouldContinueLeadCapture() {
    if (conversationHistory.length < 2) return false;
    
    // Look for patterns: assistant asks question, user answers, assistant asks another question
    let questionCount = 0;
    for (let i = 0; i < conversationHistory.length; i++) {
      const entry = conversationHistory[i];
      if (entry.role === 'assistant' && isLikelyLeadCaptureQuestion(entry.content)) {
        questionCount++;
      }
    }
    
    // If we've seen multiple lead capture questions, we're likely in that flow
    return questionCount >= 2;
  }

  function handleSendMessage() {
    const messageText = inputField.value.trim();
    
    if (!messageText) {
      return;
    }

    // DEBUG: Log what we're about to add
    console.log('=== ADDING USER MESSAGE ===');
    console.log('Input field value:', inputField.value);
    console.log('Trimmed message:', messageText);
    console.log('Type of messageText:', typeof messageText);
    console.log('Current flow state before sending:', currentFlowState);

    // Add user message to chat
    addMessageToChat(messageText, 'user');
    
    // SAFEGUARD: Ensure content is always a string
    const safeContent = String(messageText);
    conversationHistory.push({ role: 'user', content: safeContent });
    
    // DEBUG: Log after adding
    console.log('ConversationHistory after adding:', JSON.stringify(conversationHistory, null, 2));
    
    // Clear input
    inputField.value = '';
    
    // Send to API
    sendMessageToApi(messageText);
  }

  // --- Keyboard-aware resizing for mobile ---
  function adjustChatWindowForKeyboard(isKeyboardOpen) {
    if (window.innerWidth > 600) return // Only on mobile
    if (!isKeyboardOpen) {
      chatWindow.style.height = ''
      messagesArea.style.maxHeight = ''
      return
    }
    // Use visualViewport if available for accurate height
    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight
    // Leave space for input area (approx 70px)
    chatWindow.style.height = vh + 'px'
    messagesArea.style.maxHeight = (vh - 110) + 'px'
  }

  // Always scroll messages to bottom
  function scrollMessagesToBottom() {
    messagesArea.scrollTop = messagesArea.scrollHeight
  }

  // --- Event listeners for keyboard ---
  inputField.addEventListener('focus', function() {
    adjustChatWindowForKeyboard(true)
    setTimeout(scrollMessagesToBottom, 100)
  })
  inputField.addEventListener('blur', function() {
    adjustChatWindowForKeyboard(false)
  })
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', function() {
      if (document.activeElement === inputField) adjustChatWindowForKeyboard(true)
    })
  }

  // Event listeners
  chatBubble.addEventListener('click', toggleChat);
  closeButton.addEventListener('click', toggleChat);
  sendButton.addEventListener('click', handleSendMessage);
  
  inputField.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });

})(); 