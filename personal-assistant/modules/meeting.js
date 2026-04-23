export const MEETING_PLATFORMS = [
  { name: 'Google Meet',      match: (url) => url.includes('meet.google.com') },
  { name: 'Zoom',             match: (url) => url.includes('zoom.us/wc/') || url.includes('zoom.us/j/') },
  { name: 'Microsoft Teams',  match: (url) => url.includes('teams.microsoft.com/l/meetup-join') || url.includes('teams.live.com/meet') },
];

export async function detectMeetingTab() {
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

export function detectQuestion(text) {
  const t = text.trim().toLowerCase();
  if (!t || t.split(' ').length < 3) return false;

  if (t.endsWith('?')) return true;

  const questionPrefixes = [
    'what ', 'how ', 'why ', 'when ', 'where ', 'who ', 'which ',
    'can you ', 'could you ', 'do you ', 'does ', 'did ',
    'is there ', 'are there ', 'will you ', 'would you ',
    'tell me ', 'explain ', 'help me ', 'describe '
  ];
  if (questionPrefixes.some(p => t.startsWith(p))) return true;

  const impliedPhrases = [
    'tell me about', 'can you explain', 'help me understand',
    'what about', 'how about', 'i was wondering', 'do you know'
  ];
  if (impliedPhrases.some(p => t.includes(p))) return true;

  return false;
}
