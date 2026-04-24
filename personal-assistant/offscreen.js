import { pipeline } from '@xenova/transformers';

console.log("[Offscreen] Offscreen document loaded!");

let tabRecorder = null;
let micRecorder = null;
let isCapturing = false;
let transcriber = null;

chrome.runtime.onMessage.addListener(async (message) => {
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

  try {
    console.log("[Offscreen] Loading Whisper small model...");
    transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small');
    console.log("[Offscreen] Whisper model loaded successfully.");
  } catch (error) {
    console.warn("[Offscreen] Failed to load small model, trying tiny:", error);
    try {
      transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny');
      console.log("[Offscreen] Whisper tiny model loaded as fallback.");
    } catch (fallbackError) {
      console.error("[Offscreen] Failed to load any Whisper model:", fallbackError);
      throw new Error("Unable to load transcription model. Please check storage space.");
    }
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
