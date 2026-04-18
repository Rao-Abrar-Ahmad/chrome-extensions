const STORAGE_KEYS = {
  NOTES: "pa_notes",
  REMINDERS: "pa_reminders",
  SETTINGS: "pa_settings",
  PENDING_ACTION: "pa_pending_action"
};

export async function getNotes() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.NOTES);
  return result[STORAGE_KEYS.NOTES] || [];
}

export async function setNotes(notes) {
  await chrome.storage.local.set({ [STORAGE_KEYS.NOTES]: notes });
}

export async function getReminders() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.REMINDERS);
  return result[STORAGE_KEYS.REMINDERS] || {};
}

export async function setReminders(reminders) {
  await chrome.storage.local.set({ [STORAGE_KEYS.REMINDERS]: reminders });
}

export async function updateNote(updatedNote) {
  const notes = await getNotes();
  const index = notes.findIndex((n) => n.id === updatedNote.id);
  if (index === -1) {
    notes.unshift(updatedNote); // New note
  } else {
    notes[index] = updatedNote; // Update existing
  }
  await setNotes(notes);
}

export async function deleteNote(id) {
  const notes = await getNotes();
  await setNotes(notes.filter((n) => n.id !== id));
}

export async function getPendingAction() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.PENDING_ACTION);
  return result[STORAGE_KEYS.PENDING_ACTION] || null;
}

export async function setPendingAction(action) {
  await chrome.storage.local.set({ [STORAGE_KEYS.PENDING_ACTION]: action });
}

export async function clearPendingAction() {
  await chrome.storage.local.remove(STORAGE_KEYS.PENDING_ACTION);
}
