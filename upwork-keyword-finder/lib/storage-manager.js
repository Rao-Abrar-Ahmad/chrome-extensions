// lib/storage-manager.js

const DB_KEY = 'masterJobs';
const META_KEY = 'lastExtraction';
const KEYWORDS_KEY = 'keywordHistory';
const PREFS_KEY = 'userPreferences';
const HISTORY_KEY = 'extractionHistory';

export async function saveSession(sessionData) {
  const data = await chrome.storage.local.get([DB_KEY, HISTORY_KEY]);
  let masterJobs = data[DB_KEY] || [];
  let history = data[HISTORY_KEY] || [];
  
  const jobsMap = new Map();
  masterJobs.forEach(job => jobsMap.set(job.jobId, job));
  
  let newJobsCount = 0;
  
  if (sessionData.jobs && Array.isArray(sessionData.jobs)) {
      sessionData.jobs.forEach(job => {
          if (!jobsMap.has(job.jobId)) {
              jobsMap.set(job.jobId, job);
              newJobsCount++;
          } else {
              const existing = jobsMap.get(job.jobId);
              if (new Date(job.scrapedAt) > new Date(existing.scrapedAt)) {
                  jobsMap.set(job.jobId, job);
              }
          }
      });
  }
  
  masterJobs = Array.from(jobsMap.values());
  await chrome.storage.local.set({ [DB_KEY]: masterJobs });
  
  const meta = {
      timestamp: sessionData.scrapedAt,
      jobCount: sessionData.jobs.length,
      newJobsAdded: newJobsCount,
      totalJobs: masterJobs.length
  };
  await chrome.storage.local.set({ [META_KEY]: meta });
  
  history.unshift({
      scrapeSessionId: sessionData.scrapeSessionId,
      timestamp: sessionData.scrapedAt,
      searchQuery: sessionData.searchQuery || 'Generic Search',
      jobCount: sessionData.jobs.length,
      newJobsAdded: newJobsCount
  });
  if (history.length > 50) history = history.slice(0, 50);
  await chrome.storage.local.set({ [HISTORY_KEY]: history });
  
  return sessionData.scrapeSessionId;
}

export async function getExtractionHistory() {
  const data = await chrome.storage.local.get(HISTORY_KEY);
  return data[HISTORY_KEY] || [];
}

export async function getMasterJobs() {
  const data = await chrome.storage.local.get(DB_KEY);
  return data[DB_KEY] || [];
}

export async function getStorageStats() {
  const data = await chrome.storage.local.get([DB_KEY, META_KEY]);
  const masterJobs = data[DB_KEY] || [];
  const meta = data[META_KEY] || null;
  
  return {
    totalJobs: masterJobs.length,
    lastExtraction: meta
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
    await chrome.storage.local.remove([DB_KEY, META_KEY, KEYWORDS_KEY, HISTORY_KEY]);
}
