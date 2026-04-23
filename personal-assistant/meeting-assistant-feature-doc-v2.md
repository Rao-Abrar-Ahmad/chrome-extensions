# Feature 3 — AI Meeting Assistant
## Technical Planning Document — v2.0 (Decisions Finalized)

**Parent Extension:** Personal Assistant — Chrome Extension v1.0  
**Feature Version:** 2.0  
**Last Updated:** April 2026  
**Status:** Ready to Build  

> This is the finalized planning document. All open questions from v1.0 have been resolved. Every decision is locked. This document can be handed directly to any developer or AI agent to begin building.

---

## Table of Contents

1. [Feature Overview](#1-feature-overview)
2. [All Finalized Decisions](#2-all-finalized-decisions)
3. [How Audio Capture Works — Final Approach](#3-how-audio-capture-works--final-approach)
4. [Speech-to-Text — Final Strategy](#4-speech-to-text--final-strategy)
5. [AI Backend — Final Strategy](#5-ai-backend--final-strategy)
6. [Architecture Overview](#6-architecture-overview)
7. [New Files Required](#7-new-files-required)
8. [Manifest Changes](#8-manifest-changes)
9. [Step-by-Step Build Plan](#9-step-by-step-build-plan)
10. [Data Flow — End to End](#10-data-flow--end-to-end)
11. [UI Design Spec](#11-ui-design-spec)
12. [Context & Prompt Design](#12-context--prompt-design)
13. [Data Models](#13-data-models)
14. [Storage Layer Updates](#14-storage-layer-updates)
15. [Permissions](#15-permissions)
16. [Edge Cases & Error Handling](#16-edge-cases--error-handling)
17. [What This Feature Cannot Do](#17-what-this-feature-cannot-do)
18. [Build Phases](#18-build-phases)

---

## 1. Feature Overview

The AI Meeting Assistant is a new tab inside the Personal Assistant Side Panel. When the user is on a call on **Google Meet, Zoom (browser), or Microsoft Teams (browser)**, they open the Side Panel, switch to the Meeting Assistant tab, and press Start.

From that point the assistant:

1. Listens to audio from the active meeting tab using `chrome.tabCapture`
2. Transcribes speech to text in real time using the **Web Speech API** (free, no API key, built into Chrome)
3. Displays a live, auto-scrolling transcript
4. Detects when a question is asked and automatically generates an AI-powered suggested answer
5. Streams the AI response live as it arrives (not a block of text that pops in all at once)
6. Stacks all Q&A pairs — every question and answer is kept visible and scrollable
7. Allows the user to manually press a **"Suggest" button** at any time for an AI response on the current context
8. Saves the full session (transcript + all AI responses) as a Note when the meeting ends

The user never leaves their meeting window. The assistant is passive — it listens and assists. It does not speak, does not join the call, does not interact with Google Meet or Zoom in any way.

### What it looks like in practice

Client says: *"What does the shipping and delivery page do in Shopify?"*

Within 2–3 seconds, the Meeting Assistant panel shows the question detected and an AI response streams in word by word:

```
💬 [10:33] What does the shipping and delivery page do in Shopify?

🤖 AI Response ━━━━━━━━━━━━━━━━━━━━━━━━
The Shipping and Delivery page in Shopify — found under Settings →
Shipping and Delivery — is where you configure shipping zones, rates,
and carrier options. You can set flat rates, free shipping thresholds,
real-time carrier rates from UPS or FedEx, and manage local delivery
or pickup options...▌  (streaming)

[Copy]  [Save to Notes]
```

---

## 2. All Finalized Decisions

This section consolidates every decision made. Any AI agent building this feature should treat these as non-negotiable constraints.

| # | Topic | Decision |
|---|---|---|
| 1 | Meeting platforms supported | Google Meet, Zoom in browser, Teams in browser. No desktop app support needed. |
| 2 | Audio capture method | `chrome.tabCapture` via Offscreen Document |
| 3 | Speech-to-text method | Web Speech API (`SpeechRecognition`) — free, built into Chrome, no API key |
| 4 | Whisper / paid transcription | Not used. Web Speech API is sufficient. |
| 5 | AI backend | OpenRouter — free models only |
| 6 | Default free AI model | `meta-llama/llama-3.1-8b-instruct:free` (OpenRouter free tier) |
| 7 | Fallback AI model | `google/gemma-2-9b-it:free` (OpenRouter free tier) |
| 8 | Chrome built-in AI | Check for availability and use if present; not required |
| 9 | AI response display | Streamed word by word using OpenRouter streaming API |
| 10 | Question triggering | Automatic on question detection + always-visible manual "Suggest" button |
| 11 | Suggest button | Dynamic — always visible, context-aware, can be pressed at any time |
| 12 | Transcript scroll | Auto-scroll to latest. Pauses if user scrolls up. "Jump to latest" button appears. |
| 13 | Q&A stacking | All Q&A pairs stack and remain visible. Nothing is dismissed or hidden. |
| 14 | Transcript visibility | Visible by default, not collapsed |
| 15 | Meeting context input | Yes — a text field before starting where the user describes the meeting |
| 16 | Permission warning screen | Yes — a clear first-run explanation before asking for permissions |
| 17 | Browser requirement | Chrome 116+ (for Offscreen API). Latest Chrome is assumed. |
| 18 | API key required | Yes — user enters OpenRouter API key once in settings (free account) |
| 19 | Audio stored | No — only text transcript is saved. Audio is never written to disk. |
| 20 | Desktop app support | Not in scope. Browser-only. |

---

## 3. How Audio Capture Works — Final Approach

### Why we use chrome.tabCapture + Offscreen Document

The Web Speech API by default listens to the user's microphone. It cannot directly listen to a browser tab's audio output. To hear the other participants in a meeting (the remote audio playing through the tab), we need to capture the tab's audio stream first, then route it into speech recognition.

The architecture to do this in Manifest V3 is:

1. `chrome.tabCapture.getMediaStreamId()` — called from the Service Worker, captures the audio from the meeting tab and returns a `streamId`
2. An **Offscreen Document** (`offscreen.html` / `offscreen.js`) — a hidden background page that receives the `streamId`, opens the actual `MediaStream`, and runs `SpeechRecognition` on it
3. The transcript text is sent from the Offscreen Document back to the Side Panel via `chrome.runtime.sendMessage`

### Why the Offscreen Document is necessary

In Manifest V3, the Service Worker (background.js) cannot hold long-running audio streams — Chrome terminates it between events to save memory. An Offscreen Document is a persistent hidden page introduced in Chrome 116 specifically for audio/media work. It stays alive as long as the meeting session is active.

### Web Speech API on captured audio

The `SpeechRecognition` object in Chrome can be pointed at any `MediaStream`, not just the default microphone. After opening the tab's audio stream, we create a `SpeechRecognition` instance and connect it to the captured stream:

```javascript
// In offscreen.js
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    mandatory: {
      chromeMediaSource: 'tab',
      chromeMediaSourceId: streamId  // from chrome.tabCapture
    }
  },
  video: false
});

// Create an audio context and connect stream to recognition
const audioContext = new AudioContext();
const source = audioContext.createMediaStreamSource(stream);
const destination = audioContext.createMediaStreamDestination();
source.connect(destination);

// Point SpeechRecognition at the captured stream
const recognition = new webkitSpeechRecognition();
recognition.continuous = true;
recognition.interimResults = true;
recognition.lang = 'en-US';

// Assign the captured stream as the audio source
// Note: Chrome's SpeechRecognition uses the system default mic by default.
// We re-route through AudioContext to feed it the tab stream.
```

### Important note on Web Speech API and tab audio

The `SpeechRecognition` API in Chrome cannot directly accept a `MediaStream` as its audio source through a standard property — it always defaults to the system microphone. The workaround used in production extensions is:

**Approach A — AudioContext loopback (preferred):** Route the captured tab audio through a `MediaStreamAudioDestinationNode` and then connect it as the input source. This works in Chromium-based browsers.

**Approach B — Virtual audio source:** Use the captured stream as a virtual microphone by replacing the default audio input context before the recognition starts.

**Approach C — Parallel recognition:** Run `SpeechRecognition` against the user's microphone (to capture what the user says) AND against the tab stream (to capture what the other participant says). Merge and label both streams in the transcript. This is the most accurate for labeled speaker transcripts.

**Final decision: Approach C — Parallel recognition.** Run two `SpeechRecognition` instances:
- Instance 1: `getUserMedia({ audio: true })` — captures the user's microphone. Labels as **"You"** in transcript.
- Instance 2: `tabCapture` stream — captures the remote meeting audio. Labels as **"Them"** in transcript.

This gives a properly labeled transcript showing who said what, which makes question detection much more accurate (we know a question from "Them" needs an answer from "You").

---

## 4. Speech-to-Text — Final Strategy

### Primary: Web Speech API (two parallel instances)

**Cost:** Free  
**API key required:** None  
**Internet required:** Yes (Chrome sends audio to Google's speech servers)  
**Quality:** High accuracy for clear English speech  
**Latency:** ~1–2 seconds  

```javascript
// Instance 1: User's microphone
const micRecognition = new webkitSpeechRecognition();
micRecognition.continuous = true;
micRecognition.interimResults = true;
micRecognition.lang = 'en-US';

micRecognition.onresult = (event) => {
  const transcript = getTranscriptFromEvent(event);
  postTranscriptUpdate({ speaker: 'you', text: transcript });
};

micRecognition.start();

// Instance 2: Tab audio (remote participants)
const tabRecognition = new webkitSpeechRecognition();
tabRecognition.continuous = true;
tabRecognition.interimResults = true;
tabRecognition.lang = 'en-US';

// Assign tab audio stream (via AudioContext routing)
tabRecognition.onresult = (event) => {
  const transcript = getTranscriptFromEvent(event);
  postTranscriptUpdate({ speaker: 'them', text: transcript });
};

tabRecognition.start();
```

### Interim results

`interimResults: true` means the transcript updates as the person is still speaking. Interim results are shown in lighter text. When a sentence is finalized (the speaker pauses), the text is committed to the transcript in full text. This gives a real-time feel.

```
Them (interim): What does the shipping and del...
Them (final):   What does the shipping and delivery page do in Shopify?
```

### Handling Web Speech API restarts

`SpeechRecognition` stops automatically after a period of silence or after ~60 seconds of continuous use. It must be restarted. The `onend` event is used to restart it immediately:

```javascript
recognition.onend = () => {
  if (isSessionActive) {
    recognition.start(); // Restart immediately
  }
};
```

### Fallback: if Web Speech API fails

If `SpeechRecognition` is unavailable or throws an error, show a banner:

> "Speech recognition unavailable. Make sure you are using Chrome with microphone permissions enabled."

No silent failures. The user must know if transcription has stopped.

---

## 5. AI Backend — Final Strategy

### OpenRouter — free models only

The user creates a free account at [openrouter.ai](https://openrouter.ai), gets a free API key, and enters it in the extension settings once. Free models on OpenRouter have no cost per request.

### Free models available on OpenRouter (as of 2026)

| Model | Context | Best for | Identifier |
|---|---|---|---|
| Meta Llama 3.1 8B | 128K tokens | Fast Q&A, general assistance | `meta-llama/llama-3.1-8b-instruct:free` |
| Google Gemma 2 9B | 8K tokens | Conversational, accurate | `google/gemma-2-9b-it:free` |
| Microsoft Phi-3 Mini | 128K tokens | Lightweight, fast | `microsoft/phi-3-mini-128k-instruct:free` |
| Mistral 7B | 32K tokens | Well-rounded | `mistralai/mistral-7b-instruct:free` |

**Default model:** `meta-llama/llama-3.1-8b-instruct:free`  
**Why:** 128K context window (no risk of hitting limits), fast response, good at Q&A, completely free.

The model is user-selectable in settings. The user can switch to any free model without any code changes — just a settings dropdown.

### Streaming responses

OpenRouter supports streaming via Server-Sent Events (SSE). When `"stream": true` is set in the API request, the response arrives token by token. The Side Panel displays each token as it arrives, giving a real-time "typing" effect.

```javascript
async function* streamAIResponse(prompt, systemPrompt, apiKey, model) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'chrome-extension://personal-assistant',
      'X-Title': 'Personal Assistant'
    },
    body: JSON.stringify({
      model: model,
      stream: true,
      max_tokens: 400,
      temperature: 0.3,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ]
    })
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n').filter(line => line.startsWith('data: '));

    for (const line of lines) {
      const data = line.replace('data: ', '');
      if (data === '[DONE]') return;

      try {
        const parsed = JSON.parse(data);
        const token = parsed.choices?.[0]?.delta?.content;
        if (token) yield token;
      } catch {
        // Ignore malformed chunks
      }
    }
  }
}
```

Usage in the Side Panel:

```javascript
async function displayStreamingResponse(prompt, systemPrompt) {
  const card = createAIResponseCard(); // Creates empty card in UI
  
  for await (const token of streamAIResponse(prompt, systemPrompt, apiKey, model)) {
    appendTokenToCard(card, token); // Appends each word as it arrives
    scrollToBottom();
  }

  markCardComplete(card); // Removes streaming cursor
}
```

### Chrome built-in AI — optional check

On startup, check if Chrome's built-in AI is available. If it is, it can be used as a secondary option. It is never required and never the default. The user can select it in settings if they want fully offline responses.

```javascript
async function isChromeAIAvailable() {
  if (typeof window === 'undefined') return false;
  if (!window.ai || !window.ai.languageModel) return false;
  const capabilities = await window.ai.languageModel.capabilities();
  return capabilities.available === 'readily';
}
```

---

## 6. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  CHROME TAB (Google Meet / Zoom / Teams in browser)              │
│  Remote participant audio plays through speakers                  │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                   chrome.tabCapture.getMediaStreamId()
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│  SERVICE WORKER (background.js)                                  │
│  • Receives streamId                                             │
│  • Creates Offscreen Document (if not already open)              │
│  • Passes streamId to Offscreen Document                         │
└──────────────────────────────┬───────────────────────────────────┘
                               │
               chrome.runtime.sendMessage({ streamId })
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│  OFFSCREEN DOCUMENT (offscreen.js)         Always-running page   │
│                                                                  │
│  ┌─────────────────────┐  ┌──────────────────────────────────┐  │
│  │ SpeechRecognition 1 │  │ SpeechRecognition 2              │  │
│  │ Source: microphone  │  │ Source: tab audio (captured)     │  │
│  │ Label: "You"        │  │ Label: "Them"                    │  │
│  └──────────┬──────────┘  └───────────────┬──────────────────┘  │
│             │                             │                      │
│             └──────────┬──────────────────┘                      │
│                        │  TRANSCRIPT_UPDATE messages             │
└────────────────────────┼─────────────────────────────────────────┘
                         │
           chrome.runtime.sendMessage({ type: 'TRANSCRIPT_UPDATE', ... })
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  SIDE PANEL (sidepanel.js)                                       │
│                                                                  │
│  • Renders live auto-scrolling transcript                        │
│  • Detects questions in incoming transcript                      │
│  • Sends context + question to AI (modules/ai.js)               │
│  • Streams AI response token by token into response card         │
│  • Stacks all Q&A cards — nothing is dismissed                   │
│  • "Suggest" button always visible for manual AI requests        │
└──────────────────────────────────────────────────────────────────┘
                         │
           chrome.storage.local.set()
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  CHROME STORAGE                                                  │
│  • Meeting sessions (transcript + Q&A pairs)                     │
│  • Meeting settings (API key, model, context)                    │
└──────────────────────────────────────────────────────────────────┘
```

---

## 7. New Files Required

```
personal-assistant/
│
├── manifest.json               # UPDATED — tabCapture, offscreen, host_permissions
├── background.js               # UPDATED — tabCapture + offscreen document management
│
├── offscreen.html              # NEW — hidden persistent page for audio processing
├── offscreen.js                # NEW — dual speech recognition (mic + tab audio)
│
├── sidepanel.html              # UPDATED — Meeting tab added
├── sidepanel.js                # UPDATED — Meeting tab logic
├── sidepanel.css               # UPDATED — Meeting tab styles
│
└── modules/
    ├── meeting.js              # NEW — session management, question detection
    ├── ai.js                   # NEW — OpenRouter streaming API, Chrome AI check
    ├── transcript.js           # NEW — transcript formatting, saving, export
    └── storage.js              # UPDATED — new storage keys for meetings + settings
```

### What each new file does

**offscreen.html** — A minimal HTML page with a `<script>` tag loading `offscreen.js`. Has no visible UI. Chrome uses this file to create the Offscreen Document. It must be referenced in `manifest.json`.

**offscreen.js** — The audio processing engine. Receives the stream ID from the Service Worker, opens two `SpeechRecognition` instances (microphone + tab audio), and sends transcript updates to the Side Panel. Handles recognition restarts. Lives for the entire duration of a meeting session.

**modules/meeting.js** — Manages meeting session state: start time, platform detected, transcript array, Q&A pairs array. Handles question detection logic. Manages the "save session" flow on stop.

**modules/ai.js** — All AI interactions. Streaming OpenRouter calls. Chrome AI fallback check. Prompt building. Model configuration.

**modules/transcript.js** — Formats transcript entries for display (timestamps, speaker labels, interim vs final). Handles saving a session as a Note. Handles export as plain text.

---

## 8. Manifest Changes

```json
{
  "manifest_version": 3,
  "name": "Personal Assistant",
  "version": "1.1.0",
  "description": "Your daily productivity companion — notes, reminders, and AI meeting assistant.",

  "permissions": [
    "storage",
    "alarms",
    "notifications",
    "tabCapture",
    "offscreen"
  ],

  "host_permissions": [
    "https://openrouter.ai/*"
  ],

  "action": {
    "default_title": "Open Personal Assistant",
    "default_icon": {
      "16":  "icons/icon16.png",
      "48":  "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },

  "side_panel": {
    "default_path": "sidepanel.html"
  },

  "background": {
    "service_worker": "background.js",
    "type": "module"
  }
}
```

### New permissions explained

**`"tabCapture"`** — Required to capture the audio stream from the active Chrome tab. Without this, the extension cannot hear the meeting audio from Google Meet or Zoom.

**`"offscreen"`** — Required to create and manage Offscreen Documents. The Offscreen Document is the hidden page that holds the audio stream and runs speech recognition.

**`"host_permissions": ["https://openrouter.ai/*"]`** — Required to make `fetch()` calls to the OpenRouter API from within the extension. Without this, the browser blocks the network request.

---

## 9. Step-by-Step Build Plan

Each step is a discrete, independently testable unit of work. Build in sequence.

---

### Step 1 — Add the Meeting tab shell to the Side Panel

**Files:** `sidepanel.html`, `sidepanel.css`

Add a third tab "🎙️ Meeting" to the existing tab bar alongside Notes and Reminders. The tab shows:

- A meeting context input field (text area, optional, placeholder: "Describe this meeting, e.g. 'Shopify client onboarding call'")
- A permission explanation notice (always shown until user confirms they've read it)
- A platform detection row showing which meeting is active
- A large "Start Listening" button
- The AI model + API key status indicator
- A link to settings

No functionality yet. HTML and CSS only.

**Test:** Open extension, see Meeting tab, switch to it, see the UI shell.

---

### Step 2 — First-run permission explanation screen

**Files:** `sidepanel.js`, `sidepanel.css`

The very first time the user opens the Meeting tab, show a full-screen explanation inside the tab:

```
┌─────────────────────────────────────┐
│  🎙️ Meeting Assistant               │
│                                     │
│  How this works                     │
│                                     │
│  This feature listens to your       │
│  meeting tab audio to help you      │
│  respond to questions in real time. │
│                                     │
│  ✅ Audio is processed locally      │
│     by your browser                 │
│                                     │
│  ✅ Only text transcripts are       │
│     saved — never audio files       │
│                                     │
│  ✅ AI suggestions use OpenRouter   │
│     (free). Your API key is stored  │
│     only on this device.            │
│                                     │
│  ⚠️  Chrome will ask for            │
│     microphone permission.          │
│     Please allow it.                │
│                                     │
│  [ Got it — Set up Meeting AI ]     │
└─────────────────────────────────────┘
```

After the user clicks the button, a `firstRunComplete: true` flag is saved to `chrome.storage.local` and this screen never shows again.

**Test:** First open shows the screen. Click the button. Reopen — screen is gone.

---

### Step 3 — Settings panel for Meeting tab

**Files:** `sidepanel.html`, `sidepanel.js`

A settings section accessible via a ⚙️ icon in the Meeting tab header. Contains:

- **OpenRouter API Key** — text input with show/hide toggle. Saved to `chrome.storage.local` under `pa_meeting_settings`. Never transmitted anywhere except to `openrouter.ai`.
- **AI Model** — dropdown with free model options:
  - Llama 3.1 8B (Free) — default
  - Gemma 2 9B (Free)
  - Phi-3 Mini (Free)
  - Mistral 7B (Free)
- **Auto-suggest** — toggle. When on, AI responds automatically when a question is detected. When off, user must press Suggest manually.
- **Test connection** button — sends a ping to OpenRouter and shows "Connected ✓" or "Invalid key ✗".

**Test:** Enter an API key, click Test — see Connected confirmation. Refresh extension — API key is still there.

---

### Step 4 — Meeting platform detection

**Files:** `modules/meeting.js`, `sidepanel.js`

When the Meeting tab is active, query all Chrome tabs every 3 seconds and check for known meeting URLs:

```javascript
const MEETING_PLATFORMS = [
  { name: 'Google Meet',      match: (url) => url.includes('meet.google.com') },
  { name: 'Zoom',             match: (url) => url.includes('zoom.us/wc/') || url.includes('zoom.us/j/') },
  { name: 'Microsoft Teams',  match: (url) => url.includes('teams.microsoft.com/l/meetup-join') || url.includes('teams.live.com/meet') },
];

async function detectMeetingTab() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  for (const tab of tabs) {
    for (const platform of MEETING_PLATFORMS) {
      if (platform.match(tab.url || '')) {
        return { tab, platform: platform.name };
      }
    }
  }
  return null;
}
```

Show the result in the Meeting tab UI:
- Found: `✅ Google Meet detected — "Client Call - Acme Corp"`
- Not found: `⚠️ No active meeting detected. Make sure you have the meeting open in another tab.`

The user can still start the assistant even if no meeting is detected (for edge cases like custom meeting tools).

**Test:** Open Google Meet in a tab, switch to the Meeting assistant tab — it detects Google Meet.

---

### Step 5 — Service Worker: tab capture on Start

**File:** `background.js`

Add a message handler for `'START_MEETING_CAPTURE'`:

```javascript
// background.js

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === 'START_MEETING_CAPTURE') {
    const { tabId } = message;

    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, async (streamId) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
        return;
      }

      // Create Offscreen Document if it doesn't exist
      const offscreenUrl = chrome.runtime.getURL('offscreen.html');
      const existing = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [offscreenUrl]
      });

      if (existing.length === 0) {
        await chrome.offscreen.createDocument({
          url: offscreenUrl,
          reasons: ['USER_MEDIA'],
          justification: 'Capture tab audio and microphone for meeting transcription'
        });
      }

      // Forward the stream ID to the Offscreen Document
      chrome.runtime.sendMessage({
        type: 'OFFSCREEN_START_CAPTURE',
        streamId: streamId
      });

      sendResponse({ success: true });
    });

    return true; // Keep async channel open
  }

  if (message.type === 'STOP_MEETING_CAPTURE') {
    chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP_CAPTURE' });
    chrome.offscreen.closeDocument().catch(() => {});
    sendResponse({ success: true });
    return true;
  }

});
```

**Test:** Send `{ type: 'START_MEETING_CAPTURE', tabId: [meet tab id] }` from the Service Worker DevTools console. Verify that the Offscreen Document is created.

---

### Step 6 — Offscreen Document: dual speech recognition

**File:** `offscreen.js`

This is the core audio processing file. It:
1. Receives the tab stream ID from the Service Worker
2. Opens the tab audio stream via `getUserMedia` with `chromeMediaSource: 'tab'`
3. Simultaneously opens the microphone stream via `getUserMedia({ audio: true })`
4. Starts two `SpeechRecognition` instances — one for each stream
5. Sends all transcript updates to the Side Panel

```javascript
// offscreen.js

let tabRecognition = null;
let micRecognition = null;
let isCapturing = false;

chrome.runtime.onMessage.addListener(async (message) => {

  if (message.type === 'OFFSCREEN_START_CAPTURE') {
    isCapturing = true;
    await startDualCapture(message.streamId);
  }

  if (message.type === 'OFFSCREEN_STOP_CAPTURE') {
    isCapturing = false;
    stopDualCapture();
  }

});

async function startDualCapture(streamId) {
  // --- Stream 1: Tab audio (remote participants) ---
  const tabStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    },
    video: false
  });

  // Route tab stream through AudioContext so SpeechRecognition can use it
  const audioCtx = new AudioContext();
  const tabSource = audioCtx.createMediaStreamSource(tabStream);
  const tabDest = audioCtx.createMediaStreamDestination();
  tabSource.connect(tabDest);

  tabRecognition = createRecognition(tabDest.stream, 'them');
  tabRecognition.start();

  // --- Stream 2: Microphone (user's own voice) ---
  const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  micRecognition = createRecognition(micStream, 'you');
  micRecognition.start();
}

function createRecognition(stream, speaker) {
  const recognition = new webkitSpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onresult = (event) => {
    let interim = '';
    let final = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        final += text;
      } else {
        interim += text;
      }
    }

    if (interim) {
      chrome.runtime.sendMessage({
        type: 'TRANSCRIPT_UPDATE',
        speaker,
        text: interim,
        isFinal: false,
        timestamp: Date.now()
      });
    }

    if (final) {
      chrome.runtime.sendMessage({
        type: 'TRANSCRIPT_UPDATE',
        speaker,
        text: final.trim(),
        isFinal: true,
        timestamp: Date.now()
      });
    }
  };

  recognition.onerror = (event) => {
    console.error(`Recognition error (${speaker}):`, event.error);
    // Restart on non-fatal errors
    if (event.error !== 'not-allowed' && isCapturing) {
      setTimeout(() => recognition.start(), 500);
    }
  };

  recognition.onend = () => {
    // Auto-restart while session is active
    if (isCapturing) {
      recognition.start();
    }
  };

  return recognition;
}

function stopDualCapture() {
  if (tabRecognition) tabRecognition.stop();
  if (micRecognition) micRecognition.stop();
  tabRecognition = null;
  micRecognition = null;
}
```

**Test:** Start a session, speak — see mic transcript. Play audio from the meeting tab — see tab transcript.

---

### Step 7 — Side Panel: live transcript display

**Files:** `sidepanel.js`, `sidepanel.css`

Listen for `TRANSCRIPT_UPDATE` messages and render them into the transcript area.

```javascript
// sidepanel.js

const transcriptEl = document.getElementById('transcript');
let pendingInterim = {}; // Track interim results by speaker

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'TRANSCRIPT_UPDATE') {
    renderTranscriptUpdate(message);
    
    // If this is a final result from "them", check for questions
    if (message.isFinal && message.speaker === 'them') {
      maybeAutoSuggest(message.text);
    }
  }
});

function renderTranscriptUpdate({ speaker, text, isFinal, timestamp }) {
  const label = speaker === 'you' ? 'You' : 'Them';
  const timeStr = new Date(timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit'
  });

  if (!isFinal) {
    // Update or create interim line
    let interimEl = document.getElementById(`interim-${speaker}`);
    if (!interimEl) {
      interimEl = document.createElement('div');
      interimEl.id = `interim-${speaker}`;
      interimEl.className = 'transcript-line interim';
      transcriptEl.appendChild(interimEl);
    }
    interimEl.textContent = `${label}: ${text}`;
  } else {
    // Remove interim, add final line
    const interimEl = document.getElementById(`interim-${speaker}`);
    if (interimEl) interimEl.remove();

    const line = document.createElement('div');
    line.className = 'transcript-line final';
    line.innerHTML = `<span class="ts-time">${timeStr}</span><span class="ts-speaker ${speaker}">${label}</span><span class="ts-text">${escapeHtml(text)}</span>`;
    transcriptEl.appendChild(line);
    autoScroll();
  }
}
```

Auto-scroll behavior:

```javascript
let userScrolledUp = false;

transcriptEl.addEventListener('scroll', () => {
  const atBottom = transcriptEl.scrollHeight - transcriptEl.scrollTop - transcriptEl.clientHeight < 50;
  userScrolledUp = !atBottom;
  document.getElementById('scroll-to-bottom-btn').style.display = userScrolledUp ? 'block' : 'none';
});

function autoScroll() {
  if (!userScrolledUp) {
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }
}
```

**Test:** Start a session, speak — transcript updates in real time with correct speaker labels and timestamps.

---

### Step 8 — Question detection

**File:** `modules/meeting.js`

Called on every final transcript entry from "Them". Returns `true` if the text looks like a question.

```javascript
function detectQuestion(text) {
  const t = text.trim().toLowerCase();
  if (!t || t.split(' ').length < 3) return false; // Too short to be a real question

  // Ends with question mark
  if (t.endsWith('?')) return true;

  // Starts with question words
  const questionPrefixes = [
    'what ', 'how ', 'why ', 'when ', 'where ', 'who ', 'which ',
    'can you ', 'could you ', 'do you ', 'does ', 'did ',
    'is there ', 'are there ', 'will you ', 'would you ',
    'tell me ', 'explain ', 'help me ', 'describe '
  ];
  if (questionPrefixes.some(p => t.startsWith(p))) return true;

  // Contains implicit question phrases mid-sentence
  const impliedPhrases = [
    'tell me about', 'can you explain', 'help me understand',
    'what about', 'how about', 'i was wondering', 'do you know'
  ];
  if (impliedPhrases.some(p => t.includes(p))) return true;

  return false;
}
```

When `detectQuestion` returns `true` AND auto-suggest is enabled in settings, trigger an AI request automatically. If auto-suggest is off, just highlight the transcript line with a subtle indicator so the user knows a question was detected.

**Test:** Pass "What does the shipping page do in Shopify?" → returns `true`. Pass "Yes that sounds good" → returns `false`.

---

### Step 9 — The "Suggest" button

**Files:** `sidepanel.html`, `sidepanel.js`

A "💡 Suggest" button is always visible at the bottom of the Meeting tab, above the transcript. It is never hidden.

Behavior:
- **During a session:** Clicking it takes the last 8 sentences from the transcript (from both speakers) and sends them to the AI with the prompt "Given this conversation, what would be a helpful response or insight for the user right now?"
- **When a question is active (highlighted in transcript):** Clicking it uses that specific question as the prompt for a focused answer.
- **Before a session starts:** The button is disabled and shows as faded.

The button label changes dynamically:
- No question highlighted: `💡 Suggest`
- Question highlighted in transcript: `💡 Answer this question`

This makes the button context-aware without any manual input from the user.

**Test:** During a session, click Suggest — AI response card appears. Confirm it is contextually relevant to the last few lines of transcript.

---

### Step 10 — Streaming AI response cards

**Files:** `modules/ai.js`, `sidepanel.js`

Each AI response (whether auto-triggered or manual) creates a new card in the Meeting tab. Cards stack vertically — none are removed or collapsed. The user can scroll up to see all previous Q&A pairs.

**Card structure:**

```html
<div class="ai-card" id="ai-card-{id}">
  <div class="ai-card-question">
    💬 <span class="ai-q-text">What does the shipping page do in Shopify?</span>
  </div>
  <div class="ai-card-response">
    <div class="ai-response-text" id="ai-response-{id}">
      <!-- Tokens stream in here, one by one -->
    </div>
    <div class="ai-card-cursor" id="ai-cursor-{id}">▌</div>
  </div>
  <div class="ai-card-actions">
    <button onclick="copyResponse('{id}')">Copy</button>
    <button onclick="saveToNotes('{id}')">Save to Notes</button>
  </div>
</div>
```

Streaming implementation in `sidepanel.js`:

```javascript
async function createStreamingResponseCard(question, contextTranscript) {
  const cardId = `${Date.now()}`;
  const card = renderAICard(cardId, question);
  
  document.getElementById('ai-cards-container').prepend(card); // New cards at top
  // Note: prepend so newest is at top, but page scrolls down with transcript.
  // Actually: append, since transcript auto-scrolls down. See UI spec.

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(contextTranscript, question);

  try {
    const responseEl = document.getElementById(`ai-response-${cardId}`);
    const cursorEl = document.getElementById(`ai-cursor-${cardId}`);
    let fullResponse = '';

    for await (const token of streamAIResponse(userPrompt, systemPrompt, apiKey, model)) {
      fullResponse += token;
      responseEl.textContent = fullResponse;
      cursorEl.style.display = 'inline';
      autoScroll(); // Keep scrolling down as response streams
    }

    cursorEl.style.display = 'none'; // Remove cursor when done
    saveResponseToSession(cardId, question, fullResponse);

  } catch (error) {
    renderErrorInCard(cardId, 'Could not get suggestion. Check your API key in settings.');
  }
}
```

**Q&A stacking:** New cards appear below the transcript entry that triggered them, inline in the conversation flow. This keeps context — the question in the transcript is immediately followed by the AI answer card. Older cards remain visible above as the user scrolls up.

**Test:** Trigger two questions in a row — two AI cards appear, both visible, in order, with streamed text.

---

### Step 11 — Session stop and save

**Files:** `sidepanel.js`, `modules/transcript.js`

When the user clicks "Stop":

1. `STOP_MEETING_CAPTURE` message is sent to the Service Worker
2. The Offscreen Document stops both recognition instances
3. The Service Worker closes the Offscreen Document
4. The Side Panel shows a save prompt:

```
┌─────────────────────────────────────┐
│  Session ended — 00:34:17           │
│                                     │
│  Title:                             │
│  [Meeting — April 19, 2026 — 10:32] │  ← Editable
│                                     │
│  [Save to Notes]    [Discard]       │
└─────────────────────────────────────┘
```

If saved, the transcript plus all Q&A pairs are formatted as a note:

```markdown
# Meeting — April 19, 2026 — 10:32 AM
Platform: Google Meet | Duration: 34:17

## Transcript

[10:33] Them: What does the shipping and delivery page do in Shopify?
[10:33] You: That's a great question...

## AI Suggestions

**Q: What does the shipping and delivery page do in Shopify?**
The Shipping and Delivery page in Shopify is found under Settings → 
Shipping and Delivery. It is where you configure shipping zones...
```

The note is saved to the existing notes system (same `pa_notes` storage key) and immediately visible in the Notes tab.

**Test:** Run a session, stop, save — note appears in Notes tab with full transcript and AI responses.

---

## 10. Data Flow — End to End

```
User clicks "Start Listening" in Side Panel
          │
          ▼
sidepanel.js detects meeting tab ID
          │
          ▼
chrome.runtime.sendMessage({ type: 'START_MEETING_CAPTURE', tabId })
          │
          ▼
background.js: chrome.tabCapture.getMediaStreamId({ targetTabId })
          │
          │─── Creates Offscreen Document (offscreen.html) ───────────────┐
          │                                                                │
          ▼                                                                ▼
background.js sends streamId to Offscreen Document       offscreen.js starts up
          │                                                                │
          ▼                                                                │
offscreen.js receives streamId                                            │
          │                                                                │
          ├── getUserMedia(tab stream)  →  SpeechRecognition "them"       │
          │                                                                │
          └── getUserMedia(microphone) →  SpeechRecognition "you"         │
                    │                                                      │
                    │  TRANSCRIPT_UPDATE messages (continuous)            │
                    ▼                                                      │
          sidepanel.js receives transcript updates                        │
                    │                                                      │
                    ├── Renders lines in transcript area                  │
                    │   Auto-scrolls to bottom                            │
                    │                                                      │
                    └── On final "them" text: detectQuestion(text)        │
                                │                                         │
                       question detected?                                 │
                         Yes ───┤                                         │
                                ▼                                         │
                    auto-suggest enabled?                                 │
                         Yes ───┤                                         │
                                ▼                                         │
                    buildContextWindow(last 8 lines)                     │
                    buildUserPrompt(context, question)                    │
                                │                                         │
                    fetch → openrouter.ai  (streaming: true)             │
                                │                                         │
                    tokens stream back one by one                        │
                                │                                         │
                    appendTokenToCard() called per token                 │
                    autoScroll() called per token                        │
                                │                                         │
                    Card complete → saveResponseToSession()              │
                                │
                    User clicks "Stop"
                                │
          sidepanel.js → STOP_MEETING_CAPTURE → background.js
                                │
          background.js → OFFSCREEN_STOP_CAPTURE → offscreen.js
                                │
          offscreen.js stops both SpeechRecognition instances
                                │
          background.js closes Offscreen Document
                                │
          sidepanel.js shows "Save session?" prompt
                                │
          User saves → transcript.js formats and saves to pa_notes
```

---

## 11. UI Design Spec

### Meeting tab — Idle state (before session starts)

```
┌─────────────────────────────────────────┐
│  🎙️ Meeting                      ⚙️     │  ← Header
├─────────────────────────────────────────┤
│                                         │
│  Meeting context  (optional)            │
│  ┌─────────────────────────────────┐   │
│  │ e.g. Shopify client onboarding  │   │  ← Textarea, 2 lines
│  └─────────────────────────────────┘   │
│                                         │
│  ✅ Google Meet detected                │  ← Platform status
│  "Client Call — Acme Corp"             │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │   🎙️  Start Listening           │   │  ← Primary button (blue)
│  └─────────────────────────────────┘   │
│                                         │
│  AI: Llama 3.1 8B (Free) · Connected ✓ │  ← AI status, tap to change
│                                         │
└─────────────────────────────────────────┘
```

### Meeting tab — Active session state

```
┌─────────────────────────────────────────┐
│  🎙️ Meeting   ● LIVE 00:12:34   ⏹ Stop │  ← Header with live timer
├─────────────────────────────────────────┤
│                                         │
│  💡 Suggest  ←──────────────────────── │  ← Always-visible Suggest button
│                                         │
├─────────────────────────────────────────┤
│                                         │
│  [10:31] Them: Can you walk me through  │  ← Transcript line (final)
│          the Shopify setup?             │
│                                         │
│  [10:32] You: Sure, let me start with   │
│          the basics...                  │
│                                         │
│  [10:33] Them: What does the shipping   │  ← Question detected (highlighted)
│          and delivery page do?          │
│                                         │
│  ┌─ 🤖 AI Suggestion ──────────────┐   │  ← AI response card (streamed)
│  │ The Shipping and Delivery page   │   │
│  │ in Shopify — Settings → Ship...  │   │
│  │ is where you configure zones,    │   │
│  │ rates, and carrier options...▌   │   │  ← Streaming cursor
│  │                                  │   │
│  │  [Copy]          [Save to Notes] │   │
│  └──────────────────────────────────┘   │
│                                         │
│  Them (interim): How do I set up...▌   │  ← Interim (lighter text)
│                                         │
└─────────────────────────────────────────┘
         ↑ Scroll to top ↑
```

### Session end / save prompt

```
┌─────────────────────────────────────────┐
│  Session ended                          │
│  Duration: 00:34:17                     │
│                                         │
│  Save this meeting?                     │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ Meeting — April 19 · 10:32 AM   │   │  ← Editable title
│  └─────────────────────────────────┘   │
│                                         │
│  3 AI suggestions · 47 transcript lines │
│                                         │
│  ┌────────────┐  ┌───────────────────┐ │
│  │ Save Note  │  │ Discard           │ │
│  └────────────┘  └───────────────────┘ │
└─────────────────────────────────────────┘
```

### CSS additions for Meeting tab

```css
/* Transcript area */
.transcript-area {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* Transcript lines */
.transcript-line {
  display: grid;
  grid-template-columns: 44px 44px 1fr;
  gap: 4px;
  font-size: 13px;
  line-height: 1.5;
  padding: 2px 0;
}
.transcript-line.interim { opacity: 0.5; font-style: italic; }
.transcript-line.final   { opacity: 1; }

.ts-time    { color: var(--color-text-tertiary); font-size: 11px; padding-top: 2px; }
.ts-speaker { font-weight: 500; font-size: 12px; }
.ts-speaker.you  { color: var(--color-accent); }
.ts-speaker.them { color: var(--color-text-secondary); }
.ts-text    { color: var(--color-text-primary); }

/* AI response card */
.ai-card {
  background: var(--color-accent-soft);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-md);
  padding: 12px 14px;
  margin: 8px 0;
  font-size: 13px;
  line-height: 1.6;
}
.ai-card-question {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-bottom: 8px;
}
.ai-response-text {
  color: var(--color-text-primary);
  white-space: pre-wrap;
}
.ai-card-cursor {
  display: inline;
  animation: blink 1s step-end infinite;
  color: var(--color-accent);
}
@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }

.ai-card-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 0.5px solid var(--color-border);
}

/* Live indicator */
.live-dot {
  width: 8px; height: 8px;
  background: #ef4444;
  border-radius: 50%;
  animation: pulse-live 1.5s ease-in-out infinite;
}
@keyframes pulse-live {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(1.2); }
}

/* Suggest button */
.suggest-btn {
  width: 100%;
  padding: 8px 16px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-primary);
  transition: background 0.15s;
}
.suggest-btn:hover { background: var(--color-accent-soft); border-color: var(--color-accent); }
.suggest-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* Scroll to bottom button */
.scroll-to-bottom-btn {
  position: sticky;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--color-text-primary);
  color: var(--color-bg-primary);
  border: none;
  border-radius: 20px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
  display: none;
}
```

---

## 12. Context & Prompt Design

### System prompt

```
You are an AI assistant embedded in a Chrome extension that helps a 
professional during live business calls and meetings.

Your role:
- Provide clear, accurate, concise answers to questions asked by the 
  other person in the meeting.
- Responses must be 3–5 sentences maximum. The user is on a live call 
  and needs to respond in seconds.
- Be direct and factual. Skip preambles like "Great question!" or 
  "Certainly!". Start your answer immediately.
- Write in natural, conversational language — the user may speak 
  your answer aloud.
- If you are unsure, say so briefly rather than guessing.
- No bullet points, no markdown headers, no formatting. Plain prose only.
- Always write from the perspective of the user — "you can", "your 
  store", "in your case".

{MEETING_CONTEXT}
```

Where `{MEETING_CONTEXT}` is replaced with the user's meeting context input:

```
// If context is set:
"Current meeting context: {userContext}"

// If context is empty:
"" (empty string — the placeholder is removed entirely)
```

### User prompt (per AI request)

```
Recent conversation:
{last 8 lines of transcript, formatted as "Speaker: text"}

Question to answer:
{the detected question or last sentence}

Provide a concise, spoken-language answer the user can give right now.
```

### Context window size

Send a maximum of 8 transcript lines as context. At an average of 15 words per line, this is ~120 words or ~160 tokens. Combined with the system prompt (~120 tokens) and response (max 400 tokens), each API request uses approximately 680 tokens. Well within limits for all supported models.

### Example full prompt

```
System:
You are an AI assistant embedded in a Chrome extension that helps a 
professional during live business calls and meetings.
[...rest of system prompt...]
Current meeting context: Shopify client onboarding call for a new e-commerce store.

User:
Recent conversation:
Them: So we just signed up for Shopify yesterday
You: Great, welcome! Let's walk through the basics
Them: We sell handmade candles, about 50 products
You: Perfect, that's a manageable catalog to start with
Them: We ship to the US and Canada
You: You'll want to set up your shipping zones for both regions
Them: Speaking of which...
Them: What does the shipping and delivery page do in Shopify?

Question to answer:
What does the shipping and delivery page do in Shopify?

Provide a concise, spoken-language answer the user can give right now.
```

---

## 13. Data Models

### Meeting session

```javascript
{
  id: "meeting_1718200000000_abc123",
  title: "Meeting — April 19, 2026 — 10:32 AM",
  platform: "google_meet",           // "google_meet" | "zoom" | "teams" | "unknown"
  context: "Shopify client onboarding call",  // User's input before starting
  startedAt: 1718200000000,
  endedAt:   1718203600000,
  duration:  3600000,                // ms
  
  transcript: [
    {
      id: "t_001",
      timestamp: 1718200120000,
      speaker: "them",               // "you" | "them"
      text: "What does the shipping page do in Shopify?",
      isFinal: true
    }
  ],

  aiResponses: [
    {
      id: "r_001",
      triggeredBy: "auto",           // "auto" | "manual"
      question: "What does the shipping page do in Shopify?",
      response: "The Shipping and Delivery page in Shopify...",
      model: "meta-llama/llama-3.1-8b-instruct:free",
      timestamp: 1718200123000,
      savedToNotes: false
    }
  ]
}
```

### Meeting settings

```javascript
{
  openrouterApiKey: "sk-or-...",     // Stored in chrome.storage.local
  aiModel: "meta-llama/llama-3.1-8b-instruct:free",
  autoSuggest: true,                  // Auto-trigger AI on question detection
  firstRunComplete: true,             // Has user seen the permission explanation?
  chunkSize: 5000,                    // Reserved for future audio chunking; not used with Web Speech API
}
```

### New storage keys

```javascript
// Additions to modules/storage.js

const STORAGE_KEYS = {
  NOTES:            'pa_notes',
  REMINDERS:        'pa_reminders',
  SETTINGS:         'pa_settings',
  MEETING_SESSIONS: 'pa_meeting_sessions',  // Array of saved meeting session objects
  MEETING_SETTINGS: 'pa_meeting_settings'   // API key, model, prefs
};
```

---

## 14. Storage Layer Updates

New functions to add to `modules/storage.js`:

```javascript
async function getMeetingSettings() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.MEETING_SETTINGS);
  return result[STORAGE_KEYS.MEETING_SETTINGS] || {
    openrouterApiKey: '',
    aiModel: 'meta-llama/llama-3.1-8b-instruct:free',
    autoSuggest: true,
    firstRunComplete: false
  };
}

async function setMeetingSettings(settings) {
  await chrome.storage.local.set({ [STORAGE_KEYS.MEETING_SETTINGS]: settings });
}

async function getMeetingSessions() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.MEETING_SESSIONS);
  return result[STORAGE_KEYS.MEETING_SESSIONS] || [];
}

async function saveMeetingSession(session) {
  const sessions = await getMeetingSessions();
  sessions.unshift(session); // Most recent first
  // Keep last 50 sessions max
  if (sessions.length > 50) sessions.splice(50);
  await chrome.storage.local.set({ [STORAGE_KEYS.MEETING_SESSIONS]: sessions });
}
```

---

## 15. Permissions

### Final manifest permissions

```json
"permissions": [
  "storage",
  "alarms",
  "notifications",
  "tabCapture",
  "offscreen"
],
"host_permissions": [
  "https://openrouter.ai/*"
]
```

### User-facing permission prompts

When the user clicks "Start Listening" for the first time, Chrome will ask for:

1. **Microphone access** — standard browser permission dialog. The user must click Allow. Explain in the first-run screen that microphone is needed to capture their voice for the transcript.

2. **No separate tab audio permission** — `chrome.tabCapture` does not show a user-facing dialog. It is granted automatically by Chrome when the `tabCapture` permission is in the manifest.

### First-run permission warning (Step 2 in build plan)

The explanation screen shown before first use covers:
- Why microphone access is needed
- That audio never leaves the device as a file
- That only text transcript is sent to OpenRouter for AI suggestions
- That the OpenRouter API key is stored only locally
- Link to OpenRouter's privacy policy

This screen appears once. After the user confirms, it never shows again (`firstRunComplete: true`).

---

## 16. Edge Cases & Error Handling

### Audio capture

| Scenario | Handling |
|---|---|
| Meeting tab is closed during session | `SpeechRecognition.onend` fires. Side Panel shows: "Meeting tab was closed. Session ended." Prompt to save partial transcript. |
| Meeting tab is refreshed during session | Stream is broken. Same handling as tab closed. |
| User switches to a different tab | Capture continues — `tabCapture` holds the stream regardless of which tab is focused. |
| Microphone permission denied | `getUserMedia` throws `NotAllowedError`. Show: "Microphone permission denied. Enable it in Chrome settings (chrome://settings/content/microphone) and try again." Stop session setup. |
| Both recognition instances crash | `recognition.onerror` + `recognition.onend` fires on both. Attempt restart up to 3 times with 1-second delay. After 3 failures, show: "Speech recognition stopped. Click Restart." |
| User is on a very noisy call | Web Speech API handles background noise reasonably well. No special handling needed. |

### AI & API

| Scenario | Handling |
|---|---|
| No API key set | Suggest button and auto-suggest are disabled. Banner shown: "Add your OpenRouter API key in settings to enable AI suggestions." |
| API key is invalid (401 response) | Show in settings: "API key is invalid ✗". Disable AI. Show banner: "Your OpenRouter API key is invalid. Update it in settings." |
| Network error during streaming | Show in the AI card: "Connection lost. Could not complete response." Keep partial streamed text visible. |
| OpenRouter rate limit hit (429) | Show: "AI is busy. Try again in a moment." Keep transcript running — only AI suggestions are paused. |
| Free model is temporarily unavailable | Catch the error, try the fallback model (`google/gemma-2-9b-it:free`). If both fail, show error. |
| Very long question (500+ chars) | Truncate to 300 chars for the question field in the prompt. The full text remains in the transcript. |
| AI response is empty | Show: "No suggestion available for this question." Remove the loading state from the card. |

### Web Speech API

| Scenario | Handling |
|---|---|
| `SpeechRecognition` not available | (`typeof webkitSpeechRecognition === 'undefined'`). Show: "Speech recognition is not supported. Please use Google Chrome." |
| Recognition stops after silence | `onend` fires — auto-restart immediately. This is expected behavior. |
| Recognition returns only interim results, never final | Add a timeout: if interim is not finalized within 5 seconds of last update, treat the last interim result as final. |
| Both speakers talk at once | Both streams will produce transcript entries at the same time. They may interleave. This is expected — the transcript shows overlapping speech naturally. |
| User is in a very quiet environment | `SpeechRecognition` may not detect speech. No special handling — it simply produces no output until speech is detected. |

### Session & storage

| Scenario | Handling |
|---|---|
| Storage quota exceeded when saving session | Catch `chrome.runtime.lastError`. Show: "Storage full. Delete some notes or old meetings to free space." |
| User discards session | Transcript and AI responses are cleared from memory. Nothing is saved. Session ID is discarded. |
| Extension is updated mid-session | The Offscreen Document and Side Panel reload. The session is lost. This is a Chrome limitation — document it clearly. Consider auto-saving transcript to storage every 60 seconds as a recovery measure. |

---

## 17. What This Feature Cannot Do

Document these limitations in the UI (small info text in the Meeting tab settings):

- **Cannot work with Zoom desktop app or Teams desktop app.** Only browser-based versions are supported. If a user needs desktop app support, they must use Zoom in Chrome (zoom.us/wc/) or Teams in Chrome (teams.microsoft.com).
- **Cannot identify speaker names.** The transcript labels audio as "You" (microphone) and "Them" (tab audio). It cannot distinguish between multiple remote participants. Speaker identification by name is not possible with Web Speech API alone.
- **Cannot function when Chrome is closed.** Unlike notification reminders which use `chrome.alarms`, audio capture requires Chrome to be running and the Side Panel to be open.
- **Cannot guarantee real-time transcription.** There is a 1–3 second delay between speech and text appearing due to Web Speech API processing.
- **Cannot work without an internet connection.** Web Speech API sends audio to Google's servers for processing. OpenRouter is also cloud-based.
- **Does not store audio files.** Only text transcripts are saved. No audio is written to disk at any point.
- **Cannot transcribe audio in languages other than English.** The recognition language is set to `en-US`. Multi-language support can be added later by making the language a settings option.

---

## 18. Build Phases

### Phase 3A — Core Meeting Tab (Estimated: 1.5 weeks)

**Goal:** Working session with dual transcript (user + remote) for Google Meet in Chrome.

Deliverables:
- Meeting tab shell with context input and platform detection (Step 1, 4)
- First-run permission explanation screen (Step 2)
- Settings panel with API key + model selector (Step 3)
- Service Worker: tab capture + offscreen document management (Step 5)
- Offscreen Document: dual Web Speech API recognition (Step 6)
- Side Panel: live auto-scrolling transcript with speaker labels (Step 7)
- Start / Stop controls with live timer
- Session save / discard prompt (Step 11 partial)

**Test criteria:**
- Open Google Meet, start a session — both "You" and "Them" transcript lines appear
- Close the panel and reopen — meeting session is still running
- Click Stop — save prompt appears with correct duration

---

### Phase 3B — AI Suggestions (Estimated: 1 week, after 3A)

**Goal:** Streaming AI responses appear when questions are detected.

Deliverables:
- Question detection (Step 8)
- "Suggest" button — always visible, context-aware label (Step 9)
- Streaming AI response cards with stacking (Step 10)
- Copy and Save to Notes actions on each card
- Auto-suggest toggle in settings
- Full session save as formatted Note (Step 11 complete)

**Test criteria:**
- Say "What does the shipping page do in Shopify?" in a meeting — AI card appears with streamed response within 3 seconds
- Press Suggest manually at any point — AI card appears with contextual suggestion
- Ask 3 questions — 3 AI cards stack and are all visible
- Click Save — all transcript + AI responses appear as a note in Notes tab

---

### Phase 3C — Polish (Estimated: 1 week, after 3B)

**Goal:** Production-quality experience.

Deliverables:
- Auto-save transcript to storage every 60 seconds (crash recovery)
- Session history tab inside Meeting (list of past meetings, click to view)
- Export session as `.txt` file
- Support for Teams and Zoom browser URL detection (beyond Google Meet)
- Keyword triggers — user can configure custom words that trigger AI suggestions
- Language setting for non-English meetings (sets recognition lang)
- "Copy full transcript" button on session end screen

---

*End of document — AI Meeting Assistant Feature Plan v2.0*  
*This document supersedes v1.0 and incorporates all finalized decisions.*  
*Parent document: Personal Assistant Chrome Extension Technical Documentation v1.0*
