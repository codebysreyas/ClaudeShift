let loginCheckTimeout = null;

function isContextValid() {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

function safeSendMessage(msg) {
  if (!isContextValid()) return;
  try {
    chrome.runtime.sendMessage(msg).catch(() => {}); 
  } catch {
    observer.disconnect();
  }
}

function scheduleLoginCheck() {
  if (loginCheckTimeout) clearTimeout(loginCheckTimeout);
  loginCheckTimeout = setTimeout(checkAndReportLogin, 2000);
}

function checkAndReportLogin() {
  if (!isContextValid()) {
    observer.disconnect();
    return;
  }

  const isLoggedIn =
    document.querySelector('[data-testid="conversation-list"]') !== null ||
    document.querySelector('nav') !== null;

  if (!isLoggedIn) return;

  const emailEl =
    document.querySelector('[data-email]') ||
    document.querySelector('.user-email');

  const email = emailEl
    ? emailEl.textContent.trim() || emailEl.getAttribute('data-email')
    : null;

  safeSendMessage({
    action: 'loginDetected',
    email,
    timestamp: new Date().toISOString()
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'checkLogin') {
    checkAndReportLogin();
    sendResponse({ success: true });
  }

  if (message.action === 'getStorage') {
    sendResponse({
      localStorage:   { ...localStorage },
      sessionStorage: { ...sessionStorage }
    });
  }
});

const observer = new MutationObserver(scheduleLoginCheck);

if (document.body) {
  observer.observe(document.body, { childList: true, subtree: false });
} else {
  document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: false });
  });
}

checkAndReportLogin();