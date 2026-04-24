# AI Meeting Assistant — Technical Implementation Document v3.0

**Parent Extension:** Personal Assistant — Chrome Extension v1.0  
**Feature Version:** 3.0  
**Last Updated:** April 2026  
**Status:** Ready to Build  

> This document outlines the updated implementation using local Transformer.js with Whisper models for completely free, privacy-focused speech-to-text transcription.

---

## Table of Contents

1. [Feature Overview](#1-feature-overview)
2. [Core Technology Choices](#2-core-technology-choices)
3. [Architecture Overview](#3-architecture-overview)
4. [Audio Capture & Processing](#4-audio-capture--processing)
5. [Local Speech-to-Text with Transformer.js](#5-local-speech-to-text-with-transformerjs)
6. [AI Integration](#6-ai-integration)
7. [Data Flow](#7-data-flow)
8. [Implementation Steps](#8-implementation-steps)
9. [Performance Considerations](#9-performance-considerations)
10. [Error Handling & Fallbacks](#10-error-handling--fallbacks)
11. [Privacy & Security](#11-privacy--security)
12. [Build Requirements](#12-build-requirements)

---

## 1. Feature Overview

The AI Meeting Assistant enables real-time transcription of meetings in Google Meet, Zoom, and Microsoft Teams, with automatic question detection and AI-powered response suggestions. The key innovation is **completely local processing** using browser-based machine learning, ensuring privacy and zero cost.

### Key Features
- **Dual Transcription**: Separates "You" (user's speech) from "Them" (participants)
- **Real-time Display**: Live transcript with auto-scrolling
- **Question Detection**: Automatic AI responses to participant questions
- **Session Saving**: Full transcripts and Q&A saved as notes
- **Zero Cost**: No API keys, no subscriptions, fully local

---

## 2. Core Technology Choices

| Component | Technology | Reason |
|-----------|------------|--------|
| **Speech-to-Text** | Transformer.js + Whisper | Local, accurate, free, supports custom audio streams |
| **AI Responses** | OpenRouter (free models) | Cost-free LLMs for question answering |
| **Audio Capture** | chrome.tabCapture + MediaRecorder | Chrome-native for tab audio access |
| **Storage** | chrome.storage.local | Offline, persistent, no backend |
| **UI Framework** | Vanilla JS + HTML/CSS | No dependencies, fast, reliable |

### Why Transformer.js + Whisper?
- **Privacy**: All processing happens locally in the browser
- **Cost**: Zero — no API calls or subscriptions
- **Accuracy**: Industry-leading 3-7% WER on clean audio
- **Flexibility**: Supports multiple languages and custom audio sources
- **Browser-native**: Runs on WebAssembly/WebGPU, no server required

---

## 3. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  CHROME TAB (Meeting)                                            │
│  Audio stream captured via chrome.tabCapture                     │
└──────────────────────────────┬───────────────────────────────────┘
                               │
┌──────────────────────────────────────────────────────────────────┐
│  SERVICE WORKER (background.js)                                  │
│  • Captures tab audio streamId                                   │
│  • Creates Offscreen Document                                    │
│  • Passes streamId to offscreen                                  │
└──────────────────────────────┬───────────────────────────────────┘
                               │
┌──────────────────────────────────────────────────────────────────┐
│  OFFSCREEN DOCUMENT (offscreen.js)         Hidden processing     │
│                                                                  │
│  ┌─────────────────────┐  ┌──────────────────────────────────┐  │
│  │ MediaRecorder       │  │ MediaRecorder                    │  │
│  │ (Microphone)        │  │ (Tab Audio)                      │  │
│  │ 5s chunks           │  │ 5s chunks                       │  │
│  └──────────┬──────────┘  └───────────────┬──────────────────┘  │
│             │                             │                      │
│             └──────────┬──────────────────┘                      │
│                        │                                        │
│  ┌─────────────────────┐  ┌──────────────────────────────────┐  │
│  │ Transformer.js      │  │ Transformer.js                   │  │
│  │ Whisper (You)       │  │ Whisper (Them)                   │  │
│  └──────────┬──────────┘  └───────────────┬──────────────────┘  │
│             │                             │                      │
│             └──────────┬──────────────────┘                      │
│                        │  TRANSCRIPT_UPDATE messages             │
└────────────────────────┼─────────────────────────────────────────┘
                         │
┌──────────────────────────────────────────────────────────────────┐
│  SIDE PANEL (sidepanel.js)                                       │
│                                                                  │
│  • Displays live transcript                                      │
│  • Detects questions                                             │
│  • Triggers AI responses                                         │
│  • Manages session state                                         │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. Audio Capture & Processing

### Tab Audio Capture
Using `chrome.tabCapture.getMediaStreamId()` to capture the meeting tab's audio:

```javascript
// background.js
chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
  // Pass streamId to offscreen document
});
```

### Stream Acquisition in Offscreen
```javascript
// offscreen.js
const tabStream = await navigator.mediaDevices.getUserMedia({
  audio: {
    mandatory: {
      chromeMediaSource: 'tab',
      chromeMediaSourceId: streamId
    }
  }
});

const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
```

### Chunked Recording
Audio is recorded in 5-second chunks for optimal processing:

```javascript
const tabRecorder = new MediaRecorder(tabStream, { mimeType: 'audio/webm' });
const micRecorder = new MediaRecorder(micStream, { mimeType: 'audio/webm' });

tabRecorder.ondataavailable = (event) => {
  if (event.data.size > 0) transcribeAudio(event.data, 'them');
};

micRecorder.ondataavailable = (event) => {
  if (event.data.size > 0) transcribeAudio(event.data, 'you');
};

// Start recording with 5s timeslices
tabRecorder.start(5000);
micRecorder.start(5000);
```

---

## 5. Local Speech-to-Text with Transformer.js

### Model Selection
- **Primary**: `Xenova/whisper-small` (quantized) — ~250MB, 3.4% WER
- **Fallback**: `Xenova/whisper-tiny` — ~75MB, 7.5% WER

### Model Loading
```javascript
import { pipeline } from '@xenova/transformers';

let transcriber = null;

async function loadModel() {
  try {
    transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small');
    console.log('Whisper model loaded successfully');
  } catch (error) {
    console.error('Failed to load Whisper model:', error);
    // Fallback to tiny model
    transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny');
  }
}
```

### Audio Transcription
```javascript
async function transcribeAudio(audioBlob, speaker) {
  if (!transcriber) return;

  try {
    // Convert blob to Float32Array
    const audioBuffer = await audioBlob.arrayBuffer();
    const audioContext = new AudioContext();
    const audioData = await audioContext.decodeAudioData(audioBuffer);
    const audioArray = audioData.getChannelData(0); // Mono

    // Run inference
    const result = await transcriber(audioArray, {
      language: 'en',
      task: 'transcribe'
    });

    const transcript = result.text.trim();
    if (transcript) {
      chrome.runtime.sendMessage({
        type: 'TRANSCRIPT_UPDATE',
        speaker,
        text: transcript,
        timestamp: Date.now()
      });
    }
  } catch (error) {
    console.error(`Transcription error for ${speaker}:`, error);
  }
}
```

### Performance Optimization
- **WebGPU Acceleration**: Automatically uses GPU when available
- **Quantized Models**: 4-bit quantization reduces model size by 50%
- **Chunk Processing**: 5s chunks balance latency and context
- **Memory Management**: Clear audio buffers after processing

---

## 6. AI Integration

### Question Detection
Simple regex-based detection in sidepanel.js:

```javascript
function detectQuestion(text) {
  const t = text.trim().toLowerCase();
  if (!t || t.split(' ').length < 3) return false;
  if (t.endsWith('?')) return true;
  
  const questionWords = ['what', 'how', 'why', 'when', 'where', 'who', 'which', 'can', 'could', 'do', 'does', 'is', 'are'];
  return questionWords.some(word => t.startsWith(word + ' '));
}
```

### AI Response Generation
Using OpenRouter with free models:

```javascript
async function generateResponse(question, context) {
  const prompt = `Meeting context: ${context}\n\nQuestion: ${question}\n\nProvide a helpful, concise answer:`;
  
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${settings.openrouterApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-3.1-8b-instruct:free',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 300,
      temperature: 0.3
    })
  });

  const result = await response.json();
  return result.choices[0].message.content;
}
```

---

## 7. Data Flow

1. **User clicks "Start Listening"** → Side panel sends message to background
2. **Background captures tab audio** → Gets streamId, creates offscreen document
3. **Offscreen loads Whisper model** → Sets up dual MediaRecorders
4. **Audio chunks recorded** → 5s intervals for mic and tab streams
5. **Chunks transcribed locally** → Transformer.js processes audio
6. **Transcripts sent to side panel** → Displayed with speaker labels
7. **Questions detected** → Automatic AI response generation
8. **Session saved** → Transcript + Q&A stored as note

---

## 8. Implementation Steps

### Step 1: Dependencies & Setup
- Add `@xenova/transformers` to package.json
- Update manifest.json with offscreen permission
- Create offscreen.html and offscreen.js

### Step 2: Model Loading
- Implement model download and caching
- Add loading progress indicator
- Handle model fallback (small → tiny)

### Step 3: Audio Processing
- Set up dual MediaRecorders
- Implement chunked recording
- Add audio format conversion for Whisper

### Step 4: Transcription Pipeline
- Integrate Transformer.js pipeline
- Optimize for real-time performance
- Add error handling and recovery

### Step 5: UI Integration
- Update transcript display
- Implement question detection
- Add AI response streaming

### Step 6: Session Management
- Track meeting sessions
- Save transcripts and Q&A
- Handle session cleanup

---

## 9. Performance Considerations

### Memory Usage
- **Model**: 250MB (small) to 75MB (tiny)
- **Audio Buffers**: ~1MB per 5s chunk
- **Total**: ~300MB peak during transcription

### CPU/GPU Requirements
- **Minimum**: Modern CPU with WASM support
- **Recommended**: WebGPU-capable GPU for real-time performance
- **Fallback**: CPU-only mode with reduced performance

### Latency
- **Model Load**: 10-60 seconds (one-time)
- **Transcription**: 1-5 seconds per 5s chunk
- **AI Response**: 2-10 seconds (network dependent)

### Browser Compatibility
- **Chrome**: 116+ (offscreen docs)
- **WebGPU**: 113+ (optional, improves performance)
- **WebAssembly**: Required for model inference

---

## 10. Error Handling & Fallbacks

### Model Loading Failures
- **Cause**: Insufficient storage, network issues
- **Fallback**: Show user-friendly error, suggest tiny model
- **Recovery**: Allow manual retry

### Audio Access Denied
- **Cause**: Permission denied, hardware issues
- **Fallback**: Show permission prompt, disable feature
- **Recovery**: Guide user to browser settings

### Transcription Errors
- **Cause**: Noisy audio, unsupported language
- **Fallback**: Skip chunk, continue recording
- **Recovery**: Automatic retry on next chunk

### AI Service Unavailable
- **Cause**: Network issues, API limits
- **Fallback**: Manual "Suggest" button still works
- **Recovery**: Retry with exponential backoff

---

## 11. Privacy & Security

### Data Handling
- **Audio**: Never leaves device, processed locally
- **Transcripts**: Stored locally in chrome.storage
- **AI Prompts**: Sent to OpenRouter (user's choice)
- **No Telemetry**: No data collection or tracking

### Security Measures
- **Content Security Policy**: Restrict external scripts
- **Permission Justification**: Minimal permissions required
- **Model Integrity**: Verify model downloads from trusted sources

---

## 12. Build Requirements

### Development Environment
- **Node.js**: 18+
- **Chrome**: 116+ with WebGPU enabled
- **Storage**: 500MB+ free space for models

### Dependencies
```json
{
  "@xenova/transformers": "^2.17.0"
}
```

### Build Process
- Bundle Transformer.js with Webpack/Rollup
- Include quantized models in extension package
- Test on target devices (CPU/GPU variants)

### Testing Strategy
- Unit tests for transcription pipeline
- Integration tests for audio capture
- Performance tests on various hardware
- User acceptance testing with real meetings

---

This implementation provides a completely free, privacy-focused meeting assistant that runs entirely in the browser, leveraging modern web technologies for machine learning and audio processing.</content>
<parameter name="filePath">d:\My Files\extenshions\personal-assistant\meeting-assistant-technical-doc-v3.md