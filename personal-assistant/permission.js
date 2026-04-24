document.getElementById('grant-btn').addEventListener('click', async () => {
  const statusEl = document.getElementById('status');
  statusEl.textContent = "Requesting...";
  statusEl.style.color = "#666";

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    stream.getTracks().forEach(t => t.stop());
    
    statusEl.innerHTML = "✅ Permission Granted! You can close this tab and hit 'Start Listening' in your side panel.";
    statusEl.style.color = "green";
  } catch (err) {
    statusEl.innerHTML = `❌ Error: ${err.message}. Please click the lock/settings icon in the URL bar and allow microphone.`;
    statusEl.style.color = "red";
  }
});
