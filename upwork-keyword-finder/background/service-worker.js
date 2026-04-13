// background/service-worker.js

import { saveSession, getSessions, getStorageStats, deleteSession, saveKeywordAnalysis, exportAllToJSON } from '../lib/storage-manager.js';
import { computeTFIDF } from '../lib/keyword-algorithm.js';

// Open side panel when extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

let aiSession = null;

// Handle messages from content script and side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log(`[Background] Received message action: ${message.action}`);
  
  if (message.action === 'saveSession') {
    saveSession(message.sessionData)
      .then(id => {
          console.log(`[Background] Session saved: ${id}`);
          sendResponse({ success: true, sessionId: id })
      })
      .catch(err => {
          console.error('[Background] Session save error:', err);
          sendResponse({ success: false, error: err.message });
      });
    return true;
  }
  
  if (message.action === 'getSessions') {
    getSessions()
      .then(sessions => sendResponse({ success: true, sessions }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  
  if (message.action === 'getStats') {
    getStorageStats()
      .then(stats => sendResponse({ success: true, stats }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  
  if (message.action === 'analyzeKeywords') {
    console.log('[Background] Starting keyword analysis for jobs count:', message.jobs?.length);
    analyzeKeywords(message.jobs)
      .then(result => {
          console.log('[Background] Keyword analysis complete.');
          sendResponse({ success: true, data: result });
      })
      .catch(err => {
          console.error('[Background] Keyword analysis threw error:', err);
          sendResponse({ success: false, error: err.message });
      });
    return true;
  }
  
  if (message.action === 'checkAI') {
    checkAIAvailability()
      .then(status => sendResponse(status))
      .catch(() => sendResponse({ available: false }));
    return true;
  }
  
  if (message.action === 'exportJSON') {
    exportAllToJSON()
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  
  if (message.action === 'deleteSession') {
    deleteSession(message.sessionId)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function analyzeKeywords(jobs) {
  console.log('[Background] analyzeKeywords invoked');
  const aiStatus = await checkAIAvailability();
  
  if (aiStatus.available) {
    try {
      console.log('[Background] Using AI Model to extract keywords');
      const session = await getAISession();
      const result = await extractKeywordsWithAI(jobs, session);
      if (result) {
        console.log('[Background] AI extraction successful');
        await saveKeywordAnalysis({ ...result, method: 'ai' });
        return { ...result, method: 'ai' };
      }
    } catch (err) {
      console.warn('[Background] AI analysis failed, falling back to algorithm:', err);
    }
  }
  
  // Fallback
  console.log('[Background] Using TF-IDF Algorithm for keyword extraction');
  const result = computeTFIDF(jobs);
  console.log('[Background] Algorithm returned result payload');
  await saveKeywordAnalysis({ ...result, method: 'algorithm' });
  return { ...result, method: 'algorithm' };
}

async function checkAIAvailability() {
  if (!('LanguageModel' in self) && !('ai' in self)) {
    return { available: false, reason: 'LanguageModel API not available in this Chrome version' };
  }
  
  // Handling the newly updated Chrome AI API where it might be structured differently
  const aiObj = self.ai || self.LanguageModel;
  
  try {
    const status = await (aiObj.languageModel ? aiObj.languageModel.capabilities() : aiObj.availability());
    const isAvailable = typeof status === 'object' ? status.available !== 'no' : status !== 'no';
    return {
      available: isAvailable,
      needsDownload: typeof status === 'object' ? status.available === 'after-download' : status === 'after-download',
      status: typeof status === 'object' ? status.available : status
    };
  } catch {
    return { available: false, reason: 'API error' };
  }
}

async function getAISession() {
  if (aiSession) return aiSession;
  
  const aiObj = self.ai?.languageModel || self.LanguageModel;
  
  aiSession = await aiObj.create({
    systemPrompt: `You are a keyword extraction expert for freelance job postings on Upwork. 
When given job data, identify and return keywords in valid JSON only. No other text.`
  });
  
  return aiSession;
}

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

self.addEventListener('suspend', () => {
  if (aiSession && typeof aiSession.destroy === 'function') {
      aiSession.destroy(); 
      aiSession = null; 
  }
});
