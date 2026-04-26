import { pipeline, env } from '@xenova/transformers';

// Configure Transformer.js for Chrome extension environment
env.remoteHost = ''; // Empty string instead of null
env.remotePathTemplate = 'https://huggingface.co/{model}/resolve/main/{file}';
env.allowLocalModels = false;
env.useCache = true;

console.log("[Offscreen] Transformer.js configured with remote path template:", env.remotePathTemplate);

// Override fetch to log URLs
const originalFetch = window.fetch;
window.fetch = function(url, options) {
  console.log("[Offscreen] Fetching URL:", url);
  return originalFetch.call(this, url, options);
};

console.log("[Offscreen] Transformer.js configured with remote host:", env.remoteHost);
console.log("[Offscreen] Offscreen document loaded!");

let tabRecorder = null;
let micRecorder = null;
let isCapturing = false;
let transcriber = null;

console.log("[Offscreen] Setting up message listener...");
chrome.runtime.onMessage.addListener(async (message) => {
  console.log("[Offscreen] Received message:", message.type);
  if (message.type === 'OFFSCREEN_START_CAPTURE') {
    console.log("[Offscreen] Received OFFSCREEN_START_CAPTURE. Loading model and starting capture.");
    isCapturing = true;
    await loadModel();
    await startDualCapture(message.streamId);
  }

  if (message.type === 'OFFSCREEN_STOP_CAPTURE') {
    console.log("[Offscreen] Received OFFSCREEN_STOP_CAPTURE. Shutting down.");
    isCapturing = false;
    stopDualCapture();
  }
});

async function loadModel() {
  if (transcriber) return; // Already loaded

  // Try Web Speech API first (no download needed)
  console.log("[Offscreen] Trying Web Speech API first (no model download needed)...");
  try {
    // Check if Web Speech API is available
    if (typeof webkitSpeechRecognition !== 'undefined' || typeof SpeechRecognition !== 'undefined') {
      transcriber = 'web-speech-api';
      console.log("[Offscreen] Web Speech API available and ready.");
      return;
    } else {
      console.warn("[Offscreen] Web Speech API not available in this context.");
    }
  } catch (error) {
    console.warn("[Offscreen] Web Speech API check failed:", error);
  }

  // Fallback to Whisper tiny model
  try {
    console.log("[Offscreen] Falling back to Whisper tiny model...");
    transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
      quantized: true,
    });
    console.log("[Offscreen] Whisper tiny model loaded successfully.");
  } catch (error) {
    console.error("[Offscreen] All transcription methods failed:", error);
    throw new Error("Unable to initialize any transcription method.");
  }
}

async function startDualCapture(streamId) {
  console.log("[Offscreen] startDualCapture called with streamId:", streamId);
  try {
    // Get tab audio stream
    const tabStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });
    console.log("[Offscreen] Acquired tab audio stream.");

    // Get mic audio stream
    const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    console.log("[Offscreen] Acquired mic audio stream.");

    // Start recording both
    tabRecorder = new MediaRecorder(tabStream, { mimeType: 'audio/webm' });
    micRecorder = new MediaRecorder(micStream, { mimeType: 'audio/webm' });

    tabRecorder.ondataavailable = (event) => {
      console.log("[Offscreen] Tab recorder ondataavailable: blob size =", event.data.size);
      if (event.data.size > 0 && isCapturing) {
        transcribeAudio(event.data, 'them');
      }
    };

    micRecorder.ondataavailable = (event) => {
      console.log("[Offscreen] Mic recorder ondataavailable: blob size =", event.data.size);
      if (event.data.size > 0 && isCapturing) {
        transcribeAudio(event.data, 'you');
      }
    };

    tabRecorder.start(5000); // 5 second chunks
    micRecorder.start(5000);
    console.log("[Offscreen] Both recorders started successfully. Audio capture in progress...");

  } catch (error) {
    console.error("[Offscreen] FATAL ERROR in startDualCapture:", error);
    chrome.runtime.sendMessage({
      type: 'CAPTURE_ERROR',
      message: error.message,
      timestamp: Date.now()
    }).catch(e => console.error("[Offscreen] Failed to send error message:", e));
    throw error;
  }
}

function stopDualCapture() {
  if (tabRecorder) {
    tabRecorder.stop();
  }
  if (micRecorder) {
    micRecorder.stop();
  }
  tabRecorder = null;
  micRecorder = null;
}

async function transcribeAudio(audioBlob, speaker) {
  console.log(`[Offscreen] transcribeAudio called for ${speaker}, blob size: ${audioBlob.size}, transcriber ready: ${!!transcriber}`);

  if (!transcriber) {
    console.warn("[Offscreen] Transcriber not loaded, skipping transcription.");
    return;
  }

  // Handle Web Speech API fallback
  if (transcriber === 'web-speech-api') {
    console.log(`[Offscreen] Using Web Speech API for ${speaker}...`);
    try {
      const recognition = new webkitSpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript.trim();
        if (transcript) {
          console.log(`[Offscreen] Web Speech API transcribed ${speaker}: ${transcript}`);
          chrome.runtime.sendMessage({
            type: 'TRANSCRIPT_UPDATE',
            speaker,
            text: transcript,
            timestamp: Date.now()
          });
        }
      };

      recognition.onerror = (error) => {
        console.error(`[Offscreen] Web Speech API error for ${speaker}:`, error.error);
      };

      // Convert blob to audio URL for Web Speech API
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audio.onloadeddata = () => {
        recognition.start();
      };
      audio.load();

    } catch (error) {
      console.error(`[Offscreen] Web Speech API setup error for ${speaker}:`, error);
    }
    return;
  }

  // Handle Whisper model
  try {
    console.log(`[Offscreen] Converting blob to audio array for ${speaker}...`);
    // Convert blob to Float32Array
    const audioBuffer = await audioBlob.arrayBuffer();
    console.log(`[Offscreen] Audio buffer created: ${audioBuffer.byteLength} bytes`);

    const audioContext = new AudioContext();
    const audioData = await audioContext.decodeAudioData(audioBuffer);
    console.log(`[Offscreen] Audio decoded: ${audioData.length} samples, ${audioData.numberOfChannels} channels`);

    const audioArray = audioData.getChannelData(0); // Mono
    console.log(`[Offscreen] Audio array extracted: ${audioArray.length} samples`);

    // Run inference
    console.log(`[Offscreen] Running Whisper inference for ${speaker}...`);
    const result = await transcriber(audioArray, {
      language: 'en',
      task: 'transcribe'
    });
    console.log(`[Offscreen] Whisper inference complete for ${speaker}:`, result);

    const transcript = result.text.trim();
    if (transcript) {
      console.log(`[Offscreen] Transcribed ${speaker}: ${transcript}`);
      chrome.runtime.sendMessage({
        type: 'TRANSCRIPT_UPDATE',
        speaker,
        text: transcript,
        timestamp: Date.now()
      });
    } else {
      console.log(`[Offscreen] Empty transcript for ${speaker}`);
    }
  } catch (error) {
    console.error(`[Offscreen] Transcription error for ${speaker}:`, error.message, error.stack);
  }
}
