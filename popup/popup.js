const COLORS = [
  '#2563EB', '#7C3AED', '#0891B2', '#059669',
  '#D97706', '#DC2626', '#DB2777', '#65A30D',
];
function getColor(i) { return COLORS[i % COLORS.length]; }


let profiles          = [];
let activeProfileName = null;
let searchQuery       = '';
let renameTarget      = null;
let incognitoWindowId = null;
let addingAccount     = false;
let autoRefresh = { enabled: false, intervalMinutes: 10 };

let toastTimer = null;
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}


async function loadState() {
  const result = await chrome.storage.local.get(['profiles', 'activeProfile', 'autoRefresh']);
  profiles          = result.profiles    || [];
  activeProfileName = result.activeProfile || null;
  autoRefresh       = result.autoRefresh   || { enabled: false, intervalMinutes: 10 };
}

async function saveProfiles() {
  await chrome.storage.local.set({ profiles });
}

function updateShell() {
  const hasProfiles = profiles.length > 0;
  document.getElementById('onboarding').hidden      = hasProfiles;
  document.getElementById('statusBar').hidden       = !hasProfiles;
  document.getElementById('autoRefreshBar').hidden  = !hasProfiles;
  document.getElementById('searchWrap').hidden      = !hasProfiles;
  document.getElementById('footer').hidden          = !hasProfiles;
}


async function checkIncognitoAllowed() {
  return new Promise(resolve => {
    chrome.extension.isAllowedIncognitoAccess(resolve);
  });
}


function renderProfiles() {
  const list      = document.getElementById('profileList');
  const noResults = document.getElementById('noResults');

  const filtered = profiles.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  list.innerHTML   = '';
  noResults.hidden = true;

  if (profiles.length === 0) return;

  if (filtered.length === 0) {
    noResults.hidden = false;
    return;
  }

  filtered.forEach((profile, index) => {
    const isActive = profile.name === activeProfileName;
    const initials = profile.name.slice(0, 2).toUpperCase();
    const color    = profile.color || getColor(index);
    const meta     = profile.lastVerified
      ? `Verified ${timeAgo(profile.lastVerified)}`
      : profile.lastUsed
        ? `Used ${timeAgo(profile.lastUsed)}`
        : 'Never used';

    const card = document.createElement('div');
    card.className    = `profile-card${isActive ? ' active' : ''}`;
    card.dataset.name = profile.name;

    card.innerHTML = `
      <div class="profile-avatar" style="background:${color}">${initials}</div>
      <div class="profile-info">
        <div class="profile-name">${escapeHtml(profile.name)}</div>
        <div class="profile-meta">${meta}</div>
      </div>
      ${isActive ? '<span class="profile-pill active">Active</span>' : ''}
      ${profile.expired ? '<span class="profile-pill expired">Expired</span>' : ''}
      <div class="profile-actions">
        <button class="profile-action-btn" data-action="rename" data-name="${escapeHtml(profile.name)}" title="Rename">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M1 9.5L4 8.5 9.5 3 9 2.5 3.5 8 2.5 11z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
            <path d="M8.5 2L10 3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          </svg>
        </button>
        <button class="profile-action-btn" data-action="duplicate" data-name="${escapeHtml(profile.name)}" title="Duplicate">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="1" y="3" width="7" height="8" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
            <path d="M4 3V2a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-1" stroke="currentColor" stroke-width="1.2"/>
          </svg>
        </button>
        <button class="profile-action-btn danger" data-action="delete" data-name="${escapeHtml(profile.name)}" title="Delete">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 3.5h8M5 3.5V2.5h2v1M4.5 5v4M7.5 5v4M3 3.5l.5 6h5l.5-6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    `;

    card.addEventListener('click', e => {
      if (e.target.closest('.profile-actions')) return;
      switchToProfile(profile.name);
    });

    card.querySelectorAll('.profile-action-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const { action, name } = btn.dataset;
        if (action === 'rename')    openRenameModal(name);
        if (action === 'duplicate') duplicateProfile(name);
        if (action === 'delete')    deleteProfile(name);
      });
    });

    list.appendChild(card);
  });
}

function renderStatusBar() {
  const dot     = document.getElementById('statusDot');
  const text    = document.getElementById('statusText');
  const profile = profiles.find(p => p.name === activeProfileName);

  if (!profile) {
    dot.className    = 'status-dot';
    text.textContent = 'No active profile';
    return;
  }

  if (profile.expired) {
    dot.className    = 'status-dot expired';
    text.textContent = `${activeProfileName} — Expired`;
  } else {
    dot.className    = 'status-dot active';
    text.textContent = activeProfileName;
  }
}

function renderAutoRefreshBar() {
  const toggle   = document.getElementById('autoRefreshToggle');
  const select   = document.getElementById('autoRefreshInterval');
  const status   = document.getElementById('autoRefreshStatus');
 
  toggle.checked   = autoRefresh.enabled;
  select.value     = String(autoRefresh.intervalMinutes);
  select.disabled  = !autoRefresh.enabled;
  status.textContent = autoRefresh.enabled
    ? `every ${autoRefresh.intervalMinutes}m`
    : '';
}
 
async function applyAutoRefresh() {
  const toggle  = document.getElementById('autoRefreshToggle');
  const select  = document.getElementById('autoRefreshInterval');
 
  autoRefresh = {
    enabled:         toggle.checked,
    intervalMinutes: parseInt(select.value, 10)
  };
 
  await chrome.storage.local.set({ autoRefresh });
  await chrome.runtime.sendMessage({
    action:          'setAutoRefresh',
    enabled:         autoRefresh.enabled,
    intervalMinutes: autoRefresh.intervalMinutes
  });
 
  renderAutoRefreshBar();
  showToast(
    autoRefresh.enabled
      ? `Auto-refresh on — every ${autoRefresh.intervalMinutes}m`
      : 'Auto-refresh off',
    'info'
  );
}


async function saveCurrentSession() {
  const input = prompt('Profile name:', `Account ${profiles.length + 1}`);
  if (!input?.trim()) return;
  const name = input.trim();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab.url?.includes('claude.ai')) {
    showToast('Navigate to claude.ai first', 'error');
    return;
  }

  if (tab.url.includes('/login') || tab.url.includes('/logout')) {
    showToast('Log in fully before saving', 'error');
    return;
  }

  const cookies = await chrome.cookies.getAll({ domain: 'claude.ai' });
  if (cookies.length === 0) {
    showToast('No session found — are you logged in?', 'error');
    return;
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({
      localStorage:   { ...localStorage },
      sessionStorage: { ...sessionStorage }
    })
  });

  const storage       = results[0].result;
  const existingIndex = profiles.findIndex(p => p.name === name);
  const colorIndex    = existingIndex !== -1 ? existingIndex : profiles.length;

  const newProfile = {
    name,
    cookies,
    storage,
    color:        getColor(colorIndex),
    createdAt:    new Date().toISOString(),
    lastUsed:     new Date().toISOString(),
    lastVerified: new Date().toISOString(),
    expired:      false
  };

  if (existingIndex !== -1) {
    profiles[existingIndex] = newProfile;
  } else {
    profiles.push(newProfile);
  }

  await saveProfiles();
  await chrome.storage.local.set({ activeProfile: name });
  activeProfileName = name;
  chrome.runtime.sendMessage({ action: 'updateBadge', profileName: name });

  updateShell();
  renderProfiles();
  renderStatusBar();
  showToast(`"${name}" saved`, 'success');
}


async function addAccount() {
  const allowed = await checkIncognitoAllowed();
  if (!allowed) {
    document.getElementById('incognitoBanner').hidden = false;
    document.getElementById('incognitoHelpModal').hidden = false;
    return;
  }

  addingAccount = true;
  showAddingOverlay();

  try {
    const win = await chrome.windows.create({
      url:       'https://claude.ai',
      incognito: true,
      focused:   true,
      width:     1000,
      height:    700
    });

    incognitoWindowId = win.id;

    await waitForLoginInWindow(win.id);

    if (!addingAccount) return; 

    const tabs      = await chrome.tabs.query({ windowId: win.id });
    const incogTab  = tabs[0];
    if (!incogTab) throw new Error('Incognito tab not found');

    const cookieResult = await chrome.runtime.sendMessage({
      action: 'getIncognitoCookies',
      domain: 'claude.ai'
    });

    const cookies = cookieResult?.cookies || [];

    if (cookies.length === 0) {
      showToast('No session found — did you log in?', 'error');
      closeIncognitoWindow();
      hideAddingOverlay();
      return;
    }

    const storageResults = await chrome.scripting.executeScript({
      target: { tabId: incogTab.id },
      func: () => ({
        localStorage:   { ...localStorage },
        sessionStorage: { ...sessionStorage }
      })
    });

    const storage = storageResults[0].result;

    closeIncognitoWindow();
    hideAddingOverlay();

    const nameInput = prompt('Name this account:', `Account ${profiles.length + 1}`);
    if (!nameInput?.trim()) return;

    const name          = nameInput.trim();
    const existingIndex = profiles.findIndex(p => p.name === name);
    const colorIndex    = existingIndex !== -1 ? existingIndex : profiles.length;

    const newProfile = {
      name,
      cookies,
      storage,
      color:        getColor(colorIndex),
      createdAt:    new Date().toISOString(),
      lastUsed:     new Date().toISOString(),
      lastVerified: new Date().toISOString(),
      expired:      false
    };

    if (existingIndex !== -1) {
      profiles[existingIndex] = newProfile;
    } else {
      profiles.push(newProfile);
    }

    await saveProfiles();

    updateShell();
    renderProfiles();
    renderStatusBar();
    showToast(`"${name}" added`, 'success');

  } catch (err) {
    if (err.message === 'Cancelled') return;
    console.error('[ClaudeShift] Add account error:', err);
    showToast('Failed to add account: ' + err.message, 'error');
    closeIncognitoWindow();
    hideAddingOverlay();
  }
}


function waitForLoginInWindow(windowId) {
  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      if (!addingAccount) {
        clearInterval(interval);
        reject(new Error('Cancelled'));
        return;
      }

      try {
        const tabs = await chrome.tabs.query({ windowId });

        if (!tabs.length) {
          clearInterval(interval);
          reject(new Error('Window was closed'));
          return;
        }

        const tab = tabs[0];

        if (!tab.url?.includes('claude.ai')) return;
        if (tab.url.includes('/login') || tab.url.includes('/logout')) return;
        if (tab.status !== 'complete') return;

        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => ({
            loggedIn:
              document.querySelector('nav') !== null ||
              document.querySelector('[data-testid="conversation-list"]') !== null ||
              document.title.toLowerCase().includes('claude') &&
              !document.title.toLowerCase().includes('sign')
          })
        });

        if (results[0]?.result?.loggedIn) {
          clearInterval(interval);
          resolve();
        }
      } catch {
        
      }
    }, 1500);
  });
}


function closeIncognitoWindow() {
  if (incognitoWindowId) {
    chrome.windows.remove(incognitoWindowId).catch(() => {});
    incognitoWindowId = null;
  }
  addingAccount = false;
}


function showAddingOverlay() {
  let overlay = document.getElementById('addingOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id        = 'addingOverlay';
    overlay.className = 'adding-account-overlay';
    overlay.innerHTML = `
      <div class="adding-spinner"></div>
      <p class="adding-title">Waiting for login…</p>
      <p class="adding-sub">Log into your account in the incognito window that just opened. ClaudeShift will detect it automatically.</p>
      <button class="adding-cancel" id="cancelAddBtn">Cancel</button>
    `;
    document.body.appendChild(overlay);
    document.getElementById('cancelAddBtn').addEventListener('click', () => {
      addingAccount = false;
      closeIncognitoWindow();
      hideAddingOverlay();
    });
  }
  overlay.hidden = false;
}

function hideAddingOverlay() {
  const overlay = document.getElementById('addingOverlay');
  if (overlay) overlay.hidden = true;
}


async function switchToProfile(name) {
  if (name === activeProfileName) {
    showToast('Already on this profile', 'info');
    return;
  }

  const profile = profiles.find(p => p.name === name);
  if (!profile) return;

  const card = document.querySelector(`.profile-card[data-name="${CSS.escape(name)}"]`);
  if (card) {
    card.classList.add('switching');
    card.insertAdjacentHTML('beforeend', `
      <div class="profile-spinner">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" stroke-dasharray="28" stroke-dashoffset="10" opacity="0.3"/>
          <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </div>
    `);
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab.url?.includes('claude.ai')) {
      await chrome.tabs.update(tab.id, { url: 'about:blank' });
      await new Promise(r => setTimeout(r, 500));
    }

    const current = await chrome.cookies.getAll({ domain: 'claude.ai' });
    for (const c of current) {
      const domain = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
      await chrome.cookies.remove({
        url:  `https://${domain}${c.path || '/'}`,
        name: c.name
      }).catch(() => {});
    }

    for (const c of profile.cookies) {
      const domain = (c.domain || 'claude.ai').replace(/^\./, '');
      await chrome.cookies.set({
        url:      `https://${domain}${c.path || '/'}`,
        name:     c.name,
        value:    c.value,
        domain:   c.domain || 'claude.ai',
        path:     c.path || '/',
        secure:   c.secure !== false,
        httpOnly: c.httpOnly || false,
        sameSite: c.sameSite || 'lax'
      }).catch(() => {});
    }

    activeProfileName = name;
    const idx = profiles.findIndex(p => p.name === name);
    if (idx !== -1) {
      profiles[idx] = {
        ...profiles[idx],
        lastUsed: new Date().toISOString(),
        expired:  false
      };
    }

    await saveProfiles();
    await chrome.storage.local.set({ activeProfile: name });
    chrome.runtime.sendMessage({ action: 'updateBadge', profileName: name });

    await chrome.tabs.update(tab.id, { url: 'https://claude.ai' });

    renderProfiles();
    renderStatusBar();
    showToast(`Switched to "${name}"`, 'success');

  } catch (err) {
    console.error('[ClaudeShift] Switch error:', err);
    showToast('Switch failed: ' + err.message, 'error');
    if (card) card.classList.remove('switching');
  }
}


async function refreshCurrentSession() {
  if (!activeProfileName) { showToast('No active profile', 'info'); return; }

  const btn = document.getElementById('refreshBtn');
  btn.classList.add('spinning');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.url?.includes('claude.ai'))                            { showToast('Navigate to claude.ai first', 'info'); return; }
    if (tab.url.includes('/login') || tab.url.includes('/logout'))  { showToast('Log in fully first', 'error'); return; }

    const cookies = await chrome.cookies.getAll({ domain: 'claude.ai' });
    if (!cookies.length) { showToast('No session found', 'error'); return; }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({ localStorage: { ...localStorage }, sessionStorage: { ...sessionStorage } })
    });

    const idx = profiles.findIndex(p => p.name === activeProfileName);
    if (idx !== -1) {
      profiles[idx] = {
        ...profiles[idx],
        cookies,
        storage:      results[0].result,
        lastUsed:     new Date().toISOString(),
        lastVerified: new Date().toISOString(),
        expired:      false
      };
      await saveProfiles();
      renderProfiles();
      renderStatusBar();
      showToast('Session refreshed', 'success');
    }
  } catch (err) {
    showToast('Refresh failed: ' + err.message, 'error');
  } finally {
    btn.classList.remove('spinning');
  }
}


async function deleteProfile(name) {
  if (!confirm(`Delete "${name}"?`)) return;
  profiles = profiles.filter(p => p.name !== name);
  await saveProfiles();
  if (activeProfileName === name) {
    activeProfileName = null;
    await chrome.storage.local.remove('activeProfile');
    chrome.runtime.sendMessage({ action: 'updateBadge', profileName: null });
  }
  updateShell();
  renderProfiles();
  renderStatusBar();
  showToast(`"${name}" deleted`, 'info');
}


async function duplicateProfile(name) {
  const source = profiles.find(p => p.name === name);
  if (!source) return;
  let newName = `${name} (copy)`;
  let n = 2;
  while (profiles.some(p => p.name === newName)) newName = `${name} (copy ${n++})`;
  profiles.push({
    ...source,
    name:         newName,
    color:        getColor(profiles.length),
    createdAt:    new Date().toISOString(),
    lastUsed:     null,
    lastVerified: null,
    expired:      false
  });
  await saveProfiles();
  renderProfiles();
  showToast(`"${newName}" created`, 'success');
}


function openRenameModal(name) {
  renameTarget = name;
  const input  = document.getElementById('renameInput');
  input.value  = name;
  document.getElementById('renameModal').hidden = false;
  setTimeout(() => { input.focus(); input.select(); }, 50);
}

function closeRenameModal() {
  renameTarget = null;
  document.getElementById('renameModal').hidden = true;
}

async function confirmRename() {
  const newName = document.getElementById('renameInput').value.trim();
  if (!newName || !renameTarget) return;
  if (newName === renameTarget) { closeRenameModal(); return; }
  if (profiles.some(p => p.name === newName)) { showToast('Name already exists', 'error'); return; }

  const idx = profiles.findIndex(p => p.name === renameTarget);
  if (idx === -1) return;
  profiles[idx] = { ...profiles[idx], name: newName };

  if (activeProfileName === renameTarget) {
    activeProfileName = newName;
    await chrome.storage.local.set({ activeProfile: newName });
    chrome.runtime.sendMessage({ action: 'updateBadge', profileName: newName });
  }

  await saveProfiles();
  closeRenameModal();
  renderProfiles();
  renderStatusBar();
  showToast(`Renamed to "${newName}"`, 'success');
}


function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function timeAgo(dateStr) {
  if (!dateStr) return 'never';
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    const h = Math.floor(diff / 3600000);
    const d = Math.floor(diff / 86400000);
    if (m < 1)  return 'just now';
    if (m < 60) return `${m}m ago`;
    if (h < 24) return `${h}h ago`;
    return `${d}d ago`;
  } catch { return ''; }
}


document.addEventListener('DOMContentLoaded', async () => {
  await loadState();
  updateShell();
  renderProfiles();
  renderStatusBar();

  const allowed = await checkIncognitoAllowed();
  document.getElementById('incognitoBanner').hidden = allowed;

  document.getElementById('onboardingSaveBtn').addEventListener('click', saveCurrentSession);

  document.getElementById('addAccountBtn').addEventListener('click', addAccount);
  document.getElementById('saveBtn').addEventListener('click', saveCurrentSession);
  document.getElementById('refreshBtn').addEventListener('click', refreshCurrentSession);

  renderAutoRefreshBar();
 
  document.getElementById('autoRefreshToggle').addEventListener('change', applyAutoRefresh);
  document.getElementById('autoRefreshInterval').addEventListener('change', () => {
    if (autoRefresh.enabled) applyAutoRefresh();
    else {
      autoRefresh.intervalMinutes = parseInt(
        document.getElementById('autoRefreshInterval').value, 10
      );
      renderAutoRefreshBar();
    }
  });


  document.getElementById('searchInput').addEventListener('input', e => {
    searchQuery = e.target.value;
    renderProfiles();
  });

  document.getElementById('incognitoHelpBtn').addEventListener('click', () => {
    document.getElementById('incognitoHelpModal').hidden = false;
  });
  document.getElementById('helpCloseBtn').addEventListener('click', () => {
    document.getElementById('incognitoHelpModal').hidden = true;
  });
  document.getElementById('openExtensionsBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions' });
  });

  document.getElementById('renameCancelBtn').addEventListener('click', closeRenameModal);
  document.getElementById('renameConfirmBtn').addEventListener('click', confirmRename);
  document.getElementById('renameInput').addEventListener('keydown', e => {
    if (e.key === 'Enter')  confirmRename();
    if (e.key === 'Escape') closeRenameModal();
  });
  document.getElementById('renameModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeRenameModal();
  });
});