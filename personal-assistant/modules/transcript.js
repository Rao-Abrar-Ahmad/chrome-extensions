export function formatSessionAsNote(session) {
  const dateStr = new Date(session.startedAt).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
  });
  
  const durationMs = session.endedAt - session.startedAt;
  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.floor((durationMs % 60000) / 1000);
  const durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  let noteBody = `Platform: ${session.platform} | Duration: ${durationStr}\n\n`;
  if (session.context && session.context.trim().length > 0) {
    noteBody += `Context: ${session.context.trim()}\n\n`;
  }

  noteBody += `## Transcript\n\n`;
  
  if (session.transcript && session.transcript.length > 0) {
    session.transcript.forEach(line => {
      const timeStr = new Date(line.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const speakerLabel = line.speaker === 'you' ? 'You' : 'Them';
      noteBody += `[${timeStr}] ${speakerLabel}: ${line.text}\n`;
    });
  } else {
    noteBody += `*No transcription recorded.*\n`;
  }

  if (session.aiResponses && session.aiResponses.length > 0) {
    noteBody += `\n## AI Suggestions\n\n`;
    session.aiResponses.forEach(res => {
      noteBody += `**Q: ${res.question}**\n${res.response}\n\n`;
    });
  }

  return {
    id: session.id || `meeting_${Date.now()}`,
    title: session.title || `Meeting — ${dateStr}`,
    body: noteBody.trim(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pinned: false,
    reminderAt: null,
    tags: ['meeting', (session.platform || 'Unknown').toLowerCase().replace(/\s+/g, '-')],
    deleted: false
  };
}
