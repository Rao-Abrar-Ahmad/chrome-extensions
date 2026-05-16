// sidepanel/sidepanel.js

let currentKeywords = null;
let connectionRetryCount = 0;
const MAX_RETRIES = 3;
let aiLiveTimer = null;   // interval for the live elapsed-time ticker
let aiStartTime = null;   // when AI analysis began (ms)

document.addEventListener('DOMContentLoaded', init);

async function init() {
  console.log('[SidePanel] Initializing side panel...');
  try {
    await loadPreferences();
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
    
    chrome.runtime.onMessage.addListener((msg) => {

        // --- Fired BEFORE AI processes a chunk ---
        if (msg.action === 'chunkStarted') {
            console.log(`[SidePanel] chunkStarted: chunk ${msg.chunkIndex}/${msg.totalChunks}, jobs ${msg.jobRange}`);
            
            // Start (or restart) the live elapsed-time ticker
            if (!aiLiveTimer) {
                aiStartTime = Date.now() - (msg.elapsedSecs * 1000);
                aiLiveTimer = setInterval(() => {
                    const secs = Math.floor((Date.now() - aiStartTime) / 1000);
                    const el = document.getElementById('stat-elapsed');
                    if (el) el.textContent = `${secs}s`;
                }, 1000);
                console.log('[SidePanel] Live timer started');
            }
            
            const percent = Math.round((msg.processed / msg.total) * 100);
            updateProgress(`🤔 AI reading jobs ${msg.jobRange} (chunk ${msg.chunkIndex}/${msg.totalChunks})…`, 'analyze', percent);
            
            const statsPanel = document.getElementById('ai-live-stats');
            if (statsPanel) {
                statsPanel.style.display = 'block';
                const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
                setEl('stat-chunks', `${msg.chunkIndex - 1}/${msg.totalChunks} done, reading ${msg.chunkIndex}`);
                setEl('stat-skills-running', '…');
                
                const titlesEl = document.getElementById('stat-current-titles');
                if (titlesEl && msg.currentJobTitles) {
                    titlesEl.innerHTML = msg.currentJobTitles
                        .map(t => `<span style="display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${t}</span>`)
                        .join('');
                }
            }
        }

        // --- Fired AFTER a chunk is done ---
        else if (msg.action === 'analyzeProgress') {
            const percent = Math.round((msg.processed / msg.total) * 100);
            const label = `✅ Chunk ${msg.chunkIndex}/${msg.totalChunks} done — ${msg.processed}/${msg.total} jobs (${percent}%)`;
            updateProgress(label, 'analyze', percent);
            console.log(`[SidePanel] analyzeProgress: chunk ${msg.chunkIndex}/${msg.totalChunks}, ${msg.processed}/${msg.total} jobs, ${msg.elapsedSecs}s elapsed, ${msg.runningSkillCount} skills`);
            
            const statsPanel = document.getElementById('ai-live-stats');
            if (statsPanel) {
                statsPanel.style.display = 'block';
                const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
                setEl('stat-chunks', `${msg.chunkIndex}/${msg.totalChunks}`);
                setEl('stat-elapsed', `${msg.elapsedSecs}s`);
                setEl('stat-skills-running', msg.runningSkillCount || 0);
                setEl('stat-chunk-status', `${msg.successfulChunks} ok / ${msg.failedChunks} failed`);
                if (aiStartTime) {
                    // Sync the timer with the authoritative server-side value
                    aiStartTime = Date.now() - (msg.elapsedSecs * 1000);
                }
            }
        }

        // --- AI fully complete ---
        else if (msg.action === 'aiAnalysisComplete') {
            const elapsed = msg.stats?.elapsed || '?';
            const jobCount = msg.stats?.jobsAnalyzed || '?';
            console.log(`[SidePanel] AI analysis complete in ${elapsed}s for ${jobCount} jobs`);
            
            // Stop the live timer
            if (aiLiveTimer) { clearInterval(aiLiveTimer); aiLiveTimer = null; }
            
            hideProgress('analyze');
            const statsPanel = document.getElementById('ai-live-stats');
            if (statsPanel) statsPanel.style.display = 'none';
            document.getElementById('btn-analyze').disabled = false;
            
            if (msg.success) {
                currentKeywords = msg.data;
                displayKeywords(currentKeywords);
            } else {
                showError('AI Analysis failed: ' + msg.error, 'analyze');
            }
        }
    });

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
  bindClick('btn-analyze', handleAnalyze);
  bindClick('btn-clear-storage', handleClearStorage);
  bindClick('btn-copy-keywords', handleCopyKeywords);
  bindClick('btn-clear-highlights', handleClearHighlights);
  bindClick('btn-view-analytics', handleOpenAnalytics);

  // Settings Auto-Save
  const savePrefsHandler = () => savePreferences();
  document.getElementById('pref-custom-emojis').addEventListener('input', savePrefsHandler);
  document.getElementById('pref-min-freq').addEventListener('change', savePrefsHandler);
  document.getElementById('pref-highlight').addEventListener('change', savePrefsHandler);

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
    const btnScrapeOnly = document.getElementById('btn-scrape-only');
    if (btnScrapeOnly) btnScrapeOnly.disabled = true;
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
    const btnScrapeOnly = document.getElementById('btn-scrape-only');
    if (btnScrapeOnly) btnScrapeOnly.disabled = false;
    document.getElementById('scrape-hint').innerHTML = isSearch 
        ? '<span style="color: #14a800">● Ready to Scrape</span>' 
        : '<span style="color: #58a6ff">● Page Linked (Generic)</span>';
}

async function handleScrape() {
  console.log('[SidePanel] handleScrape (Extraction) invoked');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return showError('No active tab available.', 'scrape');
  
  showProgress('Extracting raw job data...', 'scrape');
  document.getElementById('btn-scrape').disabled = true;
  
  try {
      console.log('[SidePanel] Sending startScrape message...');
      const scrapeResponse = await chrome.tabs.sendMessage(tab.id, { action: 'startScrape' });
      console.log('[SidePanel] Received scrape response:', scrapeResponse);
      
      if (!scrapeResponse || !scrapeResponse.success) {
        throw new Error(scrapeResponse?.error || 'No response from page');
      }
      
      const { jobs, pageUrl } = scrapeResponse;
      console.log(`[SidePanel] Processing ${jobs.length} jobs`);
      updateProgress(`Found ${jobs.length} jobs. Saving...`, 'scrape');
      
      const session = buildSessionObject(jobs, pageUrl);
      await chrome.runtime.sendMessage({ action: 'saveSession', sessionData: session });
      
      console.log('[SidePanel] Raw extraction saved to storage');
      alert(`Successfully extracted ${jobs.length} jobs to local storage!`);
  } catch (err) {
      console.error('[SidePanel] Scrape failed:', err);
      showError('Scrape failed: ' + err.message, 'scrape');
  } finally {
      hideProgress('scrape');
      document.getElementById('btn-scrape').disabled = false;
      loadStats();
  }
}

async function handleAnalyze() {
  console.log('[SidePanel] handleAnalyze invoked');
  
  showProgress('Computing Auto Algorithm results...', 'analyze');
  document.getElementById('btn-analyze').disabled = true;
  
  try {
      const keywordsResponse = await chrome.runtime.sendMessage({ action: 'analyzeAllKeywords' });
      
      if (keywordsResponse.success) {
        currentKeywords = keywordsResponse.data;
        displayKeywords(currentKeywords);
        
        if (document.getElementById('pref-highlight').checked) {
          console.log('[SidePanel] Triggering page highlights');
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab && tab.url && tab.url.includes('upwork.com')) {
              const algoData = currentKeywords.algorithm || currentKeywords;
              const allKeywords = [...(algoData.skillKeywords || []), ...(algoData.titleKeywords || [])];
              await chrome.tabs.sendMessage(tab.id, { action: 'highlightKeywords', keywords: allKeywords });
          }
        }
        
        if (keywordsResponse.aiRunning) {
            showProgress('Deep AI Analysis running in background...', 'analyze');
            // Do NOT re-enable the button or hide progress yet.
        } else {
            hideProgress('analyze');
            document.getElementById('btn-analyze').disabled = false;
        }
        
      } else {
          throw new Error(keywordsResponse.error);
      }
  } catch (err) {
      console.error('[SidePanel] Analyze failed:', err);
      showError('Analyze failed: ' + err.message, 'analyze');
      hideProgress('analyze');
      document.getElementById('btn-analyze').disabled = false;
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

function showProgress(text, context = 'scrape') {
  const progressId = context === 'scrape' ? 'scrape-progress' : 'analyze-progress';
  const textId = context === 'scrape' ? 'progress-text' : 'analyze-progress-text';
  const el = document.getElementById(progressId);
  if (el) {
    // analyze-progress is a flex child, use flex; scrape uses block
    el.style.display = context === 'analyze' ? 'flex' : 'block';
    el.style.flexDirection = 'column';
    const textEl = document.getElementById(textId);
    if (textEl) textEl.textContent = text;
  }
}

function updateProgress(text, context = 'scrape', percent = null) {
  const textId = context === 'scrape' ? 'progress-text' : 'analyze-progress-text';
  const fillId = context === 'scrape' ? null : 'analyze-progress-fill';
  const el = document.getElementById(textId);
  if (el) el.textContent = text;

  // Also ensure analyze-progress container is shown
  if (context === 'analyze') {
    const progressEl = document.getElementById('analyze-progress');
    if (progressEl && progressEl.style.display === 'none') {
      progressEl.style.display = 'flex';
      progressEl.style.flexDirection = 'column';
    }
  }
  
  if (percent !== null) {
    const fillEl = fillId
        ? document.getElementById(fillId)
        : document.querySelector('#scrape-progress .progress-fill');
    if (fillEl) {
        fillEl.style.width = `${percent}%`;
        fillEl.style.animation = 'none';
    }
  }
}

function hideProgress(context = 'scrape') {
  const progressId = context === 'scrape' ? 'scrape-progress' : 'analyze-progress';
  const el = document.getElementById(progressId);
  if (el) el.style.display = 'none';
}

function showError(msg, context = 'scrape') {
  console.error('[SidePanel UI Error]', msg);
  alert(msg);
  hideProgress(context);
}

async function loadStats() {
  console.log('[SidePanel] Loading storage stats');
  const res = await chrome.runtime.sendMessage({ action: 'getStats' });
  if (res.success && res.stats) {
     const stats = res.stats;
     document.getElementById('stat-jobs').textContent = stats.totalJobs;
     const kfTotalJobs = document.getElementById('kf-total-jobs');
     if (kfTotalJobs) kfTotalJobs.textContent = stats.totalJobs;
     
      if (stats.lastExtraction) {
         const d = new Date(stats.lastExtraction.timestamp);
         document.getElementById('stat-last-extracted-time').textContent = 
            `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
         document.getElementById('stat-last-count').textContent = stats.lastExtraction.newJobsAdded || stats.lastExtraction.jobCount;
     } else {
         document.getElementById('stat-last-extracted-time').textContent = 'Never';
         document.getElementById('stat-last-count').textContent = '0';
     }
     
     document.getElementById('home-stats').style.display = 'grid';
  }
}

async function loadHistory() {
  console.log('[SidePanel] Loading extraction history');
  const res = await chrome.runtime.sendMessage({ action: 'getHistory' });
  if (res.success) {
     const container = document.getElementById('history-list');
     if (!container) return;
     container.innerHTML = '';
     if (res.history.length === 0) {
         container.innerHTML = '<div style="padding: 1rem; color: #8b949e">No history yet</div>';
         return;
     }
     res.history.forEach(session => {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.innerHTML = `
          <strong>${session.searchQuery}</strong><br/>
          <small>${new Date(session.timestamp).toLocaleTimeString()} - ${new Date(session.timestamp).toLocaleDateString()}</small>
          <span style="float: right">${session.jobCount} jobs (${session.newJobsAdded} new)</span>
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
  if (content) content.style.display = 'flex';  // flex to fill available height in column layout
  
  const methodEl = document.getElementById('results-method');
  if (methodEl) {
      const aiPending = data.method === 'algorithm';
      methodEl.innerHTML = `Method: <strong>${data.method === 'both' ? '🤖 Algorithm + AI' : '⚙️ Algorithm only'}</strong>${aiPending ? ' &nbsp;<em style="color:#888;font-size:11px;">(AI running…)</em>' : ''}`;
  }
  
  const algoData = data.algorithm || data; // fallback just in case
  const aiData = data.ai || null;
  
  renderKeywordList('col-skills-algo', algoData.skillKeywords);
  renderKeywordList('col-titles-algo', algoData.titleKeywords);
  renderKeywordList('col-phrases-algo', algoData.actionPhrases);

  // AI columns: show placeholder if AI hasn't finished yet
  renderKeywordList('col-skills-ai', aiData?.skillKeywords, !aiData);
  renderKeywordList('col-titles-ai', aiData?.titleKeywords, !aiData);
  renderKeywordList('col-phrases-ai', aiData?.actionPhrases, !aiData);
}

function renderKeywordList(containerId, items, pending = false) {
  const container = document.querySelector(`#${containerId} .kw-list`);
  if (!container) return;
  container.innerHTML = '';
  if (pending) {
     container.innerHTML = '<div style="padding: 1rem; color: #888; font-style: italic; text-align:center;">⏳ AI analyzing…</div>';
     return;
  }
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



async function handleClearStorage() {
  if (confirm('Permanently delete all scraped data? This cannot be undone.')) {
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
  const algoData = currentKeywords.algorithm || currentKeywords;
  const aiData = currentKeywords.ai;
  
  let allText = "--- AUTO ALGORITHM ---\n";
  allText += "--- Skills ---\n" + (algoData.skillKeywords || []).map(k => `${k.keyword} (${k.count})`).join('\n') + '\n';
  allText += "--- Titles ---\n" + (algoData.titleKeywords || []).map(k => `${k.keyword} (${k.count})`).join('\n') + '\n';
  allText += "--- Phrases ---\n" + (algoData.actionPhrases || []).map(k => `${k.keyword} (${k.count})`).join('\n') + '\n';

  if (aiData) {
      allText += "\n--- AI RESULTS ---\n";
      allText += "--- Skills ---\n" + (aiData.skillKeywords || []).map(k => `${k.keyword} (${k.count})`).join('\n') + '\n';
      allText += "--- Titles ---\n" + (aiData.titleKeywords || []).map(k => `${k.keyword} (${k.count})`).join('\n') + '\n';
      allText += "--- Phrases ---\n" + (aiData.actionPhrases || []).map(k => `${k.keyword} (${k.count})`).join('\n') + '\n';
  }

  navigator.clipboard.writeText(allText).then(() => alert('Keywords copied!'));
}

function handleOpenAnalytics() {
  console.log('[SidePanel] Opening analytics dashboard tab');
  chrome.tabs.create({ url: chrome.runtime.getURL('analytics/analytics.html') });
}

// Settings Preferences
const PREFS_KEY = 'userPreferences';

async function loadPreferences() {
  const data = await chrome.storage.local.get(PREFS_KEY);
  const prefs = data[PREFS_KEY] || {};
  
  const defaultEmojis = "⚡,⭐,🔥,🚀,💡,📌,❗,✅,❌,🛠️,💻,📈";
  const customEmojisEl = document.getElementById('pref-custom-emojis');
  if (customEmojisEl) customEmojisEl.value = prefs.customEmojis || defaultEmojis;
  
  const minFreqEl = document.getElementById('pref-min-freq');
  if (minFreqEl && prefs.minFrequency !== undefined) minFreqEl.value = prefs.minFrequency;
  
  const highlightEl = document.getElementById('pref-highlight');
  if (highlightEl && prefs.highlightEnabled !== undefined) highlightEl.checked = prefs.highlightEnabled;
}

async function savePreferences() {
  const prefs = {
    customEmojis: document.getElementById('pref-custom-emojis').value,
    minFrequency: parseInt(document.getElementById('pref-min-freq').value, 20),
    highlightEnabled: document.getElementById('pref-highlight').checked
  };
  await chrome.storage.local.set({ [PREFS_KEY]: prefs });
  console.log('[SidePanel] Saved preferences:', prefs);
}
