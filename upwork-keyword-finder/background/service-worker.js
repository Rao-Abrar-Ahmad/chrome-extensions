// background/service-worker.js

import {
  saveSession,
  getStorageStats,
  saveKeywordAnalysis,
  getMasterJobs,
  getExtractionHistory,
} from "../lib/storage-manager.js";
import { computeTFIDF } from "../lib/keyword-algorithm.js";

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

    console.log(`[AI Background] Creating/reusing AI session...`);
    const session = await getAISession();
    console.log(
      `[AI Background] AI session ready. Starting keyword extraction...`,
    );

    const aiResult = await extractKeywordsWithAI(
      latestJobs,
      session,
      startTime,
    );

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
  const CHUNK_SIZE = 5;
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
          `[JOB ${i + idx + 1}]\nTitle: ${job.title}\nDesc: ${job.description.substring(0, 300)}\nSkills: ${(job.skills || []).join(", ")}`,
      )
      .join("\n\n");

    const prompt = `Analyze these ${chunk.length} Upwork job listings. Extract keywords.

${jobsText}

Return ONLY valid JSON, no markdown, no explanation:
{
  "skillKeywords": [{"keyword": "React", "count": 3, "importance": "high"}],
  "titleKeywords": [{"keyword": "Developer Needed", "count": 5, "importance": "high"}],
  "actionPhrases": [{"keyword": "looking for", "count": 4, "importance": "medium"}]
}
Rules: skillKeywords=tech/tools, titleKeywords=noun phrases from titles, actionPhrases=what clients want. importance: high/medium/low.`;

    // Broadcast BEFORE calling AI so UI immediately shows what's being processed
    const preProgressMsg = {
      action: "chunkStarted",
      chunkIndex,
      totalChunks,
      jobsInChunk: chunk.length,
      jobRange: `${i + 1}–${Math.min(i + CHUNK_SIZE, jobs.length)}`,
      currentJobTitles: chunk.map((j) => j.title.substring(0, 50)),
      processed: i, // jobs processed so far (before this chunk)
      total: jobs.length,
      elapsedSecs: parseInt(((Date.now() - startTime) / 1000).toFixed(0)),
    };
    console.log(
      `[AI Extraction] Broadcasting chunkStarted for chunk ${chunkIndex}/${totalChunks}: jobs ${preProgressMsg.jobRange}`,
    );
    chrome.runtime.sendMessage(preProgressMsg).catch(() => {});

    try {
      console.log(
        `[AI Extraction] Chunk ${chunkIndex}: Sending prompt (${prompt.length} chars) to AI...`,
      );
      const response = await session.prompt(prompt);
      const chunkElapsed = ((Date.now() - chunkStartTime) / 1000).toFixed(1);
      console.log(
        `[AI Extraction] Chunk ${chunkIndex}: AI responded in ${chunkElapsed}s (${response.length} chars)`,
      );

      const cleaned = response.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      mergeKeywordResults(allResults, parsed);
      successfulChunks++;

      const skillCount = Object.keys(allResults.skillKeywords).length;
      const titleCount = Object.keys(allResults.titleKeywords).length;
      console.log(
        `[AI Extraction] Chunk ${chunkIndex}: OK. Running totals — skills: ${skillCount}, titles: ${titleCount}`,
      );
    } catch (err) {
      failedChunks++;
      console.warn(
        `[AI Extraction] Chunk ${chunkIndex}: FAILED — ${err.name}: ${err.message}`,
      );
      if (err.name === "SyntaxError") {
        console.warn(
          `[AI Extraction] Chunk ${chunkIndex}: JSON parse error — AI may have returned non-JSON response`,
        );
      }
    }

    const processed = Math.min(i + CHUNK_SIZE, jobs.length);
    const elapsedSecs = ((Date.now() - startTime) / 1000).toFixed(0);
    const skillCount = Object.keys(allResults.skillKeywords).length;
    const progressMsg = {
      action: "analyzeProgress",
      processed,
      total: jobs.length,
      chunkIndex,
      totalChunks,
      elapsedSecs: parseInt(elapsedSecs),
      successfulChunks,
      failedChunks,
      runningSkillCount: skillCount,
      currentJobTitles: chunk.map((j) => j.title.substring(0, 50)),
    };
    console.log(
      `[AI Extraction] Progress broadcast: ${processed}/${jobs.length} (${elapsedSecs}s elapsed, ${skillCount} skills so far)`,
    );
    chrome.runtime.sendMessage(progressMsg).catch(() => {});
  }

  console.log(`[AI Extraction] ===== EXTRACTION DONE =====`);
  console.log(
    `[AI Extraction] Successful: ${successfulChunks}/${totalChunks} chunks, Failed: ${failedChunks}`,
  );

  return {
    skillKeywords: topN(allResults.skillKeywords, 20),
    titleKeywords: topN(allResults.titleKeywords, 20),
    actionPhrases: topN(allResults.actionPhrases, 15),
  };
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
