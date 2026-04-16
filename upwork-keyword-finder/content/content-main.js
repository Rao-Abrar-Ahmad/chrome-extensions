// content/content-main.js

if (!window.ukfInjected) {
  window.ukfInjected = true;

  // Listen for scrape command from the side panel
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    
    if (message.action === 'startScrape') {
      console.log('[UKF] Received startScrape message');
      try {
        const jobs = scrapeAllJobs();
        console.log(`[UKF] Scraped ${jobs.length} jobs`);
        if (jobs.length === 0) {
          sendResponse({ success: false, error: 'No jobs found on this page.' });
        } else {
          sendResponse({ success: true, jobs, pageUrl: window.location.href });
        }
      } catch (err) {
        console.error('[UKF] Scrape error', err);
        sendResponse({ success: false, error: err.message });
      }
      return false; // Sync response
    }

    if (message.action === 'highlightKeywords') {
      console.log('[UKF] Received highlightKeywords message', message.keywords);
      try {
          highlightKeywordsOnPage(message.keywords);
          sendResponse({ success: true });
      } catch (err) {
          console.error('[UKF] Highlight error', err);
          sendResponse({ success: false, error: err.message });
      }
      return false; // Sync response
    }

    if (message.action === 'clearHighlights') {
      console.log('[UKF] Received clearHighlights message');
      clearHighlights();
      sendResponse({ success: true });
      return false; // Sync response
    }
    
    if (message.action === 'ping') {
      console.log('[UKF] Received ping message');
      sendResponse({ active: true, isUpworkSearch: isUpworkSearchPage() });
      return false; // Sync response
    }
  });

  function isUpworkSearchPage() {
    const isSearch = document.querySelectorAll('[data-test="JobTile"]').length > 0;
    console.log(`[UKF] isUpworkSearchPage check: ${isSearch}`);
    return isSearch;
  }
}
