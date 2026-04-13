// lib/storage-manager.js

const DB_KEY = 'scrapeSessions';
const KEYWORDS_KEY = 'keywordHistory';
const PREFS_KEY = 'userPreferences';

export async function saveSession(sessionData) {
  const data = await chrome.storage.local.get(DB_KEY);
  const existing = data[DB_KEY] || [];
  existing.unshift(sessionData); // newest first
  
  // Keep last 100 sessions (configurable)
  const trimmed = existing.slice(0, 100);
  await chrome.storage.local.set({ [DB_KEY]: trimmed });
  
  return sessionData.scrapeSessionId;
}

export async function getSessions() {
  const data = await chrome.storage.local.get(DB_KEY);
  return data[DB_KEY] || [];
}

export async function getSessionById(sessionId) {
  const sessions = await getSessions();
  return sessions.find(s => s.scrapeSessionId === sessionId);
}

export async function deleteSession(sessionId) {
  const sessions = await getSessions();
  const filtered = sessions.filter(s => s.scrapeSessionId !== sessionId);
  await chrome.storage.local.set({ [DB_KEY]: filtered });
}

export async function exportAllToJSON() {
  const sessions = await getSessions();
  
  // In a service worker context, we convert JSON to a data URL, in a sidepanel we can use Blob
  // Since this is exported from side panel or background, chrome.downloads needs a blob url or data url.
  const jsonStr = JSON.stringify(sessions, null, 2);
  let url = '';
  
  if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL) {
      const blob = new Blob([jsonStr], { type: 'application/json' });
      url = URL.createObjectURL(blob);
  } else {
      url = `data:application/json;base64,${btoa(unescape(encodeURIComponent(jsonStr)))}`;
  }
  
  await chrome.downloads.download({
    url,
    filename: `upwork-jobs-export-${new Date().toISOString().split('T')[0]}.json`,
    saveAs: true
  });
}

export async function getStorageStats() {
  const sessions = await getSessions();
  const totalJobs = sessions.reduce((sum, s) => sum + (s.jobs?.length || 0), 0);
  return {
    sessionCount: sessions.length,
    totalJobs,
    oldestSession: sessions.length > 0 ? sessions[sessions.length - 1].scrapedAt : null,
    newestSession: sessions.length > 0 ? sessions[0].scrapedAt : null
  };
}

export async function saveKeywordAnalysis(keywords) {
  const data = await chrome.storage.local.get(KEYWORDS_KEY);
  const history = data[KEYWORDS_KEY] || [];
  history.unshift({ ...keywords, timestamp: new Date().toISOString() });
  await chrome.storage.local.set({ [KEYWORDS_KEY]: history.slice(0, 20) });
}

export async function getPreferences() {
  const data = await chrome.storage.local.get(PREFS_KEY);
  const prefs = data[PREFS_KEY] || {};
  return {
    minFrequency: 2,
    highlightEnabled: true,
    highlightColors: { high: '#FFF176', medium: '#E8F5E9', low: '#E3F2FD' },
    ...prefs
  };
}

export async function savePreferences(newPrefs) {
  const current = await getPreferences();
  await chrome.storage.local.set({ [PREFS_KEY]: { ...current, ...newPrefs } });
}

export async function clearAllStorage() {
    await chrome.storage.local.remove([DB_KEY, KEYWORDS_KEY]);
}
