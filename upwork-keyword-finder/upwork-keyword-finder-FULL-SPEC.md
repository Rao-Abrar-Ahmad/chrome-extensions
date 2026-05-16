## Complete Build Specification v2.3
### Agent-Ready Documentation (for Claude Code or any AI agent)

---

> **HOW TO USE THIS DOCUMENT**
> This document is the single source of truth for building this extension. Hand it directly to Claude Code or any AI coding agent. It contains the exact DOM selectors from the real Upwork HTML, the complete JSON schema, the Side Panel API setup, and every architectural decision needed to build without ambiguity.

---

## Table of Contents

1. [Project Summary](#1-project-summary)
2. [What Changed from v1 — Key Decisions](#2-what-changed-from-v1--key-decisions)
3. [Chrome Side Panel API](#3-chrome-side-panel-api)
4. [Complete File & Folder Structure](#4-complete-file--folder-structure)
5. [Upwork DOM Analysis — Exact Selectors](#5-upwork-dom-analysis--exact-selectors)
6. [Complete JSON Schema for Stored Jobs](#6-complete-json-schema-for-stored-jobs)
7. [manifest.json — Full Config](#7-manifestjson--full-config)
8. [Content Script — Manual Trigger Only](#8-content-script--manual-trigger-only)
9. [Scraper — Complete Implementation](#9-scraper--complete-implementation)
10. [Storage — Jobs Database on Local Machine](#10-storage--jobs-database-on-local-machine)
11. [Background Service Worker](#11-background-service-worker)
12. [Side Panel HTML & UI](#12-side-panel-html--ui)
13. [Chrome Built-in AI Integration](#13-chrome-built-in-ai-integration)
14. [Keyword Algorithm (Fallback)](#14-keyword-algorithm-fallback)
15. [Highlight Engine](#15-highlight-engine)
16. [Data Flow — Complete Picture](#16-data-flow--complete-picture)
17. [Chrome Built-in AI Setup Requirements](#17-chrome-built-in-ai-setup-requirements)
19. [Data Consolidation Workflow](#19-data-consolidation-workflow)
20. [Analytics Dashboard Architecture](#20-analytics-dashboard-architecture)
21. [Known Challenges & Solutions](#21-known-challenges--solutions)
22. [Text Formatting Toolbar (v2.2)](#22-text-formatting-toolbar-v22)
23. [Quick Reference — All Selectors](#23-quick-reference--all-selectors)

---

## 1. Project Summary

**Extension Name:** Upwork Keyword Finder

**Purpose:** A Chrome Extension that works on Upwork job search pages. The user manually triggers a scrape. The extension reads all job listings on the page, stores every job as a structured JSON record (for long-term analysis), analyzes the content with Chrome's built-in AI (Gemini Nano) or a fallback algorithm to find top keywords, and displays results in the Chrome Side Panel. Keywords are also highlighted directly on the Upwork page. **Additionally, it provides a globally available Unicode formatting toolbar to simulate rich text on Upwork's plain-text fields.**

**Primary Value Propositions:**
1. **Job Database** — Every scrape saves full job data. After running this for days/weeks, the user has a dataset to analyze trends, budgets, client locations, and skill demand.
2. **Keyword Intelligence** — The AI finds the most-used words in job titles and descriptions, helping freelancers optimize their profiles.
3. **Visual Highlighting** — Keywords get highlighted in three tiers directly on the Upwork page.
4. **Text Formatting** — Automatically detect textareas and inject a toolbar to insert Emojis or format text using Mathematical Unicode (Bold/Italic).

---

## 2. What Changed from v1 — Key Decisions

| Feature | v1 | v2 | v2.2 (Latest) |
|---|---|---|---|
| UI Surface | Popup | Side Panel | Side Panel + **Analytics Tab** |
| Scraping trigger | Automatic | Manual click | Manual + **SPA Navigation Support** |
| Job data storage | Not stored | Full JSON stored | JSON + **Automated Timestamping** |
| Data volume | Current page | All jobs + metadata | **Master Consolidated Dataset** |
| Export | None | Export to JSON | JSON + **Visual Dashboard** |
| Time Intelligence | Relative only | Relative only | **Absolute `postedAt` Parsing** |
| Text Editing | None | None | **Unicode Formatting Toolbar (Bold, Emojis)** |

---

## 3. Chrome Side Panel API

### 3.1 What is the Side Panel?

The Chrome Side Panel is a persistent panel that slides open on the right side of the browser window. It stays open while the user browses — much better than a popup which closes when clicked away. It's the correct UI for tools like this.

### 3.2 How to Enable Side Panel in MV3

The Side Panel API requires no special flag — it's available in Chrome 114+ and is the standard approach for persistent extension UIs.

**In manifest.json:**
```json
{
  "side_panel": {
    "default_path": "sidepanel/sidepanel.html"
  },
  "permissions": [
    "sidePanel",
    "storage",
    "activeTab",
    "scripting",
    "downloads"
  ]
}
```

**In background service worker — Open panel on extension icon click:**
```javascript
// background/service-worker.js

// Open the side panel when user clicks the extension icon
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Optional: Set side panel behavior to open automatically
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
```

**IMPORTANT:** The Side Panel HTML is a full HTML page, not a small popup. It has its own JS file. It communicates with the content script via `chrome.runtime.sendMessage`.

### 3.3 Side Panel vs Popup

- The `"action"` key in manifest still refers to the extension toolbar icon
- But instead of `"default_popup"`, we use `"side_panel"` key
- Remove `"default_popup"` from the `"action"` key entirely
- The panel stays open across navigation within the same tab

---

## 4. Complete File & Folder Structure

```
upwork-keyword-finder/
│
├── manifest.json                    ← Extension config (MV3)
│
├── background/
│   └── service-worker.js            ← Opens side panel, coordinates storage & AI
│
├── content/
│   ├── scraper.js                   ← Reads job listings from Upwork DOM
│   ├── highlighter.js               ← Highlights keywords on page
│   └── content-main.js              ← Entry point, listens for scrape trigger message
│
├── sidepanel/
│   ├── sidepanel.html               ← The Side Panel UI
│   ├── sidepanel.js                 ← Side Panel logic
│   └── sidepanel.css                ← Side Panel styles
│
├── lib/
│   ├── keyword-algorithm.js         ← TF-IDF fallback keyword extraction
│   ├── text-cleaner.js              ← Text preprocessing
│   └── storage-manager.js           ← Read/write job history
│
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## 5. Upwork DOM Analysis — Exact Selectors

**This section was derived from analyzing the actual Upwork HTML source.** These are stable `data-test` attributes that Upwork uses consistently. They should remain stable across design updates.

### 5.1 Job Tile Container

Each job is wrapped in an `<article>` element:

```
article[data-test="JobTile"]
```

Additional attributes available on the article element itself:
```
data-ev-job-uid          → Unique job ID (e.g., "2043271459774853868")
data-ev-position         → Position on page (e.g., "1", "2", "3")
data-ev-page_number      → Which page of results (e.g., "1")
```

**Example:**
```html
<article 
  class="job-tile cursor-pointer px-md-4 air3-card air3-card-list px-4x" 
  data-ev-job-uid="2043271459774853868" 
  data-ev-position="1" 
  data-ev-page_number="1"
  data-test="JobTile" 
  data-test-key="2043271459774853868">
```

### 5.2 Job Title

```
[data-test="job-tile-title-link UpLink"]
```
or fallback:
```
h2.job-tile-title a
```

The title text may contain `<span class="highlight">` tags wrapping the search term. Strip these — use `textContent` not `innerHTML`.

**Example:**
```html
<h2 class="h5 mb-0 mr-2 job-tile-title">
  <a href="/jobs/span-class-highlight-Shopify-span-Store-Design...~022043271459774853868/..."
     data-test="job-tile-title-link UpLink"
     data-ev-job-uid="2043271459774853868">
    <span class="highlight">Shopify</span> Store Design and Development
  </a>
</h2>
```

**Job URL:** Read the `href` attribute from the title link. Prepend `https://www.upwork.com` if it starts with `/`.

### 5.3 Published Date

```
[data-test="job-pubilshed-date"]
```
(Note: Upwork has a typo — "pubilshed" not "published" — use exactly as shown)

Text content: "Posted 10 minutes ago" or "Posted 1 hour ago" or "Posted 2 hours ago"

**Parse:** Extract the text content as `postedRelative`. Then, to generate a concrete timestamp (`postedAt`), use a regex `/(\d+)\s+(minute|hour|day|week|month)s?\s+ago/i` to extract the amount and unit. Subtract that amount from `scrapedAt` to create an ISO timestamp!

### 5.4 Job Description

```
[data-test="UpCLineClamp JobDescription"] p
```
or:
```
p.mb-0.text-body-sm.rr-mask
```

The description is often clipped. `textContent` will give you what's visible on the page.

### 5.5 Skills / Tags

```
[data-test="TokenClamp JobAttrs"] [data-test="token"]
```

Each skill tag is a `<button>` with `data-test="token"`. The text inside:
```html
<button data-test="token" type="button" class="air3-token">
  <span class="highlight-color">Shopify</span>
</button>
```

Get all skills as an array of strings using `textContent.trim()` on each button.

### 5.6 Job Type & Budget

Both are inside `[data-test="JobInfo"]`:

```
[data-test="job-type-label"] strong    → "Fixed price" or "Hourly: $12.00 - $27.00"
[data-test="experience-level"] strong  → "Intermediate", "Expert", "Entry Level"
[data-test="is-fixed-price"] strong:last-child  → "$800.00" (budget for fixed price)
[data-test="duration-label"] strong:last-child  → "1 to 3 months, 30+ hrs/week"
```

### 5.7 Client Info

All inside `[data-test="JobInfoClient"]`:

```
[data-test="payment-verified"] .air3-badge-tagline-sm  
  → Check if class includes "is-verified" or "is-unverified"
  
[data-test="total-spent"] strong.rr-mask  
  → "$10K+", "$6K+", "$0", etc.
  
[data-test="location"] span.rr-mask  
  → Country code or name: "IDN", "India", "United States", "United Kingdom"
```

**Client Rating:** Inside a tooltip/popover `[data-test="popper transition UpTransition UpTransitionIntro"]`. The rating text appears in the tooltip content as "4.89 Stars, based on 10 feedbacks". This is in the DOM but hidden. Use the popper content:
```
[data-test="popper transition UpTransition UpTransitionIntro"] .air3-popper-content div
```

Note: This is fragile. Only attempt it; skip gracefully if not found.

### 5.8 Proposals Count

```
[data-test="proposals-tier"] strong  → "Less than 5", "5 to 10", "10 to 15", "20 to 50"
```

### 5.9 Page-Level Metadata

These can be read from the URL and page:
- **Search query:** `new URLSearchParams(window.location.search).get('q')`
- **Sort order:** `new URLSearchParams(window.location.search).get('sort')`
- **Page URL:** `window.location.href`

---

## 6. Complete JSON Schema for Stored Jobs

Every scraped job is stored as a complete JSON object. This is the schema:

```json
{
  "scrapeSessionId": "session_1712945200000",
  "scrapedAt": "2026-04-12T10:00:00.000Z",
  "pageUrl": "https://www.upwork.com/nx/search/jobs/?q=shopify&sort=recency",
  "searchQuery": "shopify",
  "sortOrder": "recency",
  "pageNumber": "1",
  "jobs": [
    {
      "jobId": "2043271459774853868",
      "positionOnPage": 1,
      "scrapedAt": "2026-04-12T10:00:00.000Z",
      
      "title": "Shopify Store Design and Development",
      "titleRaw": "Shopify Store Design and Development",
      "url": "https://www.upwork.com/jobs/Shopify-Store-Design-and-Development_~022043271459774853868/",
      "postedRelative": "10 minutes ago",
      "postedAt": "2026-04-12T09:50:00.000Z",
      
      "description": "We are looking for a skilled professional to build and design our Shopify store...",
      
      "skills": ["Shopify", "Shopify Templates", "Web Design", "Web Development", "Graphic Design"],
      
      "jobType": "hourly",
      "hourlyRateMin": 12.00,
      "hourlyRateMax": 27.00,
      "fixedBudget": null,
      "budgetRaw": "Hourly: $12.00 - $27.00",
      
      "experienceLevel": "Intermediate",
      "duration": "1 to 3 months",
      "hoursPerWeek": "30+ hrs/week",
      
      "client": {
        "paymentVerified": true,
        "totalSpent": "$0",
        "totalSpentNormalized": 0,
        "location": "IDN",
        "rating": null,
        "feedbackCount": null
      },
      
      "proposals": "Less than 5",
      "proposalsNormalized": 5
    }
  ]
}
```

### 6.1 Normalization Notes

**totalSpentNormalized** — Convert strings to numbers:
- "$0" → 0
- "$100+" → 100
- "$700+" → 700
- "$6K+" → 6000
- "$10K+" → 10000
- "$40K+" → 40000

**proposalsNormalized** — Convert to max of range:
- "Less than 5" → 5
- "5 to 10" → 10
- "10 to 15" → 15
- "20 to 50" → 50

**jobType** — Normalize:
- "Fixed price" → "fixed"
- "Hourly" or "Hourly: $X - $Y" → "hourly"

**hourlyRateMin / hourlyRateMax** — Parse from "Hourly: $12.00 - $27.00":
```javascript
const match = raw.match(/\$(\d+\.?\d*)\s*-\s*\$(\d+\.?\d*)/);
hourlyRateMin = match ? parseFloat(match[1]) : null;
hourlyRateMax = match ? parseFloat(match[2]) : null;
```

**fixedBudget** — Parse from "Est. budget: $800.00":
```javascript
const match = raw.match(/\$(\d+\.?\d*)/);
fixedBudget = match ? parseFloat(match[1]) : null;
```

---

## 7. manifest.json — Full Config

```json
{
  "manifest_version": 3,
  "name": "Upwork Keyword Finder",
  "version": "1.0.0",
  "description": "Scrape, store, and analyze Upwork job listings. Find top keywords with AI.",
  
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },

  "action": {
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png"
    },
    "default_title": "Open Upwork Keyword Finder"
  },

  "side_panel": {
    "default_path": "sidepanel/sidepanel.html"
  },

  "background": {
    "service_worker": "background/service-worker.js",
    "type": "module"
  },

  "content_scripts": [
    {
      "matches": [
        "https://www.upwork.com/nx/search/jobs/*",
        "https://www.upwork.com/jobs/*",
        "https://www.upwork.com/freelance-jobs/*"
      ],
      "js": [
        "lib/text-cleaner.js",
        "lib/keyword-algorithm.js",
        "content/scraper.js",
        "content/highlighter.js",
        "content/content-main.js"
      ],
      "run_at": "document_idle"
    }
  ],

  "permissions": [
    "sidePanel",
    "storage",
    "activeTab",
    "scripting",
    "downloads"
  ],

  "host_permissions": [
    "https://www.upwork.com/*"
  ]
}
```

---

## 8. Content Script — Manual Trigger Only

The content script **does NOT run automatically** when the page loads. It only performs scraping when a message is received from the side panel.

```javascript
// content/content-main.js

// Listen for scrape command from the side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  
  if (message.action === 'startScrape') {
    console.log('[UKF] Scrape triggered by user');
    
    try {
      const jobs = scrapeAllJobs();
      
      if (jobs.length === 0) {
        sendResponse({ success: false, error: 'No jobs found on this page. Make sure you are on an Upwork job search results page.' });
        return true;
      }
      
      sendResponse({ success: true, jobs, pageUrl: window.location.href });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
    
    return true; // Required for async response
  }

  if (message.action === 'highlightKeywords') {
    highlightKeywordsOnPage(message.keywords);
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'clearHighlights') {
    clearHighlights();
    sendResponse({ success: true });
    return true;
  }
  
  if (message.action === 'ping') {
    // Used by side panel to check if content script is active on this tab
    sendResponse({ active: true, isUpworkSearch: isUpworkSearchPage() });
    return true;
  }
});

function isUpworkSearchPage() {
  return document.querySelectorAll('[data-test="JobTile"]').length > 0;
}
```

---

## 9. Scraper — Complete Implementation

```javascript
// content/scraper.js

function scrapeAllJobs() {
  const jobTiles = document.querySelectorAll('[data-test="JobTile"]');
  const jobs = [];
  const scrapedAt = new Date().toISOString();
  
  jobTiles.forEach((tile, index) => {
    try {
      const job = extractJobFromTile(tile, index + 1, scrapedAt);
      if (job && job.title) {
        jobs.push(job);
      }
    } catch (err) {
      console.warn('[UKF] Failed to parse job tile at position', index + 1, err);
    }
  });
  
  return jobs;
}

function extractJobFromTile(tile, position, scrapedAt) {
  // --- JOB ID & POSITION ---
  const jobId = tile.getAttribute('data-ev-job-uid') || '';
  const pageNumber = tile.getAttribute('data-ev-page_number') || '1';
  
  // --- TITLE ---
  const titleLink = tile.querySelector('[data-test="job-tile-title-link UpLink"]') 
                 || tile.querySelector('h2.job-tile-title a');
  const title = titleLink ? titleLink.textContent.trim().replace(/\s+/g, ' ') : '';
  
  // Build clean URL
  let url = '';
  if (titleLink) {
    const href = titleLink.getAttribute('href') || '';
    url = href.startsWith('http') ? href : `https://www.upwork.com${href}`;
  }
  
  // --- POSTED DATE ---
  const dateEl = tile.querySelector('[data-test="job-pubilshed-date"]');
  const postedRelative = dateEl ? dateEl.textContent.trim().replace(/\s+/g, ' ') : '';
  
  // --- DESCRIPTION ---
  const descEl = tile.querySelector('[data-test="UpCLineClamp JobDescription"] p')
              || tile.querySelector('p.mb-0.text-body-sm.rr-mask');
  const description = descEl ? descEl.textContent.trim().replace(/\s+/g, ' ') : '';
  
  // --- SKILLS ---
  const skillEls = tile.querySelectorAll('[data-test="TokenClamp JobAttrs"] [data-test="token"]');
  const skills = Array.from(skillEls)
    .map(el => el.textContent.trim())
    .filter(s => s && s !== '+' && !/^\+\d+$/.test(s)); // exclude "+9" overflow indicators
  
  // --- JOB TYPE & BUDGET ---
  const jobTypeEl = tile.querySelector('[data-test="job-type-label"] strong');
  const budgetRaw = jobTypeEl ? jobTypeEl.textContent.trim() : '';
  
  let jobType = 'unknown';
  let hourlyRateMin = null;
  let hourlyRateMax = null;
  let fixedBudget = null;
  
  if (budgetRaw.toLowerCase().includes('fixed')) {
    jobType = 'fixed';
    const budgetEl = tile.querySelector('[data-test="is-fixed-price"] strong:last-child');
    if (budgetEl) {
      const match = budgetEl.textContent.match(/\$(\d+\.?\d*)/);
      fixedBudget = match ? parseFloat(match[1]) : null;
    }
  } else if (budgetRaw.toLowerCase().includes('hourly')) {
    jobType = 'hourly';
    const match = budgetRaw.match(/\$(\d+\.?\d*)\s*-\s*\$(\d+\.?\d*)/);
    if (match) {
      hourlyRateMin = parseFloat(match[1]);
      hourlyRateMax = parseFloat(match[2]);
    }
  }
  
  // --- EXPERIENCE LEVEL ---
  const expEl = tile.querySelector('[data-test="experience-level"] strong');
  const experienceLevel = expEl ? expEl.textContent.trim() : '';
  
  // --- DURATION ---
  const durationEl = tile.querySelector('[data-test="duration-label"] strong:last-child');
  const durationRaw = durationEl ? durationEl.textContent.trim() : '';
  let duration = '';
  let hoursPerWeek = '';
  if (durationRaw.includes(',')) {
    const parts = durationRaw.split(',');
    duration = parts[0].trim();
    hoursPerWeek = parts[1].trim();
  } else {
    duration = durationRaw;
  }
  
  // --- CLIENT INFO ---
  const verifiedEl = tile.querySelector('[data-test="payment-verified"] .air3-badge-tagline-sm');
  const paymentVerified = verifiedEl ? verifiedEl.classList.contains('is-verified') : false;
  
  const spentEl = tile.querySelector('[data-test="total-spent"] strong.rr-mask');
  const totalSpentRaw = spentEl ? spentEl.textContent.trim() : '$0';
  const totalSpentNormalized = parseSpentAmount(totalSpentRaw);
  
  const locationEl = tile.querySelector('[data-test="location"] span.rr-mask');
  const location = locationEl ? locationEl.textContent.replace('Location', '').trim() : '';
  
  // Client rating (from tooltip - may not always be present)
  let clientRating = null;
  let feedbackCount = null;
  const tooltipEl = tile.querySelector('.air3-popper.air3-tooltip .air3-popper-content div');
  if (tooltipEl) {
    const ratingText = tooltipEl.textContent;
    const ratingMatch = ratingText.match(/(\d+\.\d+)\s+Stars/);
    const feedbackMatch = ratingText.match(/based on (\d+) feedbacks/);
    if (ratingMatch) clientRating = parseFloat(ratingMatch[1]);
    if (feedbackMatch) feedbackCount = parseInt(feedbackMatch[1]);
  }
  
  // --- PROPOSALS ---
  const proposalsEl = tile.querySelector('[data-test="proposals-tier"] strong');
  const proposals = proposalsEl ? proposalsEl.textContent.trim() : '';
  const proposalsNormalized = parseProposals(proposals);
  
  return {
    jobId,
    positionOnPage: position,
    pageNumber,
    scrapedAt,
    title,
    url,
    postedRelative,
    description,
    skills,
    jobType,
    hourlyRateMin,
    hourlyRateMax,
    fixedBudget,
    budgetRaw,
    experienceLevel,
    duration,
    hoursPerWeek,
    client: {
      paymentVerified,
      totalSpent: totalSpentRaw,
      totalSpentNormalized,
      location,
      rating: clientRating,
      feedbackCount
    },
    proposals,
    proposalsNormalized
  };
}

function parseSpentAmount(raw) {
  if (!raw || raw === '$0') return 0;
  const match = raw.match(/\$(\d+(?:\.\d+)?)(K\+)?/i);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const isK = match[2] ? true : false;
  return isK ? num * 1000 : num;
}

function parseProposals(raw) {
  if (!raw) return 0;
  const match = raw.match(/(\d+)\s+to\s+(\d+)/);
  if (match) return parseInt(match[2]);
  const ltMatch = raw.match(/Less than\s+(\d+)/i);
  if (ltMatch) return parseInt(ltMatch[1]);
  const rangeMatch = raw.match(/(\d+)\s*\+/);
  if (rangeMatch) return parseInt(rangeMatch[1]);
  return 0;
}
```

---

## 10. Storage — Jobs Database on Local Machine

### 10.1 Storage Architecture

All data is stored in `chrome.storage.local`. This is stored on the user's local machine, not synced to cloud. The storage limit is 10MB by default (can be increased with `unlimitedStorage` permission if needed).

```javascript
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
}

export async function savePreferences(newPrefs) {
  const current = await getPreferences();
  await chrome.storage.local.set({ [PREFS_KEY]: { ...current, ...newPrefs } });
}

export async function clearAllStorage() {
    await chrome.storage.local.remove([DB_KEY, META_KEY, KEYWORDS_KEY, HISTORY_KEY]);
}
```

### 10.2 Export Feature

The "Export All Jobs" button in the side panel calls `exportAllToJSON()`. This creates a JSON file download that the user saves to their local machine. This is the main way to get data out for external analysis.

---

## 11. Background Service Worker

```javascript
// background/service-worker.js

import { saveSession, getStorageStats, saveKeywordAnalysis, getMasterJobs, getExtractionHistory } from '../lib/storage-manager.js';
import { computeTFIDF } from '../lib/keyword-algorithm.js';

const AI_CACHE_KEY = 'aiJobKeywords';

// Open side panel when extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

let aiSession = null;

// Handle messages from content script and side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // ... existing handlers (saveSession, getStats, getHistory, checkAI) ...
  
  if (message.action === 'analyzeAllKeywords') {
    getMasterJobs().then(async masterJobs => {
        try {
            // 1. Run Algorithm immediately
            const algoResult = computeTFIDF(masterJobs);
            const algorithmData = {
                skillKeywords: topN(algoResult.skillKeywords, 20),
                titleKeywords: topN(algoResult.titleKeywords, 20),
                actionPhrases: topN(algoResult.actionPhrases, 15)
            };
            
            const initialResult = { method: 'algorithm', algorithm: algorithmData };
            const aiStatus = await checkAIAvailability();
            const aiRunning = aiStatus.available;
            
            sendResponse({ success: true, data: initialResult, aiRunning: aiRunning });
            
            // 2. Trigger AI in background if available
            if (aiRunning) {
                runAIBackground(masterJobs, algorithmData);
            } else {
                await saveKeywordAnalysis(initialResult);
            }
        } catch (err) {
            sendResponse({ success: false, error: err.message });
        }
    });
    return true;
  }
});

async function runAIBackground(masterJobs, algorithmData) {
    try {
        const latestJobs = [...masterJobs]
            .sort((a, b) => new Date(b.scrapedAt) - new Date(a.scrapedAt))
            .slice(0, 100);
            
        // INCREMENTAL PROCESSING (CACHE)
        const storage = await chrome.storage.local.get(AI_CACHE_KEY);
        const aiCache = storage[AI_CACHE_KEY] || {};
        
        const unprocessedJobs = latestJobs.filter(j => !aiCache[j.jobId]);
        
        if (unprocessedJobs.length > 0) {
            const session = await getAISession();
            const newResults = await extractKeywordsWithAI(unprocessedJobs, session);
            
            // Update Cache
            Object.assign(aiCache, newResults);
            await chrome.storage.local.set({ [AI_CACHE_KEY]: aiCache });
        }

        // AGGREGATE RESULTS FROM CACHE
        const aiResult = aggregateAIResults(latestJobs, aiCache);
        
        const finalResult = {
            method: 'both',
            algorithm: algorithmData,
            ai: aiResult
        };
        
        await saveKeywordAnalysis(finalResult);
        chrome.runtime.sendMessage({ action: 'aiAnalysisComplete', success: true, data: finalResult });
        
    } catch (err) {
        chrome.runtime.sendMessage({ action: 'aiAnalysisComplete', success: false, error: err.message });
    }
}

async function extractKeywordsWithAI(jobs, session) {
  const CHUNK_SIZE = 10;
  const allResults = {}; // Map of jobId -> {s, t, p}
  
  for (let i = 0; i < jobs.length; i += CHUNK_SIZE) {
    const chunk = jobs.slice(i, i + CHUNK_SIZE);
    const jobsText = chunk.map((job, idx) => 
      `[J${idx+1}] T: ${job.title.substring(0,80)} | S: ${job.skills.slice(0,6).join(',')} | D: ${job.description.substring(0,60)}`
    ).join('\n');
    
    const prompt = `Extract keywords for EACH job separately.
${jobsText}
Return ONLY valid JSON: {"1": {"s":["skill"], "t":["title"], "p":["phrase"]}, "2": ...}`;

    try {
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('AI timeout')), 60000));
      const response = await Promise.race([session.prompt(prompt), timeout]);
      const parsed = JSON.parse(response.replace(/```json|```/g, '').trim());
      
      chunk.forEach((job, idx) => {
        const res = parsed[(idx+1).toString()];
        if (res) allResults[job.jobId] = { s: res.s||[], t: res.t||[], p: res.p||[] };
      });
    } catch (err) { console.warn('Chunk failed', err); }
  }
  return allResults;
}

function aggregateAIResults(jobs, cache) {
  const aggregated = { skillKeywords: {}, titleKeywords: {}, actionPhrases: {} };
  jobs.forEach(job => {
    const res = cache[job.jobId];
    if (!res) return;
    res.s.forEach(kw => updateCount(aggregated.skillKeywords, kw));
    res.t.forEach(kw => updateCount(aggregated.titleKeywords, kw));
    res.p.forEach(kw => updateCount(aggregated.actionPhrases, kw));
  });
  return {
    skillKeywords: topN(aggregated.skillKeywords, 20),
    titleKeywords: topN(aggregated.titleKeywords, 20),
    actionPhrases: topN(aggregated.actionPhrases, 15)
  };
}
```

---

## 12. Side Panel HTML & UI

### 12.1 Layout Strategy (Flex-Column)

To ensure a premium feel and prevent the "disappearing button" problem, the side panel uses a **non-scrollable outer container** with three distinct zones:
1. **kf-header** (Fixed): Shows total job count and the primary "Start Analyzing" button.
2. **kf-scroll** (Scrollable): Contains the actual keyword result lists (AI results above algorithm results).
3. **analyze-progress** (Sticky Bottom): A progress banner that appears during AI tasks, showing live stats without overlapping content.

### 12.2 sidepanel.html Structure

```html
<div id="view-results" class="view">
  <!-- 1. Top Header -->
  <div class="kf-header">
    <div class="kf-job-count" id="kf-total-jobs">0</div>
    <button id="btn-analyze" class="btn btn-primary">🧠 Start Analyzing</button>
  </div>

  <!-- 2. Scrollable Body -->
  <div class="kf-scroll">
    <div id="results-content">
       <!-- AI Section -->
       <div id="ai-results-section">...</div>
       <!-- Algorithm Section -->
       <div class="kf-section-label">⚙️ Smart Algorithm</div>
       ...
    </div>
  </div>

  <!-- 3. Sticky Bottom Banner -->
  <div id="analyze-progress">
    <div class="progress-bar"><div class="progress-fill"></div></div>
    <div id="ai-live-stats">...</div>
  </div>
</div>
```

    <!-- View: History -->
    <div id="view-history" class="view">
      <div class="history-header">
        <h3>Scrape History</h3>
        <button id="btn-export" class="btn btn-secondary">⬇️ Export All JSON</button>
      </div>
      <div id="history-list"></div>
    </div>

    <!-- View: Settings -->
    <div id="view-settings" class="view">
      <div class="setting-row">
        <label>Min keyword frequency</label>
        <input type="number" id="pref-min-freq" min="1" max="20" value="2">
      </div>
      <div class="setting-row">
        <label>Highlight keywords on page</label>
        <input type="checkbox" id="pref-highlight" checked>
      </div>
      <div class="setting-row">
        <button id="btn-clear-storage" class="btn btn-danger">🗑️ Clear All Stored Data</button>
      </div>
    </div>
    
  </div>
  <script src="sidepanel.js"></script>
</body>
</html>
```

### 12.3 Key Side Panel JS Flow

```javascript
// sidepanel/sidepanel.js (key logic)

// On load — check if we're on an Upwork page
async function init() {
  await loadStats();
  await checkCurrentPage();
}

async function checkCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
    if (response && response.active) {
      document.getElementById('btn-scrape').disabled = false;
      document.getElementById('scrape-hint').textContent = 
        response.isUpworkSearch 
          ? `Ready — ${document.querySelectorAll ? '' : ''} scrape this page` 
          : 'Page loaded. Click Scrape to start.';
    }
  } catch {
    document.getElementById('scrape-hint').textContent = 'Navigate to an Upwork job search page first';
  }
}

async function handleScrape() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  showProgress('Scraping job listings...');
  
  const scrapeResponse = await chrome.tabs.sendMessage(tab.id, { action: 'startScrape' });
  
  if (!scrapeResponse.success) {
    showError(scrapeResponse.error);
    return;
  }
  
  const { jobs, pageUrl } = scrapeResponse;
  updateProgress(`Found ${jobs.length} jobs. Analyzing keywords...`);
  
  // Build session object
  const session = {
    scrapeSessionId: `session_${Date.now()}`,
    scrapedAt: new Date().toISOString(),
    pageUrl,
    searchQuery: new URL(pageUrl).searchParams.get('q') || '',
    sortOrder: new URL(pageUrl).searchParams.get('sort') || '',
    pageNumber: new URL(pageUrl).searchParams.get('page') || '1',
    jobCount: jobs.length,
    jobs
  };
  
  // Save jobs to storage
  await chrome.runtime.sendMessage({ action: 'saveSession', sessionData: session });
  
  // Analyze keywords
  updateProgress('Running AI keyword analysis...');
  const keywordsResponse = await chrome.runtime.sendMessage({ action: 'analyzeKeywords', jobs });
  
  if (keywordsResponse.success) {
    const keywords = keywordsResponse.data;
    
    // Display results
    displayKeywords(keywords);
    switchView('results');
    
    // Highlight on page if enabled
    const prefs = await getPreferences();
    if (prefs.highlightEnabled) {
      const allKeywords = [
        ...keywords.skillKeywords,
        ...keywords.titleKeywords
      ];
      await chrome.tabs.sendMessage(tab.id, { action: 'highlightKeywords', keywords: allKeywords });
    }
  }
  
  hideProgress();
  updateStats();
}
```

---

## 13. Chrome Built-in AI Integration

### 13.1 AI Prompt for Keyword Extraction

```javascript
// In service worker

async function extractKeywordsWithAI(jobs, session) {
  // Chunk jobs to stay within context window
  const CHUNK_SIZE = 8;
  const allResults = { skillKeywords: {}, titleKeywords: {}, actionPhrases: {} };
  
  for (let i = 0; i < jobs.length; i += CHUNK_SIZE) {
    const chunk = jobs.slice(i, i + CHUNK_SIZE);
    const jobsText = chunk.map((job, idx) => 
      `[JOB ${i + idx + 1}]\nTitle: ${job.title}\nDesc: ${job.description.substring(0, 300)}\nSkills: ${job.skills.join(', ')}`
    ).join('\n\n');
    
    const prompt = `
Analyze these ${chunk.length} Upwork job listings. Extract keywords.

${jobsText}

Return ONLY valid JSON, no markdown, no explanation:
{
  "skillKeywords": [{"keyword": "React", "count": 3, "importance": "high"}],
  "titleKeywords": [{"keyword": "Developer Needed", "count": 5, "importance": "high"}],
  "actionPhrases": [{"keyword": "looking for", "count": 4, "importance": "medium"}]
}

Rules:
- skillKeywords: specific technologies, tools, platforms (Shopify, React, Python, etc.)
- titleKeywords: meaningful noun phrases from job titles
- actionPhrases: what clients say they want ("experienced developer", "fast delivery")
- Only include items with count >= 1 in this chunk
- importance: "high" for specific skills/tech, "medium" for common phrases, "low" for generic
`;

    try {
      const response = await session.prompt(prompt);
      const cleaned = response.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      
      // Merge with accumulated results
      mergeKeywordResults(allResults, parsed);
    } catch (err) {
      console.warn('[UKF] AI chunk failed:', err);
    }
  }
  
  // Sort and return top results
  return {
    skillKeywords: topN(allResults.skillKeywords, 20),
    titleKeywords: topN(allResults.titleKeywords, 20),
    actionPhrases: topN(allResults.actionPhrases, 15)
  };
}

function mergeKeywordResults(accumulated, newChunk) {
  ['skillKeywords', 'titleKeywords', 'actionPhrases'].forEach(category => {
    if (!newChunk[category]) return;
    newChunk[category].forEach(item => {
      const key = item.keyword.toLowerCase();
      if (accumulated[category][key]) {
        accumulated[category][key].count += item.count;
      } else {
        accumulated[category][key] = { ...item };
      }
    });
  });
}

function topN(obj, n) {
  return Object.values(obj)
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}
```

---

## 14. Keyword Algorithm (Fallback)

```javascript
// lib/keyword-algorithm.js

function computeTFIDF(jobs) {
  const docs = jobs.map(job => {
    // Title weighted 3x by repeating
    const text = `${job.title} ${job.title} ${job.title} ${job.description} ${job.skills.join(' ')}`;
    return tokenize(text);
  });
  
  // Count all terms
  const termCounts = {};
  docs.forEach(doc => {
    const unique = new Set(doc);
    unique.forEach(term => {
      termCounts[term] = (termCounts[term] || 0) + 1;
    });
  });
  
  // IDF score
  const totalDocs = docs.length;
  const idf = {};
  Object.keys(termCounts).forEach(term => {
    idf[term] = Math.log(totalDocs / termCounts[term]);
  });
  
  // TF-IDF per term
  const allTermFreqs = {};
  docs.flat().forEach(term => {
    allTermFreqs[term] = (allTermFreqs[term] || 0) + 1;
  });
  
  const scores = Object.entries(allTermFreqs)
    .filter(([term]) => term.length > 2 && !STOP_WORDS.has(term))
    .map(([keyword, freq]) => ({
      keyword,
      count: termCounts[keyword] || 0,
      frequency: freq,
      score: freq * (1 + (idf[keyword] || 0)),
      importance: freq > 5 ? 'high' : freq > 2 ? 'medium' : 'low'
    }))
    .sort((a, b) => b.score - a.score);
  
  // Bigrams
  const bigrams = computeBigrams(docs);
  
  // Extract from skills tags specifically
  const skillFreqs = {};
  jobs.forEach(job => {
    job.skills.forEach(skill => {
      const normalized = skill.toLowerCase();
      skillFreqs[normalized] = (skillFreqs[normalized] || 0) + 1;
    });
  });
  
  const skillKeywords = Object.entries(skillFreqs)
    .filter(([_, count]) => count >= 1)
    .map(([keyword, count]) => ({
      keyword: keyword.charAt(0).toUpperCase() + keyword.slice(1),
      count,
      importance: count > 3 ? 'high' : 'medium'
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
  
  return {
    skillKeywords,
    titleKeywords: [...bigrams, ...scores.slice(0, 30)].slice(0, 20),
    actionPhrases: scores.filter(s => s.importance === 'medium').slice(0, 15)
  };
}

function computeBigrams(docs) {
  const bigramCounts = {};
  docs.forEach(doc => {
    for (let i = 0; i < doc.length - 1; i++) {
      if (STOP_WORDS.has(doc[i]) || STOP_WORDS.has(doc[i+1])) continue;
      const bigram = `${doc[i]} ${doc[i+1]}`;
      bigramCounts[bigram] = (bigramCounts[bigram] || 0) + 1;
    }
  });
  return Object.entries(bigramCounts)
    .filter(([_, count]) => count >= 2)
    .map(([keyword, count]) => ({ keyword, count, importance: 'high' }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);
}
```

---

## 15. Highlight Engine

```javascript
// content/highlighter.js

const HIGHLIGHT_COLORS = {
  high:   { bg: '#FFF176', border: '#F9A825' },
  medium: { bg: '#E8F5E9', border: '#66BB6A' },
  low:    { bg: '#E3F2FD', border: '#42A5F5' }
};

function highlightKeywordsOnPage(keywords) {
  clearHighlights();
  
  if (!keywords || keywords.length === 0) return;
  
  // Sort by keyword length desc (longer phrases first)
  const sorted = [...keywords].sort((a, b) => b.keyword.length - a.keyword.length);
  
  // Target only job tile text areas
  const targets = document.querySelectorAll(
    '[data-test="JobTile"] h2, [data-test="JobTile"] [data-test="UpCLineClamp JobDescription"] p'
  );
  
  targets.forEach(element => {
    sorted.forEach(({ keyword, importance }) => {
      if (!keyword || keyword.length < 3) return;
      highlightInElement(element, keyword, importance || 'low');
    });
  });
}

function highlightInElement(element, keyword, importance) {
  const color = HIGHLIGHT_COLORS[importance] || HIGHLIGHT_COLORS.low;
  const style = `background:${color.bg};border:1px solid ${color.border};border-radius:3px;padding:0 2px`;
  const regex = new RegExp(`\\b(${escapeRegex(keyword)})\\b`, 'gi');
  
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let node;
  while (node = walker.nextNode()) textNodes.push(node);
  
  textNodes.forEach(textNode => {
    if (!regex.test(textNode.textContent)) return;
    regex.lastIndex = 0;
    
    const span = document.createElement('span');
    span.innerHTML = textNode.textContent.replace(regex, 
      `<mark class="ukf-hl ukf-${importance}" style="${style}" data-ukf="${keyword}">$1</mark>`
    );
    textNode.parentNode.replaceChild(span, textNode);
  });
}

function clearHighlights() {
  document.querySelectorAll('.ukf-hl').forEach(el => {
    el.replaceWith(document.createTextNode(el.textContent));
  });
  // Clean up empty spans left behind
  document.querySelectorAll('span:empty').forEach(el => el.remove());
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

---

## 16. Data Flow — Complete Picture

```
USER CLICKS "Scrape Jobs" IN SIDE PANEL
              │
              ▼
Side Panel sends message: { action: 'startScrape' }
              │
              ▼
Content Script (content-main.js) receives message
              │
              ▼
scraper.js reads Upwork DOM:
  - Finds all article[data-test="JobTile"]
  - Extracts: title, description, skills, budget, 
    client info, proposals, experience, duration
              │
              ▼
Sends jobs[] back to Side Panel
              │
         ┌────┴────────────────────────┐
         ▼                             ▼
Side Panel builds             Side Panel sends to
session JSON object           background: { action: 'analyzeKeywords' }
         │                             │
         ▼                             ▼
Sends to background:          Service Worker:
{ action: 'saveSession' }       1. Try Gemini Nano AI
         │                      2. Fall back to TF-IDF
         ▼                             │
chrome.storage.local.set()             ▼
(persists all jobs)            Returns keyword results
                                       │
                               ┌───────┴───────────────┐
                               ▼                        ▼
                       Side Panel renders         Content Script:
                       keyword cards              highlightKeywordsOnPage()
                       in Results tab             marks up Upwork DOM
```

---

## 17. Chrome Built-in AI Setup Requirements

For the AI feature to work, users need Chrome 138+ and these hardware specs:
- Windows 10/11, macOS 13+, or Linux
- At least 22 GB free disk space
- GPU: >4 GB VRAM, OR CPU: ≥16 GB RAM + ≥4 cores

The extension MUST detect availability and fall back gracefully. The side panel should show a clear indicator: **"🤖 AI Mode"** or **"⚡ Smart Mode (Fallback)"**.

Users who want to enable AI:
1. Open `chrome://flags`
2. Enable `#prompt-api-for-gemini-nano`
3. Enable `#optimization-guide-on-device-model` → "Enabled BypassPerfRequirement"
4. Open `chrome://components` → update "Optimization Guide On Device Model"

---

## 18. Phase-by-Phase Build Plan

### Phase 1 — Core MVP (Week 1)
- [ ] Create all files/folders per Section 4
- [ ] Write `manifest.json` with Side Panel config
- [ ] Implement Side Panel HTML with Home view
- [ ] Implement background service worker (Side Panel opener only)
- [ ] Implement content script message listener
- [ ] Implement scraper with all selectors from Section 5
- [ ] Implement `storage-manager.js` save/read/export
- [ ] Connect scrape button → scraper → storage → display job count
- [ ] Load extension in Chrome, test on Upwork, verify jobs stored

### Phase 2 — Keyword Analysis (Week 2)
- [ ] Implement `text-cleaner.js` with stop words
- [ ] Implement `keyword-algorithm.js` (TF-IDF + bigrams)
- [ ] Connect analysis results to Side Panel Results view
- [ ] Implement `highlighter.js`
- [ ] Connect highlight to keyword results
- [ ] Add AI availability check and Gemini Nano integration
- [ ] Add AI/fallback mode badge

### Phase 3 — History & Export (Week 2-3)
- [ ] Implement History view with session list
- [ ] Implement JSON export (download to machine)
- [ ] Implement storage stats on Home view
- [ ] Implement Settings view (prefs, clear data)

### Phase 4 — Polish (Week 3-4)
- [ ] Side Panel UI styling
- [ ] Error states (no jobs found, wrong page, etc.)
- [ ] Copy keywords to clipboard button
- [ ] Session delete from history
- [ ] Loading animations during scrape

---

## 19. Known Challenges & Solutions

| Challenge | Solution |
|---|---|
| Side Panel can't directly call `chrome.tabs.query()` | Side panel IS a chrome extension page so it CAN call `chrome.tabs` APIs |
| Content script not injected yet on page | Use `ping` message + `try/catch` to detect; show error if not active |
| Upwork uses React — DOM changes dynamically | Scrape only on manual trigger (user already sees jobs); no need for MutationObserver in basic mode |
| Service worker sleeps between requests | Recreate AI session on each analysis; store session reference but handle recreation |
| `<span class="highlight">` inside title text | Use `textContent` not `innerHTML`; strips all markup automatically |
| Rating tooltip content unreliable | Try to read it but `catch` gracefully and set null |
| `chrome.storage.local` has 10MB default limit | With 100 sessions × 20 jobs × ~2KB per job ≈ 4MB, well within limits. Add `unlimitedStorage` permission if needed |
| Skills `+9` overflow indicator shows up | Filter tokens matching `/^\+\d+$/` pattern |
| Title link href has encoded HTML entities | Use `textContent` which decodes automatically; for URL clean with `href` attribute |

---

## 20. Data Consolidation Workflow

To convert individual scrape exports into a unified dataset for analysis, a consolidation step is required. This is handled by `analytics/consolidate.js`.

### 20.1 Workflow
1. User scrapes jobs across multiple days/pages.
2. User uses the "Export JSON" feature in the sidepanel to save files to the `data/` folder.
3. User runs `node analytics/consolidate.js`.
4. The script:
   - Scans the `data/` directory for all `.json` files.
   - Parses every session and every job.
   - De-duplicates jobs based on `jobId`.
   - Keeps the record with the most recent `scrapedAt` timestamp.
   - Outputs a single `master-data.json` file in the `analytics/` folder.

---

## 21. Analytics Dashboard Architecture

The dashboard is a premium visual layer built with **Chart.js v4.4.2** (localized in `lib/chart.min.js` to comply with CSP).

### 21.1 Core Components
- **`analytics.html`**: The UI structure using CSS Grid and Flexbox for a responsive, dark-mode dashboard.
- **`analytics.css`**: Premium styling featuring Glassmorphism, fade-in animations, and custom color tokens.
- **`analytics.js`**: The processing engine that:
  - Fetches `master-data.json`.
  - Calculates KPIs (Total Jobs, Avg Proposals, Total Analyzed Budget).
  - Generates Time Series data for posting trends.
  - Computes a **Competition Heatmap** (Day of Week vs. Hour of Day).
  - Suggests **Optimal Application Windows** based on historical proposal density.
  - Renders a filterable **Job Feed** with detailed job cards.

### 21.2 Local Library Management
To bypass Chrome Extension Content Security Policy (CSP), **Chart.js** must be hosted locally. 
- Path: `lib/chart.min.js`
- Reference: `<script src="../lib/chart.min.js"></script>`

---

## 22. Quick Reference — All Selectors

```javascript
// COPY-PASTE READY — All Upwork DOM selectors

// Page-level: List of all jobs
'[data-test="JobTile"]'                              // each job article

// Job ID (from article element)
tile.getAttribute('data-ev-job-uid')                 // "2043271459774853868"
tile.getAttribute('data-ev-position')                // "1"
tile.getAttribute('data-ev-page_number')             // "1"

// Title
'[data-test="job-tile-title-link UpLink"]'           // <a> with text and href
'h2.job-tile-title a'                                // fallback

// Published date
'[data-test="job-pubilshed-date"]'                   // full text: "Posted 10 minutes ago"

// Description  
'[data-test="UpCLineClamp JobDescription"] p'        // description paragraph
'p.mb-0.text-body-sm.rr-mask'                        // fallback

// Skills/tags
'[data-test="TokenClamp JobAttrs"] [data-test="token"]'  // each skill button

// Job type & budget
'[data-test="job-type-label"] strong'                // "Fixed price" or "Hourly: $X - $Y"
'[data-test="is-fixed-price"] strong:last-child'     // fixed budget amount e.g. "$800.00"
'[data-test="duration-label"] strong:last-child'     // "1 to 3 months, 30+ hrs/week"

// Experience
'[data-test="experience-level"] strong'              // "Intermediate", "Expert", "Entry Level"

// Client info
'[data-test="payment-verified"] .air3-badge-tagline-sm'  // check is-verified / is-unverified class
'[data-test="total-spent"] strong.rr-mask'           // "$10K+", "$0"
'[data-test="location"] span.rr-mask'                // "IDN", "India", "United States"

// Client rating (from tooltip - read-only, may be hidden)
'.air3-popper.air3-tooltip .air3-popper-content div' // "4.89 Stars, based on 10 feedbacks"

// Proposals
'[data-test="proposals-tier"] strong'                // "Less than 5", "10 to 15", "20 to 50"
```

---

## 23. Text Formatting Toolbar (v2.2)

Upwork's input fields (proposals, messages) are plain text `textarea` elements and do not support Markdown or rich text. To solve this, version 2.2 introduces a global formatting toolbar.

### 23.1 How it Works
1. A global `focusin` listener detects when a user clicks into a `<textarea>`.
2. A lightweight, floating toolbar (`#upwork-fmt-toolbar`) is injected directly above the textarea.
3. **Unicode Translation**: When the user selects text and clicks "B" (Bold) or "I" (Italic), the extension reads the selection and converts standard characters (a-z, A-Z, 0-9) to their **Mathematical Alphanumeric** Unicode equivalents.
4. **Emojis**: An emoji picker allows instant insertion of common emojis at the cursor position.

### 23.2 Architecture
- **Files**: `content/toolbar.js`, `content/toolbar.css`
- **Scope**: Matched to `https://www.upwork.com/*` in `manifest.json` so it works everywhere.
- **Validity**: Upwork natively supports standard UTF-8 encoding. The Unicode mathematical bold characters (e.g., `U+1D5D4` for 𝗔) are saved and rendered seamlessly by Upwork's backend.

---

*Specification version 2.2 — May 2026*
*Built for: Claude Code, Cursor, or any AI coding agent*
*All selectors verified against live Upwork HTML (April 2026)*
