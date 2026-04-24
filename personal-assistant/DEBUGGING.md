# Meeting Assistant - Debugging Guide

## Issue: Permission Page Not Working

If clicking "Start Listening" opens a permission page but nothing works after granting permission, follow these debugging steps:

### Step 1: Check Browser Console
1. **Reload the extension**
   - Go to `chrome://extensions/`
   - Find "Personal Assistant"
   - Click the reload icon
   - Open the extension side panel again

2. **Open the Permission Page Console**
   - When the permission page opens, press `F12` to open DevTools
   - Go to the **Console** tab
   - Click the "Grant Microphone Permission" button
   - Look for any errors in the console

3. **Expected Console Output:**
   ```
   If successful: Permission granted message appears
   If error: Shows what went wrong (permission denied, device not found, etc.)
   ```

### Step 2: Check Background Service Worker Logs
1. Go to `chrome://extensions/`
2. Find "Personal Assistant" → Click "Service Worker" (in blue)
3. Look for logs starting with `[Background]`
4. You should see:
   ```
   [Background] Received START_MEETING_CAPTURE for tabId: ...
   [Background] Successfully generated tab streamId: ...
   [Background] Creating new Offscreen Document...
   [Background] Offscreen Document created.
   ```

### Step 3: Check Offscreen Document Logs
The offscreen document handles the actual audio recording:

1. **Note:** Offscreen documents can't be inspected directly, but errors are logged to the Service Worker
2. Check the Service Worker console (Step 2) for `[Offscreen]` messages
3. Look for:
   ```
   [Offscreen] Whisper model loaded successfully
   [Offscreen] Acquired tab audio stream
   [Offscreen] Acquired mic audio stream
   [Offscreen] FATAL ERROR in startDualCapture: ...
   ```

### Step 4: Common Errors & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `NotAllowedError: Permission denied` | Microphone not permitted | Grant permission in browser settings |
| `NotFoundError: Requested device not found` | No microphone connected | Connect a microphone |
| `chrome.tabCapture is not defined` | Extension not properly loaded | Reload extension at chrome://extensions |
| `Failed to decode audio` | Audio format issue | Ensure microphone is working |
| `Whisper model failed to load` | Storage/memory issue | Check 500MB+ free disk space |

### Step 5: Verify Meeting Tab Detection

Before clicking "Start Listening":
1. Open a Google Meet, Zoom, or Teams meeting in **another Chrome tab**
2. In the extension side panel, go to the **Meeting** tab
3. You should see ✅ **Meeting detected** with the platform name
4. If you see ⚠️ **No active meeting detected**, the tab wasn't recognized

**Supported URLs:**
- Google Meet: `meet.google.com`
- Zoom: `zoom.us/wc/` or `zoom.us/j/`
- Teams: `teams.microsoft.com` or `teams.live.com/meet`

### Step 6: Test with Console Logging

If nothing is working, add this to the browser console on the permission page:

```javascript
// Test microphone access directly
navigator.mediaDevices.getUserMedia({ audio: true, video: false })
  .then(stream => {
    console.log("✅ Microphone access successful!");
    stream.getTracks().forEach(t => t.stop());
  })
  .catch(err => {
    console.error("❌ Microphone error:", err.message);
  });
```

## Full Testing Workflow

1. **Load Extension**
   ```
   chrome://extensions/ → Load unpacked → Select /dist folder
   ```

2. **Setup API Key**
   - Open side panel → Meeting tab → Settings ⚙️
   - Enter OpenRouter API key (get free one at openrouter.ai)
   - Save settings

3. **Start a Meeting**
   - Open Google Meet/Zoom/Teams in another tab
   - Extension should detect: ✅ Meeting detected

4. **Grant Permissions**
   - Click "Start Listening"
   - If permission page opens, click "Grant Microphone Permission"
   - After granting, close the tab
   - Try "Start Listening" again

5. **Verify Capture Started**
   - Transcript should start appearing in the extension
   - Timer should be counting up
   - Speak and wait 5-10 seconds for transcript to appear

6. **Check Logs**
   - Service Worker (chrome://extensions/) should show:
     ```
     [Background] START_MEETING_CAPTURE flow complete. Success.
     [Offscreen] Acquired tab audio stream.
     [Offscreen] Acquired mic audio stream.
     [Offscreen] Transcribed them: [text appears here]
     ```

## If Nothing Works

1. **Reload extension** (chrome://extensions/ → reload icon)
2. **Reload meeting tab** (F5)
3. **Check microphone** (test on teams.microsoft.com - it will ask for permission)
4. **Check storage space** (need 500MB+ for Whisper model)
5. **Restart browser** (sometimes helps with permission caching)
6. **Check WebGPU support** (chrome://gpu - look for WebGPU in "Graphics Feature Status")

## Contact Info
If errors persist, note the exact error message from:
- Service Worker console (`[Offscreen]` error)
- Permission page console (UserMedia error)
- And share it for debugging

</content>
<parameter name="filePath">d:\My Files\extenshions\personal-assistant\DEBUGGING.md