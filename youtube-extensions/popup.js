/*
==========================
POPUP.JS - DETAILED EXPLANATION
==========================

This file handles the logic for the popup window that appears 
when users click your extension icon.

WHAT IT DOES:
1. Loads saved settings (server URL)
2. Checks if Python backend is running
3. Saves new settings
4. Provides quick actions (open chat, test connection)

JAVASCRIPT CONCEPTS USED:
- chrome.storage API (saving/loading data)
- fetch API (HTTP requests)
- async/await (handling asynchronous operations)
- DOM manipulation (updating HTML)
- Event listeners (button clicks)
*/

// ==========================
// CONSTANTS & CONFIGURATION
// ==========================

/*
DEFAULT_SERVER_URL: Where your Python FastAPI server runs
- localhost: Your own computer (127.0.0.1)
- 8000: The port number (must match your Python server)
- If your server runs on different port, change this!
*/
const DEFAULT_SERVER_URL = 'http://localhost:8000';

/*
STORAGE_KEYS: Keys for Chrome's storage API
Think of it like keys in a dictionary:
  storage = { 'serverUrl': 'http://localhost:8000' }
*/
const STORAGE_KEYS = {
    SERVER_URL: 'serverUrl'
};

// ==========================
// DOM ELEMENTS
// ==========================

/*
We need to access HTML elements to:
- Read input values
- Update status text
- Handle button clicks

document.getElementById('id') finds an element with that ID
We store references so we don't have to find them repeatedly
*/

// Status display
const statusEl = document.getElementById('status');
const statusTextEl = document.getElementById('status-text');

// Input fields
const serverUrlInput = document.getElementById('server-url');

// Buttons
const saveSettingsBtn = document.getElementById('save-settings');
const openChatBtn = document.getElementById('open-chat');
const testConnectionBtn = document.getElementById('test-connection');


// ==========================
// INITIALIZATION
// ==========================

/*
This runs when popup opens
Like the main() function in Python

FLOW:
1. Load saved settings from Chrome storage
2. Fill input fields with saved values
3. Check if server is running
*/

// Wait for DOM to be ready before running code
document.addEventListener('DOMContentLoaded', async () => {
    /*
    DOMContentLoaded: Fires when HTML is fully loaded
    async: Allows us to use 'await' for asynchronous operations
    */
    
    console.log('Popup opened - initializing...');
    
    // Load saved settings
    await loadSettings();
    
    // Check server status
    await checkServerStatus();
    
    // Set up button click handlers
    setupEventListeners();
});


// ==========================
// SETTINGS MANAGEMENT
// ==========================

/**
 * Load settings from Chrome storage
 * 
 * WHAT IT DOES:
 * 1. Asks Chrome for saved data
 * 2. If found, fills input field
 * 3. If not found, uses default value
 * 
 * CHROME STORAGE API:
 * chrome.storage.sync = synced across devices (if user signed into Chrome)
 * chrome.storage.local = only on this device
 * 
 * We use 'sync' so settings work on all user's computers
 */
async function loadSettings() {
    try {
        /*
        chrome.storage.sync.get() is ASYNCHRONOUS
        That means it doesn't block - returns a Promise
        'await' pauses execution until Promise resolves
        
        It's like:
        Python: data = load_from_disk()
        JS: const data = await chrome.storage.sync.get(...)
        */
        const data = await chrome.storage.sync.get([STORAGE_KEYS.SERVER_URL]);
        
        /*
        data will look like:
        { serverUrl: 'http://localhost:8000' }
        or
        {} (empty if nothing saved)
        */
        
        // Get saved URL or use default
        const serverUrl = data[STORAGE_KEYS.SERVER_URL] || DEFAULT_SERVER_URL;
        
        // Fill input field
        serverUrlInput.value = serverUrl;
        
        console.log('Loaded settings:', { serverUrl });
    } catch (error) {
        console.error('Error loading settings:', error);
        // If error, just use default
        serverUrlInput.value = DEFAULT_SERVER_URL;
    }
}

/**
 * Save settings to Chrome storage
 * 
 * FLOW:
 * 1. Get value from input field
 * 2. Validate it's a valid URL
 * 3. Save to Chrome storage
 * 4. Show success message
 */
async function saveSettings() {
    try {
        // Get value from input
        const serverUrl = serverUrlInput.value.trim();
        
        // Validation: Must start with http:// or https://
        if (!serverUrl.startsWith('http://') && !serverUrl.startsWith('https://')) {
            alert('❌ Invalid URL. Must start with http:// or https://');
            return;
        }
        
        // Save to Chrome storage
        await chrome.storage.sync.set({
            [STORAGE_KEYS.SERVER_URL]: serverUrl
        });
        
        console.log('Settings saved:', { serverUrl });
        
        // Visual feedback
        saveSettingsBtn.textContent = '✅ Saved!';
        setTimeout(() => {
            saveSettingsBtn.textContent = '💾 Save Settings';
        }, 2000);
        
        // Recheck server status with new URL
        await checkServerStatus();
        
    } catch (error) {
        console.error('Error saving settings:', error);
        alert('❌ Failed to save settings. Please try again.');
    }
}


// ==========================
// SERVER CONNECTION
// ==========================

/**
 * Check if Python backend server is running
 * 
 * WHAT IT DOES:
 * 1. Sends HTTP GET request to server's health endpoint
 * 2. If response received → server is running ✅
 * 3. If error/timeout → server is down ❌
 * 
 * YOUR BACKEND:
 * The /health endpoint is already in your app.py!
 * Lines 132-149 in your code
 */
async function checkServerStatus() {
    // Get current server URL
    const serverUrl = serverUrlInput.value.trim();
    
    // Update UI to show we're checking
    updateStatus('checking', 'Checking server...');
    
    try {
        /*
        fetch() makes HTTP request
        Like: import requests; requests.get(url)
        
        We add timeout because we don't want to wait forever
        */
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
        
        // Try /health endpoint first
        let response = await fetch(`${serverUrl}/health`, {
            method: 'GET',
            signal: controller.signal // For timeout
        });
        
        // If /health fails with 404, try root endpoint
        if (response.status === 404) {
            console.log('/health not found, trying root endpoint /');
            response = await fetch(`${serverUrl}/`, {
                method: 'GET',
                signal: controller.signal
            });
        }
        
        clearTimeout(timeoutId);
        
        /*
        response.ok = true if status code 200-299
        response.status = the actual code (200, 404, 500, etc.)
        */
        if (response.ok) {
            const data = await response.json();
            updateStatus('connected', `✅ Server running (${data.active_chains || data.active_videos || 0} videos cached)`);
            console.log('Server health:', data);
        } else {
            throw new Error(`Server returned status ${response.status}`);
        }
        
    } catch (error) {
        /*
        Common errors:
        - AbortError: Timeout (server took too long)
        - TypeError: Network error (server not running)
        - Other: Various server errors
        */
        
        let message = '❌ Server not responding';
        
        if (error.name === 'AbortError') {
            message = '❌ Server timeout (is it running?)';
        } else if (error.message.includes('Failed to fetch')) {
            message = '❌ Cannot reach server. Is it running?';
        } else if (error.message.includes('404')) {
            message = '❌ Server running but endpoints not found. Check your app.py';
        }
        
        updateStatus('disconnected', message);
        console.error('Server check failed:', error);
    }
}

/**
 * Update status display in UI
 * 
 * @param {string} state - 'connected' | 'disconnected' | 'checking'
 * @param {string} message - Text to show
 */
function updateStatus(state, message) {
    // Remove all existing status classes
    statusEl.classList.remove('connected', 'disconnected', 'checking');
    
    // Add new status class
    statusEl.classList.add(state);
    
    // Update text
    statusTextEl.textContent = message;
}


// ==========================
// ACTION HANDLERS
// ==========================

/**
 * Open chat interface on current YouTube video
 * 
 * HOW IT WORKS:
 * 1. Get current active tab (YouTube video)
 * 2. Send message to content.js running on that tab
 * 3. content.js will show the chat interface
 */
async function openChatOnCurrentVideo() {
    try {
        // Get current active tab
        /*
        chrome.tabs.query() finds tabs matching criteria
        active: true = currently focused tab
        currentWindow: true = in this window (not another window)
        */
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!tab) {
            alert('❌ No active tab found');
            return;
        }
        
        // Check if it's a YouTube video page
        if (!tab.url || !tab.url.includes('youtube.com/watch')) {
            alert('⚠️ Please open a YouTube video first!');
            return;
        }
        
        // Send message to content script
        /*
        chrome.tabs.sendMessage() sends message to content.js
        Content script must be listening with chrome.runtime.onMessage
        */
        await chrome.tabs.sendMessage(tab.id, {
            action: 'OPEN_CHAT'
        });
        
        // Close popup (optional)
        window.close();
        
    } catch (error) {
        console.error('Error opening chat:', error);
        alert('❌ Failed to open chat. Make sure you\'re on a YouTube video page.');
    }
}

/**
 * Test connection button handler
 * Just calls checkServerStatus again
 */
async function testConnection() {
    testConnectionBtn.disabled = true;
    testConnectionBtn.textContent = '🔍 Testing...';
    
    await checkServerStatus();
    
    testConnectionBtn.disabled = false;
    testConnectionBtn.textContent = '🔍 Test Server Connection';
}


// ==========================
// EVENT LISTENERS
// ==========================

/**
 * Set up all button click handlers
 * 
 * addEventListener('click', function) runs function when button clicked
 * Like: button.on_click(function) in some GUI frameworks
 */
function setupEventListeners() {
    // Save settings button
    saveSettingsBtn.addEventListener('click', saveSettings);
    
    // Open chat button
    openChatBtn.addEventListener('click', openChatOnCurrentVideo);
    
    // Test connection button
    testConnectionBtn.addEventListener('click', testConnection);
    
    // Also allow Enter key in input field to save
    serverUrlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            saveSettings();
        }
    });
    
    console.log('Event listeners set up');
}


// ==========================
// UTILITY FUNCTIONS
// ==========================

/**
 * Format time ago (for future use)
 * Example: "2 minutes ago", "1 hour ago"
 */
function timeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    return `${Math.floor(seconds / 86400)} days ago`;
}


/*
==========================
KEY CONCEPTS SUMMARY
==========================

1. ASYNC/AWAIT:
   - Used for operations that take time (storage, network)
   - 'await' pauses until operation completes
   - Must be inside 'async' function

2. CHROME STORAGE:
   - chrome.storage.sync: Synced across devices
   - chrome.storage.local: Local only
   - Async API - always use await

3. FETCH API:
   - Makes HTTP requests
   - Returns Promise
   - Check response.ok before using data

4. EVENT LISTENERS:
   - element.addEventListener('event', callback)
   - Runs callback when event occurs
   - Common events: click, keypress, change

5. DOM MANIPULATION:
   - document.getElementById() - find element
   - element.textContent - change text
   - element.classList - add/remove CSS classes
   - element.value - get/set input value

==========================
DEBUGGING TIPS
==========================

1. Open popup, right-click, "Inspect"
   - Opens DevTools for popup
   - See console.log() messages
   - Check network requests

2. Check background page:
   - chrome://extensions/
   - Find your extension
   - Click "service worker"
   - See background.js logs

3. Common issues:
   - "Cannot read property of undefined" 
     → Element ID typo in HTML
   - "Failed to fetch"
     → Server not running
   - "storage.sync is undefined"
     → Not running in extension context
*/