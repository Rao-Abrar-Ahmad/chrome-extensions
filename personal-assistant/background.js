import { getReminders, setReminders } from "./modules/storage.js";

// Open side panel when toolbar icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Handle messages from the side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SCHEDULE_REMINDER") {
    chrome.alarms.create(message.id, { when: message.timestamp });
    sendResponse({ success: true });
  }

  if (message.type === "CANCEL_REMINDER") {
    chrome.alarms.clear(message.id, (wasCleared) => {
      sendResponse({ success: wasCleared });
    });
    return true; // Keep message channel open for async response
  }
});

// Handle alarm firing
chrome.alarms.onAlarm.addListener(async (alarm) => {
  const reminders = await getReminders();
  const reminder = reminders[alarm.name];

  if (!reminder || !reminder.active) return;

  // Fire the OS notification
  chrome.notifications.create(alarm.name, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "Personal Assistant",
    message: reminder.title,
    priority: 2,
  });

  // Handle recurrence
  const now = Date.now();
  if (reminder.recurrence === "daily") {
    reminder.scheduledAt = now + 86400000;
    reminders[alarm.name] = reminder;
    await setReminders(reminders);
    chrome.alarms.create(alarm.name, { when: reminder.scheduledAt });
  } else if (reminder.recurrence === "weekly") {
    reminder.scheduledAt = now + 604800000;
    reminders[alarm.name] = reminder;
    await setReminders(reminders);
    chrome.alarms.create(alarm.name, { when: reminder.scheduledAt });
  } else {
    // One-time reminder: clean up
    delete reminders[alarm.name];
    await setReminders(reminders);
  }
});

// Open panel when a notification is clicked
chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.notifications.clear(notificationId);
  chrome.windows.getCurrent((win) => {
    if (win) {
        chrome.sidePanel.open({ windowId: win.id });
    }
  });
});

// Setup context menus
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "pa_root",
    title: "Personal Assistant",
    contexts: ["selection"]
  });

  chrome.contextMenus.create({
    id: "pa_save_note",
    parentId: "pa_root",
    title: "Save to New Note",
    contexts: ["selection"]
  });

  chrome.contextMenus.create({
    id: "pa_create_task",
    parentId: "pa_root",
    title: "Create Task from Selection",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  // sidePanel.open MUST be called synchronously in the user gesture handler
  if(tab && tab.windowId) {
      // We pass the promise rejection silently to avoid unhandled promise errors if already open
      chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }

  // Handle async storage logic independently so we don't block the user gesture
  (async () => {
      if (info.menuItemId === "pa_save_note" && info.selectionText) {
        const timestamp = Date.now();
        const newNote = {
          id: `${timestamp}_${Math.random().toString(36).substr(2, 6)}`,
          title: 'Note from Web',
          body: info.selectionText,
          createdAt: timestamp,
          updatedAt: timestamp,
          pinned: false,
          reminderAt: null,
          tags: [],
          deleted: false
        };

        const notesObj = await chrome.storage.local.get("pa_notes");
        const notes = notesObj["pa_notes"] || [];
        notes.unshift(newNote);
        await chrome.storage.local.set({ "pa_notes": notes });

        await chrome.storage.local.set({ "pa_pending_action": { action: 'open_note', id: newNote.id } });

      } else if (info.menuItemId === "pa_create_task" && info.selectionText) {
          const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
          await chrome.storage.local.set({ "pa_pending_action": { action: 'create_task', text: info.selectionText } });
      }
  })();
});

// tabCapture and offscreen management
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_MEETING_CAPTURE') {
    const { tabId } = message;

    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, async (streamId) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
        return;
      }

      // Create Offscreen Document if it doesn't exist
      const offscreenUrl = chrome.runtime.getURL('offscreen.html');
      const existing = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [offscreenUrl]
      });

      if (existing.length === 0) {
        await chrome.offscreen.createDocument({
          url: offscreenUrl,
          reasons: ['USER_MEDIA'],
          justification: 'Capture tab audio and microphone for meeting transcription'
        });
      }

      // Forward the stream ID to the Offscreen Document
      chrome.runtime.sendMessage({
        type: 'OFFSCREEN_START_CAPTURE',
        streamId: streamId
      });

      sendResponse({ success: true });
    });

    return true; // Keep async channel open
  }

  if (message.type === 'STOP_MEETING_CAPTURE') {
    chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP_CAPTURE' });
    chrome.offscreen.closeDocument().catch(() => {});
    sendResponse({ success: true });
    return true;
  }
});
