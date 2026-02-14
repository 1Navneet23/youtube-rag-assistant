/*
==========================
BACKGROUND.JS - SERVICE WORKER
==========================

WHAT IS A SERVICE WORKER?
- Runs in the background (not attached to any specific page)
- Starts when Chrome starts
- Can receive messages from popup and content scripts
- Can make network requests
- Has access to Chrome APIs

WHAT WE USE IT FOR:
- Managing state across extension components
- Handling installation/updates
- Optional: Periodic server health checks
- Message routing between popup and content scripts

SERVICE WORKER LIFECYCLE:
1. Installed: First time extension loaded
2. Activated: Ready to handle events
3. Idle: Sleeps when not needed (saves resources)
4. Terminated: Chrome kills it after inactivity
5. Wakes up: When event occurs (message, alarm, etc.)

IMPORTANT: Service workers are STATELESS
- Don't store data in variables (might be terminated)
- Use chrome.storage for persistence
*/

// ==========================
// STATE MANAGEMENT
// ==========================

/*
We can't use regular variables because service worker might restart
But we can use this for temporary runtime state between events
*/
const RuntimeState = {
    serverUrl: 'http://localhost:8000',
    lastHealthCheck: null
};

// ==========================
// INSTALLATION
// ==========================

/*
chrome.runtime.onInstalled
Fires when:
- Extension is first installed
- Extension is updated
- Chrome is updated
*/
chrome.runtime.onInstalled.addListener((details) => {
    console.log('🎉 Extension installed!', details);
    
    /*
    details.reason can be:
    - "install": First time installation
    - "update": Extension updated
    - "chrome_update": Chrome browser updated
    - "shared_module_update": Shared module updated
    */
    
    if (details.reason === 'install') {
        // First time setup
        console.log('👋 Welcome! Setting up defaults...');
        
        // Set default settings
        chrome.storage.sync.set({
            serverUrl: 'http://localhost:8000',
            installDate: Date.now()
        });
        
        // Optional: Open welcome page
        // chrome.tabs.create({ url: 'welcome.html' });
    } 
    else if (details.reason === 'update') {
        console.log('✨ Extension updated to version', chrome.runtime.getManifest().version);
        
        // Handle migrations if needed
        // Example: if old version used different storage format
    }
});

// ==========================
// MESSAGING SYSTEM
// ==========================

/*
chrome.runtime.onMessage
Receives messages from:
- Content scripts (content.js)
- Popup (popup.js)
- Other extension pages

MESSAGE FORMAT:
{
    action: 'ACTION_NAME',
    data: { ... }
}
*/
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('📨 Background received message:', message);
    console.log('📤 From:', sender.tab ? `Tab ${sender.tab.id}` : 'Extension page');
    
    /*
    IMPORTANT: Return true to keep message channel open for async responses
    If you forget this and use await, Chrome will disconnect before response sent
    */
    
    // Route message to appropriate handler
    switch (message.action) {
        case 'CHECK_SERVER':
            handleCheckServer(sendResponse);
            return true; // Async response
            
        case 'GET_STATE':
            sendResponse({ state: RuntimeState });
            break;
            
        case 'UPDATE_SERVER_URL':
            RuntimeState.serverUrl = message.data.serverUrl;
            sendResponse({ success: true });
            break;
            
        default:
            console.warn('⚠️ Unknown message action:', message.action);
            sendResponse({ error: 'Unknown action' });
    }
});

/**
 * Handle server health check request
 * 
 * @param {Function} sendResponse - Callback to send response
 */
async function handleCheckServer(sendResponse) {
    try {
        // Load server URL from storage
        const data = await chrome.storage.sync.get(['serverUrl']);
        const serverUrl = data.serverUrl || 'http://localhost:8000';
        
        // Make health check request
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const response = await fetch(`${serverUrl}/health`, {
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
            const healthData = await response.json();
            RuntimeState.lastHealthCheck = Date.now();
            
            sendResponse({
                success: true,
                online: true,
                data: healthData
            });
        } else {
            sendResponse({
                success: true,
                online: false,
                error: `Server returned status ${response.status}`
            });
        }
        
    } catch (error) {
        console.error('❌ Health check failed:', error);
        sendResponse({
            success: true,
            online: false,
            error: error.message
        });
    }
}

// ==========================
// ALARMS (OPTIONAL)
// ==========================

/*
Chrome Alarms: Scheduled tasks that can wake up service worker

Use cases:
- Periodic server health checks
- Clean up old data
- Sync settings

NOTE: Requires "alarms" permission in manifest.json
*/

// Uncomment to enable periodic health checks
/*
// Create alarm on startup
chrome.runtime.onStartup.addListener(() => {
    // Check server every 5 minutes
    chrome.alarms.create('healthCheck', {
        delayInMinutes: 1,
        periodInMinutes: 5
    });
});

// Handle alarm
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'healthCheck') {
        console.log('⏰ Running scheduled health check');
        handleCheckServer((result) => {
            console.log('Health check result:', result);
        });
    }
});
*/

// ==========================
// TAB MANAGEMENT (OPTIONAL)
// ==========================

/*
Track which tabs have our extension active
Useful for managing resources

NOTE: Requires "tabs" permission in manifest.json
*/

// Track tabs where extension is active
const activeTabs = new Set();

/*
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // When tab finishes loading
    if (changeInfo.status === 'complete' && tab.url) {
        // Check if it's a YouTube video page
        if (tab.url.includes('youtube.com/watch')) {
            activeTabs.add(tabId);
            console.log(`✅ Extension active on tab ${tabId}`);
        }
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    activeTabs.delete(tabId);
    console.log(`❌ Tab ${tabId} closed, removed from tracking`);
});
*/

// ==========================
// ERROR HANDLING
// ==========================

/*
Global error handler
Catches unhandled errors in service worker
*/
self.addEventListener('error', (event) => {
    console.error('❌ Service worker error:', event.error);
    
    // Optional: Send to error tracking service
    // reportError(event.error);
});

self.addEventListener('unhandledrejection', (event) => {
    console.error('❌ Unhandled promise rejection:', event.reason);
});

// ==========================
// STARTUP
// ==========================

/*
chrome.runtime.onStartup
Fires when:
- Chrome starts (if extension was enabled)
- User logs into ChromeOS

Doesn't fire when extension first installed (use onInstalled for that)
*/
chrome.runtime.onStartup.addListener(() => {
    console.log('🚀 Chrome started, service worker active');
    
    // Load settings
    chrome.storage.sync.get(['serverUrl'], (data) => {
        RuntimeState.serverUrl = data.serverUrl || 'http://localhost:8000';
        console.log('⚙️ Loaded server URL:', RuntimeState.serverUrl);
    });
});

// ==========================
// BROWSER ACTION (OPTIONAL)
// ==========================

/*
chrome.action.onClicked
Fires when extension icon clicked (if no popup defined)

We have popup.html, so this won't fire
But if you remove default_popup from manifest.json, this will work
*/

/*
chrome.action.onClicked.addListener((tab) => {
    console.log('🖱️ Extension icon clicked on tab:', tab.id);
    
    // Example: Send message to content script
    chrome.tabs.sendMessage(tab.id, {
        action: 'TOGGLE_CHAT'
    });
});
*/

// ==========================
// CONTEXT MENUS (OPTIONAL)
// ==========================

/*
Add right-click menu options

NOTE: Requires "contextMenus" permission in manifest.json
*/

/*
chrome.runtime.onInstalled.addListener(() => {
    // Create context menu item
    chrome.contextMenus.create({
        id: 'askAboutSelection',
        title: 'Ask AI about: "%s"',
        contexts: ['selection'], // Show when text is selected
        documentUrlPatterns: ['https://www.youtube.com/*']
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'askAboutSelection') {
        console.log('📝 Selected text:', info.selectionText);
        
        // Send to content script
        chrome.tabs.sendMessage(tab.id, {
            action: 'ASK_QUESTION',
            question: info.selectionText
        });
    }
});
*/

// ==========================
// STORAGE CHANGES
// ==========================

/*
Listen for changes to Chrome storage
Useful for syncing state across extension components
*/
chrome.storage.onChanged.addListener((changes, areaName) => {
    console.log('💾 Storage changed:', { changes, areaName });
    
    // Update runtime state if server URL changed
    if (changes.serverUrl) {
        RuntimeState.serverUrl = changes.serverUrl.newValue;
        console.log('🔄 Server URL updated to:', RuntimeState.serverUrl);
    }
});

// ==========================
// LOGGING & DEBUGGING
// ==========================

/*
Log service worker lifecycle events
Helps debug issues with service worker being terminated
*/
console.log('🎬 Service worker script executed');
console.log('📦 Extension version:', chrome.runtime.getManifest().version);

// Check if service worker is persistent (should be false in MV3)
console.log('⚡ Persistent:', chrome.runtime.getManifest().background?.persistent ?? false);


/*
==========================
KEY CONCEPTS SUMMARY
==========================

1. SERVICE WORKER LIFECYCLE:
   - Installed → Activated → Idle ⇄ Active → Terminated
   - Can be terminated at any time to save resources
   - Wakes up when events occur
   - Must complete work quickly (5 minutes max)

2. MESSAGING:
   - chrome.runtime.onMessage: Receive from anywhere
   - chrome.tabs.sendMessage: Send to content script
   - chrome.runtime.sendMessage: Send to background/popup
   - Use callbacks or return true for async responses

3. STORAGE:
   - Don't use variables for persistent state
   - Use chrome.storage.sync or chrome.storage.local
   - Storage survives service worker termination

4. ALARMS:
   - For periodic tasks
   - Wakes up service worker
   - More efficient than setInterval

5. PERMISSIONS:
   - Each Chrome API requires permission in manifest
   - Only request what you need
   - Users see permission requests

==========================
DEBUGGING
==========================

To debug service worker:
1. Go to chrome://extensions/
2. Enable "Developer mode"
3. Find your extension
4. Click "service worker" link
5. DevTools opens showing console logs

Common Issues:
- "Service worker terminated"
  → Normal! It restarts when needed
  → Don't rely on variables persisting

- "Could not establish connection"
  → Content script not loaded yet
  → Add error handling

- Messages not received
  → Check message format
  → Return true for async responses
  → Check both sender and receiver logs

==========================
BEST PRACTICES
==========================

1. Keep service worker lightweight
   - Do minimal work
   - Delegate heavy tasks to content scripts

2. Use alarms instead of timers
   - chrome.alarms.create() not setInterval()
   - More battery efficient

3. Handle termination gracefully
   - Save state to storage
   - Don't assume worker stays alive

4. Test thoroughly
   - Service worker might restart anytime
   - Test after idle periods
   - Test after Chrome restart

5. Error handling
   - Wrap async code in try-catch
   - Log errors for debugging
   - Provide fallbacks
*/