const ALARM_NAME = 'autoRefresh';

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  const result = await chrome.storage.local.get(['activeProfile', 'profiles', 'autoRefresh']);
  if (!result.autoRefresh?.enabled) return;

  const activeName = result.activeProfile;
  if (!activeName) return;

  const profiles = result.profiles || [];
  const idx = profiles.findIndex(p => p.name === activeName);
  if (idx === -1) return;

  const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' });
  const tab  = tabs.find(t =>
    !t.incognito &&
    !t.url.includes('/login') &&
    !t.url.includes('/logout')
  );

  if (!tab) return; 

  try {
    const cookies = await chrome.cookies.getAll({ domain: 'claude.ai' });
    if (!cookies.length) return;

    const storageResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        localStorage:   { ...localStorage },
        sessionStorage: { ...sessionStorage }
      })
    });

    profiles[idx] = {
      ...profiles[idx],
      cookies,
      storage:      storageResults[0].result,
      lastVerified: new Date().toISOString(),
      lastUsed:     new Date().toISOString(),
      expired:      false
    };

    await chrome.storage.local.set({ profiles });
    console.log(`[ClaudeShift] Auto-refreshed "${activeName}"`);
  } catch (err) {
    console.warn('[ClaudeShift] Auto-refresh failed:', err.message);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.action === 'updateBadge') {
    const name  = message.profileName;
    const label = name ? name.slice(0, 2).toUpperCase() : '';
    chrome.action.setBadgeText({ text: label });
    chrome.action.setBadgeBackgroundColor({ color: name ? '#2563EB' : '#9ca3af' });
    sendResponse({ ok: true });
    return;
  }

  if (message.action === 'setAutoRefresh') {
    const { enabled, intervalMinutes } = message;
    chrome.alarms.clear(ALARM_NAME, () => {
      if (enabled && intervalMinutes > 0) {
        chrome.alarms.create(ALARM_NAME, {
          delayInMinutes:  intervalMinutes,
          periodInMinutes: intervalMinutes
        });
      }
    });
    sendResponse({ ok: true });
    return;
  }

  if (message.action === 'getIncognitoCookies') {
    chrome.cookies.getAllCookieStores(stores => {
      const incognitoStore = stores.find(s => s.id !== '0');
      if (!incognitoStore) {
        sendResponse({ cookies: [], error: 'No incognito store found' });
        return;
      }
      chrome.cookies.getAll({
        domain:  message.domain,
        storeId: incognitoStore.id
      }, cookies => {
        sendResponse({ cookies });
      });
    });
    return true; 
  }

  if (message.action === 'loginDetected') {
    sendResponse({ ok: true });
    return;
  }

});