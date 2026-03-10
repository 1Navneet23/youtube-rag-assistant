console.log('Popup.js loaded');

// Wait for DOM to be ready
function initPopup() {
  console.log('Initializing popup');
  
  const apiUrlInput = document.getElementById('api-url');
  const saveBtn = document.getElementById('save-btn');
  const statusEl = document.getElementById('status');
  
  console.log('Elements found:', {
    apiUrlInput: !!apiUrlInput,
    saveBtn: !!saveBtn,
    statusEl: !!statusEl
  });
  
  // Load saved settings
  chrome.storage.local.get(['apiUrl'], (result) => {
    console.log('Loaded from storage:', result);
    if (result.apiUrl && apiUrlInput) {
      apiUrlInput.value = result.apiUrl;
      console.log('Set input value to:', result.apiUrl);
    }
  });
  
  // Save settings
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      console.log('Save button clicked!');
      
      const apiUrl = apiUrlInput.value.trim();
      console.log('API URL to save:', apiUrl);
      
      if (!apiUrl) {
        showStatus('Please enter a valid API URL', 'error');
        return;
      }
      
      // Remove trailing slash
      const cleanUrl = apiUrl.replace(/\/$/, '');
      console.log('Clean URL:', cleanUrl);
      
      // Save to storage
      chrome.storage.local.set({ apiUrl: cleanUrl }, () => {
        console.log('Saved to storage!');
        
        // Verify it was saved
        chrome.storage.local.get(['apiUrl'], (result) => {
          console.log('Verification - stored value:', result.apiUrl);
        });
        
        showStatus('Settings saved! Refresh YouTube page to apply.', 'success');
      });
    });
    
    console.log('Click listener attached');
  } else {
    console.error('Save button not found!');
  }
  
  // Show status message
  function showStatus(message, type) {
    console.log('Showing status:', message, type);
    if (statusEl) {
      statusEl.textContent = message;
      statusEl.className = `status ${type}`;
      
      setTimeout(() => {
        statusEl.className = 'status';
      }, 3000);
    }
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPopup);
} else {
  initPopup();
}