// background/service-worker.js

import {
  saveSession,
  getStorageStats,
  saveKeywordAnalysis,
  getMasterJobs,
  getExtractionHistory,
} from "../lib/storage-manager.js";
import { computeTFIDF } from "../lib/keyword-algorithm.js";

const AI_CACHE_KEY = 'aiJobKeywords';

// Open side panel when extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

let aiSession = null;

// Handle messages from content script and side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log(`[Background] Received message action: ${message.action}`);

  if (message.action === "saveSession") {
    saveSession(message.sessionData)
      .then((id) => {
        console.log(`[Background] Session saved: ${id}`);
        sendResponse({ success: true, sessionId: id });
      })
      .catch((err) => {
        console.error("[Background] Session save error:", err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (message.action === "getStats") {
    getStorageStats()
      .then((stats) => sendResponse({ success: true, stats }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "getHistory") {
    getExtractionHistory()
      .then((history) => sendResponse({ success: true, history }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "analyzeAllKeywords") {
    console.log("[Background] Starting global keyword analysis");
    getMasterJobs().then(async (masterJobs) => {
      try {
        console.log(
          "[Background] Computing TF-IDF Algorithm on all jobs immediately",
        );
        const algoResult = computeTFIDF(masterJobs);
        const algorithmData = {
          skillKeywords: topN(algoResult.skillKeywords, 20),
          titleKeywords: topN(algoResult.titleKeywords, 20),
          actionPhrases: topN(algoResult.actionPhrases, 15),
        };

        const initialResult = { method: "algorithm", algorithm: algorithmData };
        const aiStatus = await checkAIAvailability();
        const aiRunning = aiStatus.available;

        console.log(
          `[Background] Replying immediately with algorithm results. AI running: ${aiRunning}`,
        );
        sendResponse({
          success: true,
          data: initialResult,
          aiRunning: aiRunning,
        });

        if (aiRunning) {
          runAIBackground(masterJobs, algorithmData);
        } else {
          await saveKeywordAnalysis(initialResult);
        }
      } catch (err) {
        console.error("[Background] Keyword analysis threw error:", err);
        sendResponse({ success: false, error: err.message });
      }
    });
    return true;
  }

  if (message.action === "checkAI") {
    checkAIAvailability()
      .then((status) => sendResponse(status))
      .catch(() => sendResponse({ available: false }));
    return true;
  }
});

async function runAIBackground(masterJobs, algorithmData) {
  const startTime = Date.now();
  console.log(`[AI Background] ========== STARTING AI ANALYSIS ==========`);
  console.log(`[AI Background] Total jobs in database: ${masterJobs.length}`);

  try {
    const latestJobs = [...masterJobs]
      .sort((a, b) => new Date(b.scrapedAt) - new Date(a.scrapedAt))
      .slice(0, 100);

    console.log(
      `[AI Background] Selected latest ${latestJobs.length} jobs for analysis`,
    );
    console.log(
      `[AI Background] Date range: ${latestJobs[latestJobs.length - 1]?.scrapedAt} → ${latestJobs[0]?.scrapedAt}`,
    );
    console.log(
      `[AI Background] Sample job titles:`,
      latestJobs.slice(0, 3).map((j) => j.title),
    );

    console.log(`[AI Background] Checking cache for processed jobs...`);
    const storage = await chrome.storage.local.get(AI_CACHE_KEY);
    const aiCache = storage[AI_CACHE_KEY] || {};
    
    const unprocessedJobs = latestJobs.filter(j => !aiCache[j.jobId]);
    console.log(`[AI Background] Cache hit: ${latestJobs.length - unprocessedJobs.length}, New jobs to analyze: ${unprocessedJobs.length}`);

    if (unprocessedJobs.length > 0) {
      console.log(`[AI Background] Creating/reusing AI session...`);
      const session = await getAISession();
      
      const newResults = await extractKeywordsWithAI(
        unprocessedJobs,
        session,
        startTime,
      );
      
      // Update cache
      Object.assign(aiCache, newResults);
      await chrome.storage.local.set({ [AI_CACHE_KEY]: aiCache });
      console.log(`[AI Background] Cache updated with ${Object.keys(newResults).length} new job results.`);
    }

    // Aggregate results for the latest 100 jobs from cache
    const aiResult = aggregateAIResults(latestJobs, aiCache);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `[AI Background] ========== AI ANALYSIS COMPLETE in ${elapsed}s ==========`,
    );
    console.log(
      `[AI Background] Skill keywords found: ${aiResult.skillKeywords.length}`,
    );
    console.log(
      `[AI Background] Title keywords found: ${aiResult.titleKeywords.length}`,
    );
    console.log(
      `[AI Background] Action phrases found: ${aiResult.actionPhrases.length}`,
    );
    console.log(
      `[AI Background] Top skills:`,
      aiResult.skillKeywords.slice(0, 5).map((k) => k.keyword),
    );

    const finalResult = {
      method: "both",
      algorithm: algorithmData,
      ai: aiResult,
    };

    await saveKeywordAnalysis(finalResult);
    console.log(
      "[AI Background] Results saved to storage. Broadcasting to UI...",
    );

    chrome.runtime
      .sendMessage({
        action: "aiAnalysisComplete",
        success: true,
        data: finalResult,
        stats: { elapsed, jobsAnalyzed: latestJobs.length },
      })
      .catch((err) =>
        console.log(
          "[AI Background] UI might be closed, ignoring broadcast err:",
          err.message,
        ),
      );
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`[AI Background] FAILED after ${elapsed}s:`, err);
    console.error(
      `[AI Background] Error name: ${err.name}, message: ${err.message}`,
    );
    chrome.runtime
      .sendMessage({
        action: "aiAnalysisComplete",
        success: false,
        error: err.message,
      })
      .catch((e) => {});
  }
}

async function checkAIAvailability() {
  if (!("LanguageModel" in self) && !("ai" in self)) {
    return {
      available: false,
      reason: "LanguageModel API not available in this Chrome version",
    };
  }

  // Handling the newly updated Chrome AI API where it might be structured differently
  const aiObj = self.ai || self.LanguageModel;

  try {
    const status = await (aiObj.languageModel
      ? aiObj.languageModel.capabilities()
      : aiObj.availability());
    const isAvailable =
      typeof status === "object" ? status.available !== "no" : status !== "no";
    return {
      available: isAvailable,
      needsDownload:
        typeof status === "object"
          ? status.available === "after-download"
          : status === "after-download",
      status: typeof status === "object" ? status.available : status,
    };
  } catch {
    return { available: false, reason: "API error" };
  }
}

async function getAISession() {
  if (aiSession) {
    console.log("[Background] Returning existing AI session.");
    return aiSession;
  }

  console.log("[Background] Creating new AI session...");
  const aiObj = self.ai?.languageModel || self.LanguageModel;

  aiSession = await aiObj.create({
    systemPrompt: `You are a keyword extraction expert for freelance job postings on Upwork. 
When given job data, identify and return keywords in valid JSON only. No other text.`,
  });

  console.log("[Background] AI session created successfully.");
  return aiSession;
}

async function extractKeywordsWithAI(jobs, session, startTime = Date.now()) {
  const CHUNK_SIZE = 10;
  const totalChunks = Math.ceil(jobs.length / CHUNK_SIZE);
  const allResults = {
    skillKeywords: {},
    titleKeywords: {},
    actionPhrases: {},
  };
  let successfulChunks = 0;
  let failedChunks = 0;

  console.log(
    `[AI Extraction] Starting extraction: ${jobs.length} jobs, ${totalChunks} chunks of ${CHUNK_SIZE}`,
  );

  for (let i = 0; i < jobs.length; i += CHUNK_SIZE) {
    const chunkIndex = Math.floor(i / CHUNK_SIZE) + 1;
    const chunk = jobs.slice(i, i + CHUNK_SIZE);
    const chunkStartTime = Date.now();

    console.log(`[AI Extraction] --- Chunk ${chunkIndex}/${totalChunks} ---`);
    console.log(
      `[AI Extraction] Jobs ${i + 1}–${Math.min(i + CHUNK_SIZE, jobs.length)}: ${chunk.map((j) => j.title.substring(0, 40)).join(" | ")}`,
    );

    const jobsText = chunk
      .map(
        (job, idx) =>
          `[J${i + idx + 1}] T: ${job.title.substring(0, 80)} | S: ${(job.skills || []).slice(0, 6).join(", ")} | D: ${job.description.substring(0, 60)}`,
      )
      .join("\n");

    const prompt = `Extract keywords for EACH job separately.
${jobsText}

Return ONLY valid JSON (no markdown):
{
  "1": {"s":["React"], "t":["Web Dev"], "p":["fixed budget"]},
  "2": {"s":["Node.js"], "t":["Backend"], "p":["ASAP"]}
}
Rules: s=tech skills, t=job title keywords, p=action phrases. Key is the job number.`;

    // Broadcast BEFORE calling AI
    const preProgressMsg = {
      action: "chunkStarted",
      chunkIndex,
      totalChunks,
      jobsInChunk: chunk.length,
      jobRange: `${i + 1}–${Math.min(i + CHUNK_SIZE, jobs.length)}`,
      currentJobTitles: chunk.map((j) => j.title.substring(0, 50)),
      processed: i,
      total: jobs.length,
      elapsedSecs: parseInt(((Date.now() - startTime) / 1000).toFixed(0)),
    };
    chrome.runtime.sendMessage(preProgressMsg).catch(() => {});

    try {
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('AI prompt timeout')), 60000)
      );
      
      const response = await Promise.race([
        session.prompt(prompt),
        timeoutPromise
      ]);

      const cleaned = response.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      
      // Map back to job IDs
      chunk.forEach((job, idx) => {
        const jobIdx = i + idx + 1;
        const result = parsed[jobIdx.toString()] || parsed[jobIdx];
        if (result) {
          allResults[job.jobId] = {
            s: Array.isArray(result.s) ? result.s : [],
            t: Array.isArray(result.t) ? result.t : [],
            p: Array.isArray(result.p) ? result.p : []
          };
        }
      });
      
      successfulChunks++;
    } catch (err) {
      failedChunks++;
      console.warn(`[AI Extraction] Chunk ${chunkIndex} FAILED:`, err.message);
    }

    const processed = Math.min(i + CHUNK_SIZE, jobs.length);
    const progressMsg = {
      action: "analyzeProgress",
      processed,
      total: jobs.length,
      chunkIndex,
      totalChunks,
      elapsedSecs: parseInt(((Date.now() - startTime) / 1000).toFixed(0)),
      successfulChunks,
      failedChunks
    };
    chrome.runtime.sendMessage(progressMsg).catch(() => {});
  }

  return allResults;
}

function aggregateAIResults(jobs, cache) {
  const aggregated = {
    skillKeywords: {},
    titleKeywords: {},
    actionPhrases: {}
  };

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

function updateCount(obj, keyword) {
  const key = keyword.toLowerCase().trim();
  if (!key) return;
  if (obj[key]) {
    obj[key].count++;
  } else {
    obj[key] = { keyword: keyword.trim(), count: 1 };
  }
}

function mergeKeywordResults(accumulated, newChunk) {
  ["skillKeywords", "titleKeywords", "actionPhrases"].forEach((category) => {
    if (!newChunk[category]) return;
    newChunk[category].forEach((item) => {
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

self.addEventListener("suspend", () => {
  if (aiSession && typeof aiSession.destroy === "function") {
    aiSession.destroy();
    aiSession = null;
  }
});

// Step 4: Pre-warm AI session on load if available
checkAIAvailability().then(status => {
  if (status.available && !status.needsDownload) {
    console.log("[Background] Pre-warming AI session...");
    getAISession().catch(err => console.warn("[Background] Pre-warm failed:", err.message));
  }
});
