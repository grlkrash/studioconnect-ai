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
    // Check various localhost scenarios
    const hostname = window.location.hostname;
    const isLocalhost = hostname === 'localhost' || 
                       hostname === '127.0.0.1' || 
                       hostname === '' || // file:// protocol
                       hostname.startsWith('192.168.') || // local network
                       hostname.startsWith('10.'); // local network
    
    // For development, always use localhost:3000
    if (isLocalhost || window.location.protocol === 'file:') {
      console.log('SMB Chat Widget: Using local API at http://localhost:3000');
      return 'http://localhost:3000';
    }
    
    // For production, update this with your actual production URL
    console.log('SMB Chat Widget: Using production API');
    return 'https://leads-support-agent.onrender.com';
  })();

  // State
  let conversationHistory = [];
  let isOpen = false;

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
    }

    .smb-chat-bubble:hover {
      transform: scale(1.05);
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
    }

    .smb-chat-bubble-icon {
      font-size: 28px;
      color: white;
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
    }

    .smb-chat-window.open {
      display: flex;
    }

    .smb-chat-header {
      background: #2563eb;
      color: white;
      padding: 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .smb-chat-header-title {
      font-size: 18px;
      font-weight: 600;
    }

    .smb-chat-close {
      background: none;
      border: none;
      color: white;
      font-size: 24px;
      cursor: pointer;
      padding: 0;
      width: 30px;
      height: 30px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: background 0.2s;
    }

    .smb-chat-close:hover {
      background: rgba(255, 255, 255, 0.2);
    }

    .smb-chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      background: #f9fafb;
    }

    .smb-chat-message {
      margin-bottom: 16px;
      display: flex;
      align-items: flex-start;
    }

    .smb-chat-message.user {
      justify-content: flex-end;
    }

    .smb-chat-message-content {
      max-width: 70%;
      padding: 12px 16px;
      border-radius: 12px;
      font-size: 14px;
      line-height: 1.5;
      word-wrap: break-word;
    }

    .smb-chat-message.user .smb-chat-message-content {
      background: #2563eb;
      color: white;
      border-bottom-right-radius: 4px;
    }

    .smb-chat-message.ai .smb-chat-message-content {
      background: white;
      color: #1f2937;
      border: 1px solid #e5e7eb;
      border-bottom-left-radius: 4px;
    }

    .smb-chat-input-area {
      padding: 20px;
      border-top: 1px solid #e5e7eb;
      background: white;
    }

    .smb-chat-input-wrapper {
      display: flex;
      gap: 10px;
    }

    .smb-chat-input {
      flex: 1;
      padding: 12px 16px;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s;
    }

    .smb-chat-input:focus {
      border-color: #2563eb;
    }

    .smb-chat-send {
      padding: 12px 20px;
      background: #2563eb;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s;
    }

    .smb-chat-send:hover {
      background: #1d4ed8;
    }

    .smb-chat-send:disabled {
      background: #9ca3af;
      cursor: not-allowed;
    }

    .smb-chat-typing {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 12px 16px;
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      border-bottom-left-radius: 4px;
      max-width: 60px;
    }

    .smb-chat-typing span {
      width: 8px;
      height: 8px;
      background: #9ca3af;
      border-radius: 50%;
      animation: typing 1.4s infinite;
    }

    .smb-chat-typing span:nth-child(2) {
      animation-delay: 0.2s;
    }

    .smb-chat-typing span:nth-child(3) {
      animation-delay: 0.4s;
    }

    @keyframes typing {
      0%, 60%, 100% {
        transform: translateY(0);
      }
      30% {
        transform: translateY(-10px);
      }
    }

    @media (max-width: 480px) {
      .smb-chat-window {
        width: 100%;
        height: 100%;
        bottom: 0;
        right: 0;
        border-radius: 0;
      }

      .smb-chat-bubble {
        bottom: 10px;
        right: 10px;
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
  chatBubble.innerHTML = '<span class="smb-chat-bubble-icon">💬</span>';

  const chatWindow = document.createElement('div');
  chatWindow.className = 'smb-chat-window';
  chatWindow.innerHTML = `
    <div class="smb-chat-header">
      <div class="smb-chat-header-title">AI Assistant</div>
      <button class="smb-chat-close">&times;</button>
    </div>
    <div class="smb-chat-messages" id="smb-chat-messages"></div>
    <div class="smb-chat-input-area">
      <div class="smb-chat-input-wrapper">
        <input 
          type="text" 
          class="smb-chat-input" 
          id="smb-chat-input" 
          placeholder="Type your message..."
        />
        <button class="smb-chat-send" id="smb-chat-send">Send</button>
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

  // Functions
  function toggleChat() {
    isOpen = !isOpen;
    if (isOpen) {
      chatWindow.classList.add('open');
      inputField.focus();
      
      // Show welcome message if first time
      if (conversationHistory.length === 0) {
        const welcomeMessage = "Hello! How can I help you today?";
        addMessageToChat(welcomeMessage, 'ai');
        // SAFEGUARD: Ensure content is always a string
        conversationHistory.push({ role: 'assistant', content: String(welcomeMessage) });
      }
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
    
    messageDiv.appendChild(contentDiv);
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
    console.log('Each message type check:');
    conversationHistory.forEach((msg, index) => {
      console.log(`[${index}] role: ${msg.role}, content type: ${typeof msg.content}, content:`, msg.content);
    });

    try {
      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: messageText,
          conversationHistory: conversationHistory,
          businessId: businessId
        })
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
        messageType: typeof data.message
      });
      
      // Remove typing indicator
      removeTypingIndicator();
      
      // Add AI response to chat
      const aiReply = data.response || data.reply || data.message || "I'm sorry, I couldn't process that request.";
      addMessageToChat(aiReply, 'ai');
      // SAFEGUARD: Ensure content is always a string
      conversationHistory.push({ role: 'assistant', content: String(aiReply) });

      // DEBUG: Log after adding AI response
      console.log('=== AFTER AI RESPONSE ===');
      console.log('AI Reply:', aiReply);
      console.log('Updated ConversationHistory:', JSON.stringify(conversationHistory, null, 2));

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