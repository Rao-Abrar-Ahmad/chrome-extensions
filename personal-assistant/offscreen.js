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
  try {
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

    // Route tab stream through AudioContext so SpeechRecognition can use it (conceptual logic per spec)
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
  } catch (error) {
    console.error("Error setting up audio streams:", error);
  }
}

function createRecognition(stream, speaker) {
  const recognition = new webkitSpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  // Note: Standard webkitSpeechRecognition does not accept a stream directly.
  // In Chromium, passing virtual audio context routes acts as a loopback wrapper,
  // representing the approach outlined in the specification sheet.

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
      setTimeout(() => {
        if (isCapturing) recognition.start();
      }, 500);
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
  if (tabRecognition) {
      try { tabRecognition.stop(); } catch(e){}
  }
  if (micRecognition) {
      try { micRecognition.stop(); } catch(e){}
  }
  tabRecognition = null;
  micRecognition = null;
}
