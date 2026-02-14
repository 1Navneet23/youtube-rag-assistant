/*
==========================
CONTENT.JS - COMPREHENSIVE GUIDE
==========================

This is the MOST IMPORTANT file for your extension.
It runs directly on YouTube video pages and:
1. Extracts the video ID from the URL
2. Adds a chat button to the YouTube interface
3. Creates and manages the chat UI
4. Sends questions to your Python backend
5. Displays AI responses

WHEN DOES THIS RUN?
- Automatically when you open a YouTube video
- manifest.json tells Chrome to inject this on youtube.com/watch* pages

JAVASCRIPT CONCEPTS:
- DOM manipulation (creating/modifying HTML)
- Event listeners
- Fetch API (HTTP requests to your backend)
- Chrome extension messaging
- MutationObserver (watching for YouTube's dynamic content)
*/

// ==========================
// CONFIGURATION & STATE
// ==========================

// Global state object - stores everything we need
const STATE = {
    videoId: null,              // Current YouTube video ID (11 characters)
    serverUrl: null,            // Backend URL from settings
    sessionId: 'default',       // Chat session ID (for multi-conversation support)
    isProcessing: false,        // Is video being processed?
    isChatOpen: false,          // Is chat UI visible?
    chatHistory: [],            // Array of {question, answer} objects
    processingStartTime: null   // For showing processing duration
};

// DOM element references (filled after creating UI)
const UI_ELEMENTS = {
    chatContainer: null,
    chatButton: null,
    messages: null,
    input: null,
    sendButton: null,
    closeButton: null,
    statusBar: null
};


// ==========================
// INITIALIZATION
// ==========================

/*
Main initialization function
Called when script first runs
*/
(async function init() {
    try {
        console.log('🚀 YouTube AI Chat extension loaded');
        
        // Step 1: Get video ID from URL
        STATE.videoId = extractVideoId();
        
        if (!STATE.videoId) {
            console.warn('⚠️ No video ID found in URL');
            return; // Exit if not on a video page
        }
        
        console.log('📺 Video ID:', STATE.videoId);
        
        // Step 2: Load settings from storage
        try {
            await loadSettings();
        } catch (error) {
            console.warn('⚠️ Could not load settings, using defaults:', error);
            STATE.serverUrl = 'http://localhost:8000';
        }
        
        // Step 3: Create chat button in YouTube interface
        try {
            await createChatButton();
        } catch (error) {
            console.error('❌ Failed to create chat button:', error);
            // Try again after a delay
            setTimeout(() => {
                createChatButton().catch(e => console.error('Retry failed:', e));
            }, 3000);
        }
        
        // Step 4: Set up message listener for popup communication
        try {
            setupMessageListener();
        } catch (error) {
            console.error('❌ Failed to setup message listener:', error);
        }
        
        // Step 5: Watch for YouTube navigation (uses history API)
        try {
            watchForNavigation();
        } catch (error) {
            console.error('❌ Failed to setup navigation watcher:', error);
        }
        
        console.log('✅ Extension initialized successfully');
    } catch (error) {
        console.error('❌ Critical error during initialization:', error);
    }
})();


// ==========================
// VIDEO ID EXTRACTION
// ==========================

/**
 * Extract YouTube video ID from URL
 * 
 * YouTube URLs look like:
 * - https://www.youtube.com/watch?v=dQw4w9WgXcQ
 * - https://youtu.be/dQw4w9WgXcQ
 * 
 * Video ID is always 11 characters: letters, numbers, dash, underscore
 * 
 * @returns {string|null} Video ID or null if not found
 */
function extractVideoId() {
    /*
    URLSearchParams: Built-in way to parse query strings
    Example: ?v=abc123&t=30s → { v: 'abc123', t: '30s' }
    */
    const urlParams = new URLSearchParams(window.location.search);
    const videoId = urlParams.get('v');
    
    // Validate: Video IDs are always exactly 11 characters
    if (videoId && videoId.length === 11) {
        return videoId;
    }
    
    return null;
}


// ==========================
// SETTINGS MANAGEMENT
// ==========================

/**
 * Load extension settings from Chrome storage
 * We need the server URL to send requests
 */
async function loadSettings() {
    try {
        const data = await chrome.storage.sync.get(['serverUrl']);
        STATE.serverUrl = data.serverUrl || 'http://localhost:8000';
        console.log('⚙️ Loaded settings:', { serverUrl: STATE.serverUrl });
    } catch (error) {
        console.error('Error loading settings:', error);
        STATE.serverUrl = 'http://localhost:8000'; // Fallback
    }
}


// ==========================
// UI CREATION
// ==========================

/**
 * Create and inject chat button into YouTube interface
 * 
 * CHALLENGE: YouTube's interface is dynamically loaded
 * We need to:
 * 1. Wait for the right elements to appear
 * 2. Find a good spot to insert our button
 * 3. Style it to match YouTube's design
 */
async function createChatButton() {
    /*
    YouTube's video page structure:
    #secondary - Right sidebar with recommended videos
    #primary - Main video area (where we want our button)
    
    We'll add button above the video title
    */
    
    // Wait for YouTube's interface to load
    await waitForElement('#above-the-fold');
    
    /*
    Create button element
    Think of it like:
    <button id="yt-ai-chat-btn" class="...">
        🤖 Ask AI about this video
    </button>
    */
    const button = document.createElement('button');
    button.id = 'yt-ai-chat-btn';
    button.className = 'yt-ai-chat-button';
    button.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/>
        </svg>
        <span>Ask AI about this video</span>
    `;
    
    // Add click handler
    button.addEventListener('click', toggleChat);
    
    // Find where to insert button
    const targetContainer = document.querySelector('#above-the-fold');
    if (targetContainer) {
        // Insert at the top
        targetContainer.insertBefore(button, targetContainer.firstChild);
        UI_ELEMENTS.chatButton = button;
        console.log('✅ Chat button created');
    } else {
        console.warn('⚠️ Could not find insertion point for button');
    }
}

/**
 * Create the chat interface (initially hidden)
 * 
 * This creates a floating chat window with:
 * - Header with title and close button
 * - Message area (scrollable)
 * - Input field
 * - Send button
 * - Status bar
 */
function createChatUI() {
    // Don't create if already exists
    if (UI_ELEMENTS.chatContainer) return;
    
    /*
    Create container div
    We'll inject this directly into the page's body
    */
    const container = document.createElement('div');
    container.id = 'yt-ai-chat-container';
    container.className = 'yt-ai-chat-container';
    
    // Build the HTML structure
    container.innerHTML = `
        <div class="yt-ai-chat-header">
            <h3>🤖 AI Chat</h3>
            <button class="yt-ai-close-btn" title="Close chat">×</button>
        </div>
        
        <div class="yt-ai-status-bar">
            <span class="status-indicator">●</span>
            <span class="status-text">Ready</span>
        </div>
        
        <div class="yt-ai-messages" id="yt-ai-messages">
            <!-- Messages will be added here dynamically -->
            <div class="yt-ai-welcome">
                👋 Hi! I can answer questions about this video.
                <br><br>
                Try asking:
                <ul>
                    <li>"What is the main topic?"</li>
                    <li>"Summarize the key points"</li>
                    <li>"What does the speaker say about X?"</li>
                </ul>
            </div>
        </div>
        
        <div class="yt-ai-input-area">
            <input 
                type="text" 
                id="yt-ai-input" 
                placeholder="Ask a question about this video..."
                maxlength="1000"
            >
            <button id="yt-ai-send-btn" class="yt-ai-send-btn">
                Send
            </button>
        </div>
    `;
    
    // Add to page
    document.body.appendChild(container);
    
    // Store references
    UI_ELEMENTS.chatContainer = container;
    UI_ELEMENTS.closeButton = container.querySelector('.yt-ai-close-btn');
    UI_ELEMENTS.messages = container.querySelector('#yt-ai-messages');
    UI_ELEMENTS.input = container.querySelector('#yt-ai-input');
    UI_ELEMENTS.sendButton = container.querySelector('#yt-ai-send-btn');
    UI_ELEMENTS.statusBar = container.querySelector('.yt-ai-status-bar');
    
    // Set up event listeners
    UI_ELEMENTS.closeButton.addEventListener('click', toggleChat);
    UI_ELEMENTS.sendButton.addEventListener('click', handleSendMessage);
    
    // Allow Enter key to send
    UI_ELEMENTS.input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });
    
    console.log('✅ Chat UI created');
}


// ==========================
// CHAT FUNCTIONALITY
// ==========================

/**
 * Toggle chat visibility (open/close)
 */
async function toggleChat() {
    // Create UI if it doesn't exist
    if (!UI_ELEMENTS.chatContainer) {
        createChatUI();
    }
    
    STATE.isChatOpen = !STATE.isChatOpen;
    
    if (STATE.isChatOpen) {
        // Show chat
        UI_ELEMENTS.chatContainer.classList.add('visible');
        UI_ELEMENTS.input.focus(); // Put cursor in input field
        
        // Process video if not already done
        if (!STATE.isProcessing) {
            await processVideo();
        }
    } else {
        // Hide chat
        UI_ELEMENTS.chatContainer.classList.remove('visible');
    }
}

/**
 * Handle send button click
 */
async function handleSendMessage() {
    const question = UI_ELEMENTS.input.value.trim();
    
    // Validation
    if (!question) return;
    if (question.length > 1000) {
        showError('Question too long (max 1000 characters)');
        return;
    }
    
    // Clear input
    UI_ELEMENTS.input.value = '';
    
    // Disable input while processing
    UI_ELEMENTS.input.disabled = true;
    UI_ELEMENTS.sendButton.disabled = true;
    
    // Add question to chat
    addMessageToChat('user', question);
    
    // Scroll to bottom
    scrollToBottom();
    
    try {
        // Call backend API
        const answer = await askQuestion(question);
        
        // Add answer to chat
        addMessageToChat('assistant', answer);
        
    } catch (error) {
        console.error('Error getting answer:', error);
        addMessageToChat('error', `❌ Error: ${error.message}`);
    } finally {
        // Re-enable input
        UI_ELEMENTS.input.disabled = false;
        UI_ELEMENTS.sendButton.disabled = false;
        UI_ELEMENTS.input.focus();
        scrollToBottom();
    }
}

/**
 * Add message to chat interface
 * 
 * @param {string} role - 'user' | 'assistant' | 'error' | 'system'
 * @param {string} content - Message text
 */
function addMessageToChat(role, content) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `yt-ai-message yt-ai-message-${role}`;
    
    // Format message with icon
    let icon = '';
    switch(role) {
        case 'user':
            icon = '👤';
            break;
        case 'assistant':
            icon = '🤖';
            break;
        case 'error':
            icon = '❌';
            break;
        case 'system':
            icon = 'ℹ️';
            break;
    }
    
    messageDiv.innerHTML = `
        <div class="message-icon">${icon}</div>
        <div class="message-content">${escapeHtml(content)}</div>
    `;
    
    // Remove welcome message if it exists
    const welcomeMsg = UI_ELEMENTS.messages.querySelector('.yt-ai-welcome');
    if (welcomeMsg) {
        welcomeMsg.remove();
    }
    
    UI_ELEMENTS.messages.appendChild(messageDiv);
}


// ==========================
// BACKEND API CALLS
// ==========================

/**
 * Process video (fetch transcript, create embeddings)
 * 
 * WHAT HAPPENS:
 * 1. Send video ID to /process-video endpoint
 * 2. Backend fetches YouTube transcript
 * 3. Backend creates vector embeddings
 * 4. Backend caches everything for fast queries
 * 
 * This is from your app.py lines 151-247
 */
async function processVideo() {
    try {
        STATE.isProcessing = true;
        updateStatus('processing', 'Processing video...');
        
        addMessageToChat('system', '⏳ Processing video transcript... This may take 30-60 seconds for first-time processing.');
        
        STATE.processingStartTime = Date.now();
        
        /*
        POST request to your backend
        Body: { video_id: 'dQw4w9WgXcQ' }
        */
        const response = await fetch(`${STATE.serverUrl}/process-video`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                video_id: STATE.videoId
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail?.message || 'Failed to process video');
        }
        
        const data = await response.json();
        const duration = ((Date.now() - STATE.processingStartTime) / 1000).toFixed(1);
        
        updateStatus('ready', `Ready (processed in ${duration}s)`);
        addMessageToChat('system', `✅ Video processed! You can now ask questions.`);
        
        console.log('✅ Video processed:', data);
        
    } catch (error) {
        console.error('Error processing video:', error);
        updateStatus('error', 'Processing failed');
        addMessageToChat('error', `Failed to process video: ${error.message}. Make sure your backend server is running.`);
    } finally {
        STATE.isProcessing = false;
    }
}

/**
 * Ask a question about the video
 * 
 * WHAT HAPPENS:
 * 1. Send question to /ask endpoint
 * 2. Backend retrieves relevant chunks from vector DB
 * 3. Backend loads chat history
 * 4. Backend sends to LLaMA model
 * 5. Returns AI-generated answer
 * 
 * This is your backend's /ask endpoint (POST)
 * 
 * @param {string} question - User's question
 * @returns {Promise<string>} AI's answer
 */
async function askQuestion(question) {
    updateStatus('thinking', '🤔 Thinking...');
    
    try {
        const response = await fetch(`${STATE.serverUrl}/ask`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                video_id: STATE.videoId,
                question: question,
                session_id: STATE.sessionId
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail?.message || 'Failed to get answer');
        }
        
        const data = await response.json();
        updateStatus('ready', 'Ready');
        
        // Store in history
        STATE.chatHistory.push({
            question: question,
            answer: data.answer,
            timestamp: Date.now()
        });
        
        return data.answer;
        
    } catch (error) {
        updateStatus('error', 'Error');
        throw error;
    }
}


// ==========================
// UI HELPERS
// ==========================

/**
 * Update status bar
 * 
 * @param {string} state - 'ready' | 'processing' | 'thinking' | 'error'
 * @param {string} text - Status text to display
 */
function updateStatus(state, text) {
    if (!UI_ELEMENTS.statusBar) return;
    
    const indicator = UI_ELEMENTS.statusBar.querySelector('.status-indicator');
    const textEl = UI_ELEMENTS.statusBar.querySelector('.status-text');
    
    // Remove all state classes
    indicator.classList.remove('ready', 'processing', 'thinking', 'error');
    
    // Add new state
    indicator.classList.add(state);
    textEl.textContent = text;
}

/**
 * Scroll chat messages to bottom
 */
function scrollToBottom() {
    if (UI_ELEMENTS.messages) {
        UI_ELEMENTS.messages.scrollTop = UI_ELEMENTS.messages.scrollHeight;
    }
}

/**
 * Show error message
 */
function showError(message) {
    addMessageToChat('error', message);
    scrollToBottom();
}

/**
 * Escape HTML to prevent XSS attacks
 * 
 * Important for security! If we don't escape, malicious content
 * could execute JavaScript in the user's browser.
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}


// ==========================
// UTILITY FUNCTIONS
// ==========================

/**
 * Wait for an element to appear in the DOM
 * YouTube loads content dynamically, so we need to wait
 * 
 * @param {string} selector - CSS selector
 * @param {number} timeout - Max wait time in ms
 * @returns {Promise<Element>}
 */
function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
        // Check if element already exists
        const element = document.querySelector(selector);
        if (element) {
            resolve(element);
            return;
        }
        
        /*
        MutationObserver: Watches for DOM changes
        Fires callback when elements are added/removed
        */
        const observer = new MutationObserver((mutations) => {
            const element = document.querySelector(selector);
            if (element) {
                observer.disconnect();
                resolve(element);
            }
        });
        
        observer.observe(document.body, {
            childList: true,      // Watch for added/removed nodes
            subtree: true         // Watch entire tree, not just direct children
        });
        
        // Timeout
        setTimeout(() => {
            observer.disconnect();
            reject(new Error(`Timeout waiting for ${selector}`));
        }, timeout);
    });
}

/**
 * Watch for YouTube navigation
 * 
 * YouTube is a Single Page App (SPA) - doesn't reload page when navigating
 * We need to detect when user goes to a different video
 */
function watchForNavigation() {
    let lastUrl = window.location.href;
    
    // Check every 500ms if URL changed
    setInterval(() => {
        const currentUrl = window.location.href;
        
        if (currentUrl !== lastUrl) {
            lastUrl = currentUrl;
            console.log('🔄 Navigation detected');
            
            // Reinitialize for new video
            const newVideoId = extractVideoId();
            if (newVideoId && newVideoId !== STATE.videoId) {
                console.log('📺 New video:', newVideoId);
                STATE.videoId = newVideoId;
                
                // Reset state
                STATE.chatHistory = [];
                STATE.isProcessing = false;
                
                // Close chat if open
                if (STATE.isChatOpen) {
                    toggleChat();
                }
                
                // Recreate button (YouTube might have destroyed it)
                createChatButton();
            }
        }
    }, 500);
}


// ==========================
// MESSAGE LISTENER
// ==========================

/**
 * Listen for messages from popup.js
 * 
 * This allows popup to trigger actions in content script
 * For example: "Open chat" button in popup
 */
function setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log('📨 Message received:', message);
        
        if (message.action === 'OPEN_CHAT') {
            if (!STATE.isChatOpen) {
                toggleChat();
            }
            sendResponse({ success: true });
        }
        
        return true; // Keep channel open for async response
    });
}


/*
==========================
KEY CONCEPTS SUMMARY
==========================

1. CONTENT SCRIPTS:
   - Run in the context of web pages
   - Can access and modify page DOM
   - Cannot access Chrome APIs directly (must message background script)
   - Have isolated JavaScript context (can't access page's JS variables)

2. DOM MANIPULATION:
   - document.createElement() - make new elements
   - element.appendChild() - add to page
   - element.querySelector() - find elements
   - element.classList - add/remove CSS classes
   - element.addEventListener() - handle events

3. ASYNC OPERATIONS:
   - await fetch() - HTTP requests
   - await chrome.storage - read storage
   - Promises & async/await for handling timing

4. MUTATION OBSERVER:
   - Watches for DOM changes
   - Useful for SPAs like YouTube
   - Can be expensive - use carefully

5. SECURITY:
   - Always escape user input (escapeHtml)
   - Validate data from server
   - Use HTTPS in production

==========================
DEBUGGING
==========================

1. Open YouTube video
2. Press F12 (DevTools)
3. Go to Console tab
4. Look for our console.log messages
5. Check Network tab for API calls
6. Inspect Elements tab to see our injected HTML

Common Issues:
- "Cannot read property of null"
  → Element not found (timing issue)
  → Use waitForElement()
  
- "Failed to fetch"
  → Backend server not running
  → Check server URL in settings
  
- Button not appearing
  → YouTube structure changed
  → Check selector in createChatButton()
*/