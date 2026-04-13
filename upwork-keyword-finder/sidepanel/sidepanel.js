// sidepanel/sidepanel.js

let currentKeywords = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  console.log('[SidePanel] init called');
  await loadStats();
  await checkCurrentPage();
  setupEventListeners();
  
  console.log('[SidePanel] Checking AI availability');
  const aiStatus = await chrome.runtime.sendMessage({ action: 'checkAI' });
  console.log('[SidePanel] AI status result:', aiStatus);
  const badge = document.getElementById('ai-badge');
  badge.style.display = 'block';
  badge.textContent = aiStatus.available ? '🤖 AI Mode' : '⚡ Smart Mode';
}

function setupEventListeners() {
  // Navigation
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      switchView(e.target.dataset.view);
    });
  });

  // Action Buttons
  document.getElementById('btn-scrape').addEventListener('click', handleScrape);
  document.getElementById('btn-scrape-only').addEventListener('click', handleScrapeOnly);
  document.getElementById('btn-export').addEventListener('click', handleExport);
  document.getElementById('btn-clear-storage').addEventListener('click', handleClearStorage);
  document.getElementById('btn-copy-keywords').addEventListener('click', handleCopyKeywords);
  document.getElementById('btn-clear-highlights').addEventListener('click', handleClearHighlights);

  // Result Tabs
  document.querySelectorAll('.tab-bar .tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.tab-bar .tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      
      e.target.classList.add('active');
      document.getElementById(`tab-${e.target.dataset.tab}`).classList.add('active');
    });
  });
}

function switchView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${viewId}`).classList.add('active');
  
  if (viewId === 'history') {
    loadHistory();
  }
}

async function checkCurrentPage() {
  console.log('[SidePanel] checkCurrentPage called');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
      console.warn('[SidePanel] No active tab found');
      return;
  }
  
  try {
    console.log('[SidePanel] Pinging tab', tab.id);
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
    console.log('[SidePanel] Ping response:', response);
    if (response && response.active) {
      document.getElementById('btn-scrape').disabled = false;
      document.getElementById('btn-scrape-only').disabled = false;
      document.getElementById('scrape-hint').textContent = 
        response.isUpworkSearch 
          ? `Ready — scrape this page` 
          : 'Page loaded. Click Scrape to start.';
    }
  } catch (err) {
    console.warn('[SidePanel] Ping failed:', err.message);
    document.getElementById('scrape-hint').textContent = 'Navigate to an Upwork job search page first';
  }
}

async function handleScrape() {
  console.log('[SidePanel] handleScrape clicked');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
      console.error('[SidePanel] No active tab available for scraping');
      showError('No active tab available.');
      return;
  }
  
  console.log('[SidePanel] Target tab ID:', tab.id);
  showProgress('Scraping job listings...');
  await new Promise(r => setTimeout(r, 20)); // Allow UI to update
  document.getElementById('btn-scrape').disabled = true;
  document.getElementById('btn-scrape-only').disabled = true;
  
  try {
      console.log('[SidePanel] Sending startScrape to tab...');
      const scrapeResponse = await chrome.tabs.sendMessage(tab.id, { action: 'startScrape' });
      console.log('[SidePanel] scrapeResponse:', scrapeResponse);
      
      if (!scrapeResponse.success) {
        showError(scrapeResponse.error);
        return;
      }
      
      const { jobs, pageUrl } = scrapeResponse;
      console.log(`[SidePanel] Received ${jobs.length} jobs.`);
      updateProgress(`Found ${jobs.length} jobs. Analyzing keywords...`);
      await new Promise(r => setTimeout(r, 1000)); // Allow UI to update
      
      // Build session object
      const urlObj = new URL(pageUrl);
      const session = {
        scrapeSessionId: `session_${Date.now()}`,
        scrapedAt: new Date().toISOString(),
        pageUrl,
        searchQuery: urlObj.searchParams.get('q') || '',
        sortOrder: urlObj.searchParams.get('sort') || '',
        pageNumber: urlObj.searchParams.get('page') || '1',
        jobCount: jobs.length,
        jobs
      };
      
      // Save jobs to storage
      console.log('[SidePanel] Saving session to storage...');
      await chrome.runtime.sendMessage({ action: 'saveSession', sessionData: session });
      console.log('[SidePanel] Session saved successfully.');
      
      // Analyze keywords
      updateProgress('Running keyword analysis...');
      console.log('[SidePanel] Sending analyzeKeywords background message...');
      const keywordsResponse = await chrome.runtime.sendMessage({ action: 'analyzeKeywords', jobs });
      console.log('[SidePanel] Analysis complete. Response:', keywordsResponse);
      
      if (keywordsResponse.success) {
        const keywords = keywordsResponse.data;
        currentKeywords = keywords;
        
        // Display results
        displayKeywords(keywords);
        
        // Switch to Results nav tab programmatically
        document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
        document.querySelector('[data-view="results"]').classList.add('active');
        switchView('results');
        
        // Highlight on page if enabled
        const prefHighlight = document.getElementById('pref-highlight').checked;
        if (prefHighlight) {
          const allKeywords = [
            ...(keywords.skillKeywords || []),
            ...(keywords.titleKeywords || [])
          ];
          console.log(`[SidePanel] Sending ${allKeywords.length} keywords to highlight...`);
          await chrome.tabs.sendMessage(tab.id, { action: 'highlightKeywords', keywords: allKeywords });
          console.log('[SidePanel] Highlights complete.');
        }
      } else {
          console.error('[SidePanel] Background analysis returned success: false', keywordsResponse.error);
          showError('Analysis failed: ' + keywordsResponse.error);
      }
  } catch (err) {
      console.error('[SidePanel] Scrape process exception thrown:', err);
      showError('Failed to communicate with page or process failed. Details: ' + err.message);
  } finally {
      console.log('[SidePanel] Scrape process finished. Cleaning up UI state.');
      hideProgress();
      document.getElementById('btn-scrape').disabled = false;
      document.getElementById('btn-scrape-only').disabled = false;
      await loadStats();
  }
}

async function handleScrapeOnly() {
  console.log('[SidePanel] handleScrapeOnly clicked');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
      console.error('[SidePanel] No active tab available for scraping');
      showError('No active tab available.');
      return;
  }
  
  console.log('[SidePanel] Target tab ID:', tab.id);
  showProgress('Scraping job listings...');
  await new Promise(r => setTimeout(r, 20)); // Allow UI to update
  document.getElementById('btn-scrape').disabled = true;
  document.getElementById('btn-scrape-only').disabled = true;
  
  try {
      console.log('[SidePanel] Sending startScrape to tab...');
      const scrapeResponse = await chrome.tabs.sendMessage(tab.id, { action: 'startScrape' });
      console.log('[SidePanel] scrapeResponse:', scrapeResponse);
      
      if (!scrapeResponse.success) {
        showError(scrapeResponse.error);
        return;
      }
      
      const { jobs, pageUrl } = scrapeResponse;
      console.log(`[SidePanel] Received ${jobs.length} jobs.`);
      updateProgress(`Found ${jobs.length} jobs. Saving data...`);
      await new Promise(r => setTimeout(r, 1000)); // Allow UI to update
      
      // Build session object
      const urlObj = new URL(pageUrl);
      const session = {
        scrapeSessionId: `session_${Date.now()}`,
        scrapedAt: new Date().toISOString(),
        pageUrl,
        searchQuery: urlObj.searchParams.get('q') || '',
        sortOrder: urlObj.searchParams.get('sort') || '',
        pageNumber: urlObj.searchParams.get('page') || '1',
        jobCount: jobs.length,
        jobs
      };
      
      // Save jobs to storage
      console.log('[SidePanel] Saving session to storage...');
      await chrome.runtime.sendMessage({ action: 'saveSession', sessionData: session });
      console.log('[SidePanel] Session saved successfully.');
      
      alert(`Scraped and saved ${jobs.length} jobs successfully! Go to the Settings tab to export.`);
      
  } catch (err) {
      console.error('[SidePanel] Scrape process exception thrown:', err);
      showError('Failed to communicate with page or process failed. Details: ' + err.message);
  } finally {
      console.log('[SidePanel] Scrape process finished. Cleaning up UI state.');
      hideProgress();
      document.getElementById('btn-scrape').disabled = false;
      document.getElementById('btn-scrape-only').disabled = false;
      await loadStats();
  }
}

function showProgress(text) {
  document.getElementById('scrape-progress').style.display = 'block';
  document.getElementById('progress-text').textContent = text;
}

function updateProgress(text) {
  document.getElementById('progress-text').textContent = text;
}

function hideProgress() {
  document.getElementById('scrape-progress').style.display = 'none';
}

function showError(msg) {
  alert(msg);
  document.getElementById('scrape-progress').style.display = 'none';
}

async function loadStats() {
  const res = await chrome.runtime.sendMessage({ action: 'getStats' });
  if (res.success && res.stats) {
     const stats = res.stats;
     document.getElementById('home-stats').style.display = 'grid';
     document.getElementById('stat-sessions').textContent = stats.sessionCount;
     document.getElementById('stat-jobs').textContent = stats.totalJobs;
     // Retrieve last session count
     const sessionsRes = await chrome.runtime.sendMessage({ action: 'getSessions' });
     if (sessionsRes.success && sessionsRes.sessions.length > 0) {
         document.getElementById('stat-last-count').textContent = sessionsRes.sessions[0].jobCount;
     }
  }
}

async function loadHistory() {
  const res = await chrome.runtime.sendMessage({ action: 'getSessions' });
  if (res.success) {
     const container = document.getElementById('history-list');
     container.innerHTML = '';
     res.sessions.forEach(session => {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.innerHTML = `
          <strong>Query: ${session.searchQuery || 'N/A'}</strong><br/>
          <small>${new Date(session.scrapedAt).toLocaleString()}</small><br/>
          <span>${session.jobCount} Jobs found</span>
        `;
        container.appendChild(div);
     });
  }
}

function renderKeywordList(containerId, items) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  if (!items || items.length === 0) {
     container.innerHTML = '<em>No results</em>';
     return;
  }
  items.forEach(item => {
     const div = document.createElement('div');
     div.className = 'keyword-item';
     div.innerHTML = `
       <span>${item.keyword}</span>
       <span class="kw-badge">${item.count}</span>
     `;
     container.appendChild(div);
  });
}

function displayKeywords(data) {
  document.getElementById('no-results-msg').style.display = 'none';
  document.getElementById('results-content').style.display = 'block';
  
  document.getElementById('results-method').textContent = `Method: ${data.method}`;
  
  renderKeywordList('tab-skills', data.skillKeywords);
  renderKeywordList('tab-titles', data.titleKeywords);
  renderKeywordList('tab-phrases', data.actionPhrases);
}

async function handleExport() {
  await chrome.runtime.sendMessage({ action: 'exportJSON' });
}

async function handleClearStorage() {
  if (confirm('Are you sure you want to clear all history?')) {
     await chrome.storage.local.clear();
     alert('Storage cleared');
     loadStats();
     document.getElementById('history-list').innerHTML = '';
  }
}

async function handleClearHighlights() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
      await chrome.tabs.sendMessage(tab.id, { action: 'clearHighlights' });
  }
}

function handleCopyKeywords() {
  if (!currentKeywords) return;
  const allText = [
     "--- Skills ---",
     ...(currentKeywords.skillKeywords || []).map(k => `${k.keyword} (${k.count})`),
     "--- Titles ---",
     ...(currentKeywords.titleKeywords || []).map(k => `${k.keyword} (${k.count})`),
     "--- Phrases ---",
     ...(currentKeywords.actionPhrases || []).map(k => `${k.keyword} (${k.count})`)
  ].join('\n');
  navigator.clipboard.writeText(allText).then(() => {
     alert('Keywords copied to clipboard!');
  });
}
