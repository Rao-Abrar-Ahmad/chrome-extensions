export const MEETING_PLATFORMS = [
  { name: 'Google Meet',      match: (url) => url.includes('meet.google.com') },
  { name: 'Zoom',             match: (url) => url.includes('zoom.us/wc/') || url.includes('zoom.us/j/') },
  { name: 'Microsoft Teams',  match: (url) => url.includes('teams.microsoft.com/l/meetup-join') || url.includes('teams.live.com/meet') },
];

export async function detectMeetingTab() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    for (const platform of MEETING_PLATFORMS) {
      if (platform.match(tab.url || '')) {
        return { tab, platform: platform.name };
      }
    }
  }
  return null;
}

export function detectQuestion(text) {
  const t = text.trim().toLowerCase();
  if (!t || t.split(' ').length < 3) return false;
  if (t.endsWith('?')) return true;
  
  const questionWords = ['what', 'how', 'why', 'when', 'where', 'who', 'which', 'can', 'could', 'do', 'does', 'is', 'are'];
  return questionWords.some(word => t.startsWith(word + ' '));
}
