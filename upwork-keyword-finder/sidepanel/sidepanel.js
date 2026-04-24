// sidepanel/sidepanel.js

let currentKeywords = null;
let connectionRetryCount = 0;
const MAX_RETRIES = 3;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  console.log('[SidePanel] Initializing side panel...');
  try {
    await loadStats();
    await checkCurrentPage();
    setupEventListeners();

    // Listen for tab changes so we auto-inject when navigating the SPA
    chrome.tabs.onActivated.addListener(() => {
      console.log('[SidePanel] Tab activated, re-checking page...');
      checkCurrentPage();
    });
    
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (tab.active && (changeInfo.status === 'complete' || changeInfo.url)) {
        console.log('[SidePanel] Tab updated, status:', changeInfo.status, 'URL:', changeInfo.url);
        checkCurrentPage();
      }
    });
    
    console.log('[SidePanel] Checking AI availability');
    const aiStatus = await chrome.runtime.sendMessage({ action: 'checkAI' });
    console.log('[SidePanel] AI status result:', aiStatus);
    const badge = document.getElementById('ai-badge');
    if (badge) {
        badge.style.display = 'block';
        badge.textContent = aiStatus.available ? '🤖 AI Mode' : '⚡ Smart Mode';
    }
    console.log('[SidePanel] Initialization complete.');
  } catch (err) {
    console.error('[SidePanel] Initialization failed:', err);
  }
}

function setupEventListeners() {
  console.log('[SidePanel] Setting up event listeners');
  
  // Navigation
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      console.log('[SidePanel] Nav tab clicked:', e.target.dataset.view);
      document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      switchView(e.target.dataset.view);
    });
  });

  // Action Buttons
  const bindClick = (id, handler) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', handler);
    else console.warn(`[SidePanel] Element not found: ${id}`);
  };

  bindClick('btn-scrape', handleScrape);
  bindClick('btn-scrape-only', handleScrapeOnly);
  bindClick('btn-export', handleExport);
  bindClick('btn-clear-storage', handleClearStorage);
  bindClick('btn-copy-keywords', handleCopyKeywords);
  bindClick('btn-clear-highlights', handleClearHighlights);
  bindClick('btn-view-analytics', handleOpenAnalytics);

  // Result Tabs
  document.querySelectorAll('.tab-bar .tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      console.log('[SidePanel] Result sub-tab clicked:', e.target.dataset.tab);
      document.querySelectorAll('.tab-bar .tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      
      e.target.classList.add('active');
      const targetContent = document.getElementById(`tab-${e.target.dataset.tab}`);
      if (targetContent) targetContent.classList.add('active');
    });
  });
}

function switchView(viewId) {
  console.log('[SidePanel] Switching view to:', viewId);
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const targetView = document.getElementById(`view-${viewId}`);
  if (targetView) {
    targetView.classList.add('active');
    if (viewId === 'history') loadHistory();
  }
}

async function checkCurrentPage() {
  console.log('[SidePanel] checkCurrentPage check started');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (!tab) {
      console.warn('[SidePanel] No active tab found');
      return;
  }
  
  if (!tab.url || !tab.url.includes('upwork.com')) {
    console.log('[SidePanel] Not an Upwork page:', tab.url);
    document.getElementById('scrape-hint').textContent = 'Open an Upwork job search page';
    document.getElementById('btn-scrape').disabled = true;
    document.getElementById('btn-scrape-only').disabled = true;
    return;
  }

  document.getElementById('scrape-hint').textContent = 'Connecting to page...';
  
  try {
    console.log('[SidePanel] Pinging content script in tab', tab.id);
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
    console.log('[SidePanel] Ping response received:', response);
    
    if (response && response.active) {
      updateUIReadyState(response.isUpworkSearch);
      connectionRetryCount = 0;
      return;
    }
  } catch (err) {
    console.log('[SidePanel] Initial ping failed, attempting script injection:', err.message);
    await injectAndRetry(tab);
  }
}

async function injectAndRetry(tab) {
    try {
        console.log('[SidePanel] Injecting scripts programmatically into tab', tab.id);
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content/scraper.js', 'content/highlighter.js', 'content/content-main.js']
        });
        
        console.log('[SidePanel] Injection successful, retrying ping...');
        await new Promise(r => setTimeout(r, 200)); // Small delay for listener registration
        
        const retryResponse = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
        if (retryResponse && retryResponse.active) {
            console.log('[SidePanel] Re-connected successfully after injection');
            updateUIReadyState(retryResponse.isUpworkSearch);
        }
    } catch (injectErr) {
        console.error('[SidePanel] Injection/Retry failed:', injectErr);
        document.getElementById('scrape-hint').textContent = 'Connection failed. Try reloading the page.';
    }
}

function updateUIReadyState(isSearch) {
    document.getElementById('btn-scrape').disabled = false;
    document.getElementById('btn-scrape-only').disabled = false;
    document.getElementById('scrape-hint').innerHTML = isSearch 
        ? '<span style="color: #14a800">● Ready to Scrape</span>' 
        : '<span style="color: #58a6ff">● Page Linked (Generic)</span>';
}

async function handleScrape() {
  console.log('[SidePanel] handleScrape invoked');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return showError('No active tab available.');
  
  showProgress('Starting full analysis...');
  document.getElementById('btn-scrape').disabled = true;
  document.getElementById('btn-scrape-only').disabled = true;
  
  try {
      console.log('[SidePanel] Sending startScrape message...');
      const scrapeResponse = await chrome.tabs.sendMessage(tab.id, { action: 'startScrape' });
      console.log('[SidePanel] Received scrape response:', scrapeResponse);
      
      if (!scrapeResponse || !scrapeResponse.success) {
        throw new Error(scrapeResponse?.error || 'No response from page');
      }
      
      const { jobs, pageUrl } = scrapeResponse;
      console.log(`[SidePanel] Processing ${jobs.length} jobs`);
      updateProgress(`Found ${jobs.length} jobs. Saving...`);
      
      const session = buildSessionObject(jobs, pageUrl);
      await chrome.runtime.sendMessage({ action: 'saveSession', sessionData: session });
      
      updateProgress('Analyzing keywords with AI...');
      const keywordsResponse = await chrome.runtime.sendMessage({ action: 'analyzeKeywords', jobs });
      
      if (keywordsResponse.success) {
        currentKeywords = keywordsResponse.data;
        displayKeywords(currentKeywords);
        switchView('results');
        
        if (document.getElementById('pref-highlight').checked) {
          console.log('[SidePanel] Triggering page highlights');
          const allKeywords = [...(currentKeywords.skillKeywords || []), ...(currentKeywords.titleKeywords || [])];
          await chrome.tabs.sendMessage(tab.id, { action: 'highlightKeywords', keywords: allKeywords });
        }
      } else {
          throw new Error(keywordsResponse.error);
      }
  } catch (err) {
      console.error('[SidePanel] Scrape failed:', err);
      showError('Scrape failed: ' + err.message);
  } finally {
      hideProgress();
      document.getElementById('btn-scrape').disabled = false;
      document.getElementById('btn-scrape-only').disabled = false;
      loadStats();
  }
}

async function handleScrapeOnly() {
  console.log('[SidePanel] handleScrapeOnly (Raw Extraction) invoked');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  
  showProgress('Extracting raw job data...');
  document.getElementById('btn-scrape').disabled = true;
  document.getElementById('btn-scrape-only').disabled = true;
  
  try {
      const scrapeResponse = await chrome.tabs.sendMessage(tab.id, { action: 'startScrape' });
      if (!scrapeResponse?.success) throw new Error(scrapeResponse?.error || 'Extraction failed');
      
      const { jobs, pageUrl } = scrapeResponse;
      updateProgress(`Saving ${jobs.length} jobs to history...`);
      
      const session = buildSessionObject(jobs, pageUrl);
      await chrome.runtime.sendMessage({ action: 'saveSession', sessionData: session });
      
      console.log('[SidePanel] Raw extraction saved to storage');
      alert(`Successfully extracted ${jobs.length} jobs to local storage!`);
  } catch (err) {
      console.error('[SidePanel] Extraction error:', err);
      showError('Extraction failed: ' + err.message);
  } finally {
      hideProgress();
      document.getElementById('btn-scrape').disabled = false;
      document.getElementById('btn-scrape-only').disabled = false;
      loadStats();
  }
}

function buildSessionObject(jobs, pageUrl) {
    const urlObj = new URL(pageUrl);
    return {
        scrapeSessionId: `session_${Date.now()}`,
        scrapedAt: new Date().toISOString(),
        pageUrl,
        searchQuery: urlObj.searchParams.get('q') || 'Generic Search',
        sortOrder: urlObj.searchParams.get('sort') || 'default',
        pageNumber: urlObj.searchParams.get('page') || '1',
        jobCount: jobs.length,
        jobs
    };
}

function showProgress(text) {
  const el = document.getElementById('scrape-progress');
  if (el) {
    el.style.display = 'block';
    document.getElementById('progress-text').textContent = text;
  }
}

function updateProgress(text) {
  const el = document.getElementById('progress-text');
  if (el) el.textContent = text;
}

function hideProgress() {
  const el = document.getElementById('scrape-progress');
  if (el) el.style.display = 'none';
}

function showError(msg) {
  console.error('[SidePanel UI Error]', msg);
  alert(msg);
  hideProgress();
}

async function loadStats() {
  console.log('[SidePanel] Loading storage stats');
  const res = await chrome.runtime.sendMessage({ action: 'getStats' });
  if (res.success && res.stats) {
     const stats = res.stats;
     document.getElementById('stat-sessions').textContent = stats.sessionCount;
     document.getElementById('stat-jobs').textContent = stats.totalJobs;
     
     const sessionsRes = await chrome.runtime.sendMessage({ action: 'getSessions' });
     if (sessionsRes.success && sessionsRes.sessions.length > 0) {
         document.getElementById('stat-last-count').textContent = sessionsRes.sessions[0].jobCount;
     }
  }
}

async function loadHistory() {
  console.log('[SidePanel] Loading scrape history');
  const res = await chrome.runtime.sendMessage({ action: 'getSessions' });
  if (res.success) {
     const container = document.getElementById('history-list');
     container.innerHTML = '';
     res.sessions.forEach(session => {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.innerHTML = `
          <strong>${session.searchQuery}</strong><br/>
          <small>${new Date(session.scrapedAt).toLocaleTimeString()}</small>
          <span style="float: right">${session.jobCount} jobs</span>
        `;
        container.appendChild(div);
     });
  }
}

function displayKeywords(data) {
  console.log('[SidePanel] Displaying keyword analysis results');
  const noRes = document.getElementById('no-results-msg');
  const content = document.getElementById('results-content');
  if (noRes) noRes.style.display = 'none';
  if (content) content.style.display = 'block';
  
  const methodEl = document.getElementById('results-method');
  if (methodEl) methodEl.textContent = `Method: ${data.method}`;
  
  renderKeywordList('tab-skills', data.skillKeywords);
  renderKeywordList('tab-titles', data.titleKeywords);
  renderKeywordList('tab-phrases', data.actionPhrases);
}

function renderKeywordList(containerId, items) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  if (!items || items.length === 0) {
     container.innerHTML = '<div style="padding: 1rem; color: #8b949e">No results found</div>';
     return;
  }
  items.forEach(item => {
     const div = document.createElement('div');
     div.className = 'keyword-item';
     div.innerHTML = `<span>${item.keyword}</span><span class="kw-badge">${item.count}</span>`;
     container.appendChild(div);
  });
}

async function handleExport() {
  console.log('[SidePanel] Triggering JSON export');
  await chrome.runtime.sendMessage({ action: 'exportJSON' });
}

async function handleClearStorage() {
  if (confirm('Permanently delete all scrape history?')) {
     console.log('[SidePanel] Clearing storage');
     await chrome.storage.local.clear();
     await loadStats();
     const list = document.getElementById('history-list');
     if (list) list.innerHTML = '';
  }
}

async function handleClearHighlights() {
  console.log('[SidePanel] Clearing page highlights');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) await chrome.tabs.sendMessage(tab.id, { action: 'clearHighlights' });
}

function handleCopyKeywords() {
  console.log('[SidePanel] Copying keywords to clipboard');
  if (!currentKeywords) return;
  const allText = [
     "--- Skills ---",
     ...(currentKeywords.skillKeywords || []).map(k => `${k.keyword} (${k.count})`),
     "--- Titles ---",
     ...(currentKeywords.titleKeywords || []).map(k => `${k.keyword} (${k.count})`),
     "--- Phrases ---",
     ...(currentKeywords.actionPhrases || []).map(k => `${k.keyword} (${k.count})`)
  ].join('\n');
  navigator.clipboard.writeText(allText).then(() => alert('Keywords copied!'));
}

function handleOpenAnalytics() {
  console.log('[SidePanel] Opening analytics dashboard tab');
  chrome.tabs.create({ url: chrome.runtime.getURL('analytics/analytics.html') });
}
