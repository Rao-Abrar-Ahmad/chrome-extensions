// Content script for Google Meet transcription
console.log("[Content] Content script loaded in Google Meet");

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
console.log("[Content] SpeechRecognition API available:", !!SpeechRecognition);

let recognition = null;
let isTranscribing = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[Content] Received message:", message.type);

  if (message.type === 'CONTENT_START_TRANSCRIPTION') {
    console.log('[Content] Received CONTENT_START_TRANSCRIPTION');
    startLiveTranscription();
    sendResponse({ success: true });
  }

  if (message.type === 'CONTENT_STOP_TRANSCRIPTION') {
    console.log('[Content] Received CONTENT_STOP_TRANSCRIPTION');
    stopLiveTranscription();
    sendResponse({ success: true });
  }
});

async function startLiveTranscription() {
  if (isTranscribing) return;

  console.log("[Content] Starting live Web Speech API transcription...");

  try {
    if (!SpeechRecognition) {
      console.error("[Content] Web Speech API not supported");
      return;
    }

    // Request microphone permission if needed
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log("[Content] Microphone permission granted");
    } catch (permError) {
      console.error("[Content] Microphone permission denied:", permError);
      return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false; // Only final results for cleaner output
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      console.log("[Content] Live speech recognition started");
      isTranscribing = true;
    };

    recognition.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      if (result.isFinal) {
        const transcript = result[0].transcript.trim();
        if (transcript) {
          console.log("[Content] Live transcript:", transcript);
          chrome.runtime.sendMessage({
            type: 'TRANSCRIPT_UPDATE',
            speaker: 'them', // Meeting audio is from remote participants
            text: transcript,
            timestamp: Date.now()
          });
        }
      }
    };

    recognition.onerror = (event) => {
      console.error("[Content] Live speech recognition error:", event.error);
      if (event.error === 'not-allowed') {
        console.error("[Content] Microphone access denied");
      }
    };

    recognition.onend = () => {
      console.log("[Content] Live speech recognition ended");
      isTranscribing = false;
    };

    recognition.start();

  } catch (error) {
    console.error("[Content] Failed to start live transcription:", error);
  }
}

function stopLiveTranscription() {
  if (recognition && isTranscribing) {
    console.log("[Content] Stopping live transcription...");
    recognition.stop();
    isTranscribing = false;
  }
}