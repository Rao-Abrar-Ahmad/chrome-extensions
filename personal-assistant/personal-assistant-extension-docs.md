# Personal Assistant — Chrome Extension

## Complete Technical Documentation

**Version:** 1.0  
**Last Updated:** April 2026  
**Status:** Pre-development

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Goals & Principles](#2-goals--principles)
3. [Technical Stack](#3-technical-stack)
4. [Chrome Extension Architecture](#4-chrome-extension-architecture)
5. [File Structure](#5-file-structure)
6. [Manifest Configuration](#6-manifest-configuration)
7. [Feature 1 — Notes Keeper](#7-feature-1--notes-keeper)
8. [Feature 2 — Notification Scheduler](#8-feature-2--notification-scheduler)
9. [Data Models](#9-data-models)
10. [Storage Layer](#10-storage-layer)
11. [Service Worker (Background)](#11-service-worker-background)
12. [UI Design Spec](#12-ui-design-spec)
13. [Keyboard Shortcuts](#13-keyboard-shortcuts)
14. [Permissions](#14-permissions)
15. [Build Phases & Roadmap](#15-build-phases--roadmap)
16. [Edge Cases & Error Handling](#16-edge-cases--error-handling)
17. [Future Features](#17-future-features)
18. [Glossary](#18-glossary)

---

## 1. Project Overview

**Personal Assistant** is a Chrome browser extension that opens as a native Side Panel — the built-in sidebar introduced in Chrome 114. It serves as a daily productivity companion, accessible from any tab without interrupting the current browsing session.

The extension is designed to grow over time. Each feature is a self-contained tab within the Side Panel, so new capabilities can be added without modifying or risking existing ones.

### Phase 1 scope (this document)

This document covers the first two features being built:

- **Notes Keeper** — a full-featured note-taking system with auto-save
- **Notification Scheduler** — browser push notifications for notes and standalone daily tasks

### How it opens

When the user clicks the Personal Assistant icon in the Chrome toolbar, the browser's native Side Panel opens on the right side of the browser window. The panel stays open while the user browses. It does not open a popup or a new tab.

---

## 2. Goals & Principles

### Core goals

- Everything works offline. No backend server is required for Phase 1.
- Notes must never be lost. Auto-save runs continuously so data is preserved even if the browser crashes.
- Notifications must be reliable. Scheduled reminders fire at the exact time even if the extension panel is closed.
- The UI must be fast. The panel should feel instant — no loading spinners for normal operations.
- The codebase must stay simple enough that a new developer (or AI agent) can understand any file in under five minutes.

### Design principles

- No frameworks in Phase 1. Vanilla JavaScript, HTML, and CSS only. No build step required.
- No external dependencies. Everything uses Chrome's built-in APIs.
- Storage is local first. Data lives on the user's machine. Sync can be added later as an opt-in.
- Each feature tab is independently developed. Notes and Tasks/Reminders do not share code beyond the storage helpers.
- Mobile-aware but desktop-first. The Side Panel is typically 400px wide. All layouts should work at this width.

---

## 3. Technical Stack

| Layer         | Choice                       | Reason                                   |
| ------------- | ---------------------------- | ---------------------------------------- |
| Language      | Vanilla JavaScript (ES2020+) | No build step, direct Chrome API access  |
| Markup        | HTML5                        | Native Chrome extension format           |
| Styling       | CSS3 with custom properties  | No preprocessor needed, supports theming |
| Storage       | chrome.storage.local         | Offline, persistent, no backend          |
| Alarms        | chrome.alarms API            | Survives browser restarts                |
| Notifications | chrome.notifications API     | Native OS-level push notifications       |
| Background    | Manifest V3 Service Worker   | Chrome's current standard                |
| Icons         | PNG (16px, 48px, 128px)      | Required by Chrome Web Store             |

---

## 4. Chrome Extension Architecture

A Chrome extension has multiple distinct execution contexts. Understanding which code runs where is critical before writing a single line.

### Execution contexts

**Side Panel (sidepanel.html + sidepanel.js)**

This is the main UI. It runs in its own browser window context, isolated from page content. All user interactions happen here — creating notes, editing, scheduling reminders. It can read and write `chrome.storage.local` directly. It communicates with the Service Worker via `chrome.runtime.sendMessage()`.

Lifetime: active while the panel is open. Destroyed when the panel closes.

**Service Worker (background.js)**

The background brain. It handles events that need to fire even when the panel is closed — specifically alarm events and notification creation. It does not have access to the DOM. Chrome wakes it on demand and may terminate it between events to save memory.

Lifetime: event-driven. Chrome wakes it when an alarm fires or a message is received, then may terminate it.

**chrome.storage.local**

Persistent key-value store. Not a "context" but a shared data layer both the Side Panel and Service Worker read from and write to. Survives browser restarts. Acts as the single source of truth.

### Communication flow

```
User types in panel
       │
       ▼
sidepanel.js debounce timer (2s)
       │
       ▼
chrome.storage.local.set({ notes: [...] })
       │
       ▼
"Saved" badge shown in UI



User schedules a reminder
       │
       ▼
sidepanel.js sends message:
chrome.runtime.sendMessage({ type: 'SCHEDULE_REMINDER', id, title, when })
       │
       ▼
background.js receives message
       │
       ▼
chrome.alarms.create(id, { when: timestamp })
       │
       ▼
[time passes — panel may be closed]
       │
       ▼
Chrome fires alarm → wakes Service Worker
       │
       ▼
background.js looks up task from chrome.storage.local
       │
       ▼
chrome.notifications.create(...)  →  OS notification appears
```

---

## 5. File Structure

```
personal-assistant/
│
├── manifest.json                 # Extension config, permissions, entry points
├── background.js                 # Service Worker: alarms + notification handler
│
├── sidepanel.html                # Side Panel HTML shell
├── sidepanel.js                  # All panel logic (notes, tasks, auto-save, UI)
├── sidepanel.css                 # All panel styles
│
├── modules/                      # Split out as sidepanel.js grows
│   ├── notes.js                  # Notes CRUD operations + auto-save
│   ├── tasks.js                  # Standalone task management
│   ├── storage.js                # chrome.storage read/write helpers
│   ├── scheduler.js              # Alarm registration helpers
│   └── ui.js                     # DOM helpers, tab switching, toast notifications
│
└── icons/
    ├── icon16.png                # Toolbar icon
    ├── icon48.png                # Extension management page
    └── icon128.png               # Chrome Web Store
```

### File responsibilities in plain language

**manifest.json** — The contract with Chrome. Declares what the extension can do, what files it uses, and what permissions it needs. Nothing runs without this being correct.

**background.js** — Wakes up when alarms fire. Reads the task from storage. Creates the notification. Goes back to sleep. It should be kept minimal — only alarm + notification logic belongs here.

**sidepanel.html** — The skeleton of the UI. Loads the CSS and JS. Contains the tab bar and placeholder containers for each tab's content.

**sidepanel.js** — The largest file. Handles everything the user sees and does: creating notes, editing, deleting, auto-saving, scheduling reminders, switching tabs, showing toasts. In Phase 2+ this gets split into the modules/ folder.

**sidepanel.css** — All visual styles. Uses CSS custom properties for theming so a dark mode can be added by changing variables.

**modules/storage.js** — A thin wrapper around `chrome.storage.local.get` and `.set`. Both the panel and the background script use the same storage keys, defined here as constants to prevent typos.

---

## 6. Manifest Configuration

Below is the complete `manifest.json` for Phase 1 and 2. Comments explain every field.

```json
{
  "manifest_version": 3,
  "name": "Personal Assistant",
  "version": "1.0.0",
  "description": "Your daily productivity companion — notes, reminders, and daily tasks in Chrome's side panel.",

  "permissions": ["storage", "alarms", "notifications"],

  "action": {
    "default_title": "Open Personal Assistant",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },

  "side_panel": {
    "default_path": "sidepanel.html"
  },

  "background": {
    "service_worker": "background.js",
    "type": "module"
  },

  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

### Permission explanations

- `"storage"` — required for `chrome.storage.local`. Without this, all data is lost on panel close.
- `"alarms"` — required for `chrome.alarms.create()`. Without this, scheduled notifications cannot fire when the panel is closed.
- `"notifications"` — required for `chrome.notifications.create()`. Without this, no OS-level notification can be shown.

None of these permissions show a scary warning to users during installation. They are all considered low-sensitivity by Chrome.

### Opening the Side Panel on toolbar click

The extension needs a small piece of code in `background.js` to open the side panel when the toolbar icon is clicked:

```javascript
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});
```

---

## 7. Feature 1 — Notes Keeper

### Overview

The Notes Keeper is the first tab in the Side Panel. It lets the user create, view, edit, delete, search, and pin plain-text notes. Notes are saved automatically. A note can optionally have a reminder attached.

### User stories

- As a user, I can click "+ New Note" to create a blank note that immediately opens in edit mode.
- As a user, I can type a title and body for my note.
- As a user, my note is saved automatically 2 seconds after I stop typing, without any action on my part.
- As a user, I can press Ctrl+S to save immediately at any time.
- As a user, I can see a brief "Saved" indicator when a save completes so I know my work is not lost.
- As a user, I can see all my notes as a list sorted by most recently edited.
- As a user, I can click any note in the list to open and edit it.
- As a user, I can delete a note with a swipe or a delete button, with a 5-second undo option before permanent deletion.
- As a user, I can pin important notes so they always appear at the top of the list.
- As a user, I can type in the search bar to filter notes by title or body text in real time.
- As a user, I can set a reminder on any note using a date-time picker.
- As a user, my notes are still there when I close and reopen the panel or restart Chrome.

### UI states

The Notes tab has three UI states:

**List view** — the default state. Shows all notes as cards sorted by `updatedAt` descending. Pinned notes are always at the top. Each card shows: title (or "Untitled note" if blank), first line of body text, and a relative time label ("2 hours ago", "Yesterday"). A search bar sits above the list.

**Detail / edit view** — opens when the user taps a note card or creates a new note. Shows a full-width title input and a multi-line body textarea. The auto-save indicator ("Saved" / "Saving...") is visible in the top-right. A back button returns to list view. A bell icon opens the reminder picker.

**Empty state** — shown when there are no notes. Displays a simple message and a prominent "+ Create your first note" button.

### Auto-save implementation

Auto-save is debounced. This means a save only fires after the user has stopped typing for 2 seconds. If they keep typing, the timer keeps resetting.

```javascript
let autoSaveTimer = null;

function onNoteInput() {
  clearTimeout(autoSaveTimer);
  showSaveStatus("saving");
  autoSaveTimer = setTimeout(() => {
    saveCurrentNote();
    showSaveStatus("saved");
  }, 2000);
}

function saveCurrentNote() {
  const note = getCurrentNoteFromDOM();
  note.updatedAt = Date.now();
  updateNoteInStorage(note);
}
```

Manual save (Ctrl+S) calls `saveCurrentNote()` directly and clears the debounce timer so the auto-save does not double-fire.

### Note operations

**Create**

```javascript
function createNote() {
  const note = {
    id: `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    title: "",
    body: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pinned: false,
    reminderAt: null,
    tags: [],
  };
  // Prepend to notes array in storage
  // Open detail view immediately
}
```

**Update** — reads current note from DOM, updates `updatedAt`, writes full notes array back to storage.

**Delete** — marks note as `deleted: true` in memory and removes from UI immediately. A toast with "Undo" appears for 5 seconds. If undo is clicked, the note is restored. After 5 seconds, the note is permanently removed from storage.

**Pin** — toggles `pinned: true/false`. Re-sorts the list so pinned notes appear first, then the rest by `updatedAt`.

**Search** — filters the in-memory notes array using `note.title.includes(query) || note.body.includes(query)`. Case-insensitive. Does not hit storage on every keystroke — the array is always kept in memory after initial load.

### Sorting logic

```javascript
function sortNotes(notes) {
  return notes
    .filter((n) => !n.deleted)
    .sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.updatedAt - a.updatedAt;
    });
}
```

---

## 8. Feature 2 — Notification Scheduler

### Overview

The Notification Scheduler is the second tab in the Side Panel. It has two sub-sections:

- **Note reminders** — set a reminder on a specific note. The notification fires with the note title.
- **Daily tasks** — standalone tasks not attached to any note. Examples: "Check LinkedIn", "Post on X", "Daily standup at 10am". These can be one-time or recurring.

Both types use the same underlying mechanism: `chrome.alarms` + `chrome.notifications`.

### Why chrome.alarms and not setTimeout

`setTimeout` only works while the JavaScript context is alive. The Side Panel's JS context is destroyed when the panel is closed. `chrome.alarms` is owned by Chrome itself — it persists alarms across browser restarts, across extension updates, and fires them even if the extension's JS is not currently running. This is the only reliable way to schedule future notifications in an extension.

### User stories

- As a user, I can set a reminder on any note by tapping the bell icon in the note detail view.
- As a user, I can pick an exact date and time for the reminder using a datetime picker.
- As a user, I receive a browser push notification at the exact scheduled time, even if I've closed the panel or minimized Chrome.
- As a user, clicking the notification opens the Side Panel.
- As a user, I can create a standalone task (e.g. "Post on X") with a scheduled time and optional recurrence.
- As a user, I can choose daily or weekly recurrence for any task.
- As a user, I can see all upcoming reminders and tasks in a sorted list.
- As a user, I can cancel or reschedule any upcoming reminder.

### How scheduling works end-to-end

**Step 1 — User sets a reminder in the panel**

The user picks a date and time in the datetime picker. The panel builds a reminder object and saves it to storage, then sends a message to the Service Worker:

```javascript
async function scheduleReminder(id, title, timestamp) {
  // Save to storage so background.js can look it up
  const reminders = await getReminders();
  reminders[id] = { id, title, timestamp, type: "note" };
  await setReminders(reminders);

  // Tell the Service Worker to register the alarm
  chrome.runtime.sendMessage({
    type: "SCHEDULE_REMINDER",
    id,
    timestamp,
  });
}
```

**Step 2 — Service Worker registers the alarm**

```javascript
// background.js
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "SCHEDULE_REMINDER") {
    chrome.alarms.create(message.id, {
      when: message.timestamp,
    });
  }

  if (message.type === "CANCEL_REMINDER") {
    chrome.alarms.clear(message.id);
  }
});
```

**Step 3 — Alarm fires**

```javascript
// background.js
chrome.alarms.onAlarm.addListener(async (alarm) => {
  // Look up the reminder details from storage
  const reminders = await getReminders();
  const reminder = reminders[alarm.name];

  if (!reminder) return;

  // Show the OS notification
  chrome.notifications.create(alarm.name, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "Personal Assistant",
    message: reminder.title,
    priority: 2,
    requireInteraction: false,
  });

  // If recurring, schedule the next occurrence
  if (reminder.recurrence === "daily") {
    const nextTime = reminder.timestamp + 24 * 60 * 60 * 1000;
    reminder.timestamp = nextTime;
    reminders[alarm.name] = reminder;
    await setReminders(reminders);
    chrome.alarms.create(alarm.name, { when: nextTime });
  } else if (reminder.recurrence === "weekly") {
    const nextTime = reminder.timestamp + 7 * 24 * 60 * 60 * 1000;
    reminder.timestamp = nextTime;
    reminders[alarm.name] = reminder;
    await setReminders(reminders);
    chrome.alarms.create(alarm.name, { when: nextTime });
  } else {
    // One-time: clean up from storage
    delete reminders[alarm.name];
    await setReminders(reminders);
  }
});
```

**Step 4 — User clicks the notification**

```javascript
chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.notifications.clear(notificationId);
  // Open the side panel
  chrome.windows.getCurrent((window) => {
    chrome.sidePanel.open({ windowId: window.id });
  });
});
```

### Daily tasks data model

A standalone task (not linked to a note) has this structure:

```javascript
{
  id: "task_1718200000000_abc123",
  type: "task",                      // "task" | "note_reminder"
  title: "Post on X",
  description: "",                   // optional extra detail
  scheduledAt: 1718200000000,        // ms timestamp for next fire
  recurrence: "daily",               // "none" | "daily" | "weekly"
  createdAt: 1718100000000,
  active: true
}
```

### Recurrence options

| Option | Behavior                 | chrome.alarms approach                                   |
| ------ | ------------------------ | -------------------------------------------------------- |
| None   | Fires once, then removed | `chrome.alarms.create(id, { when: timestamp })`          |
| Daily  | Fires every 24 hours     | One-shot alarm; on fire, register new alarm 24h later    |
| Weekly | Fires every 7 days       | One-shot alarm; on fire, register new alarm 7 days later |

Note: `chrome.alarms` supports a `periodInMinutes` option but the minimum period is 1 minute and it drifts over time. Re-registering a precise `when` on each fire is more accurate for daily/weekly tasks.

---

## 9. Data Models

### Note

```javascript
{
  id: string,           // "${Date.now()}_${randomSuffix}" — unique, never reused
  title: string,        // User-entered title. Empty string if not set.
  body: string,         // Full note body text.
  createdAt: number,    // Unix timestamp in milliseconds.
  updatedAt: number,    // Updated on every save. Used for sorting.
  pinned: boolean,      // If true, shown at top of list regardless of updatedAt.
  reminderAt: number|null, // Timestamp of scheduled reminder. Null if none.
  tags: string[],       // Optional tags e.g. ["work", "meetings"]. Empty array default.
  deleted: boolean      // Soft-delete flag. True = pending permanent deletion.
}
```

### Reminder / Task

```javascript
{
  id: string,           // For note reminders: same as the note's id.
                        // For tasks: "task_${Date.now()}_${randomSuffix}"
  type: string,         // "note_reminder" | "task"
  title: string,        // Displayed in the notification. For note reminders: note title.
  description: string,  // Optional. Shown in full in the Reminders list view.
  scheduledAt: number,  // Timestamp of next scheduled fire.
  recurrence: string,   // "none" | "daily" | "weekly"
  createdAt: number,
  active: boolean       // False = paused. Alarm is cleared but task remains in list.
}
```

### Storage keys

All storage keys are defined as constants in `modules/storage.js` to avoid typos:

```javascript
const STORAGE_KEYS = {
  NOTES: "pa_notes", // Array of Note objects
  REMINDERS: "pa_reminders", // Object keyed by id: { [id]: Reminder }
  SETTINGS: "pa_settings", // User preferences (future use)
};
```

---

## 10. Storage Layer

### Why chrome.storage.local

- Persists across browser restarts and extension updates
- Synchronous-feeling with async/await wrappers
- No server, no auth, no network dependency
- ~10MB limit — far more than needed for text notes
- Both the Side Panel and Service Worker can read/write it

### Storage helpers (modules/storage.js)

```javascript
const STORAGE_KEYS = {
  NOTES: "pa_notes",
  REMINDERS: "pa_reminders",
  SETTINGS: "pa_settings",
};

async function getNotes() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.NOTES);
  return result[STORAGE_KEYS.NOTES] || [];
}

async function setNotes(notes) {
  await chrome.storage.local.set({ [STORAGE_KEYS.NOTES]: notes });
}

async function getReminders() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.REMINDERS);
  return result[STORAGE_KEYS.REMINDERS] || {};
}

async function setReminders(reminders) {
  await chrome.storage.local.set({ [STORAGE_KEYS.REMINDERS]: reminders });
}

async function updateNote(updatedNote) {
  const notes = await getNotes();
  const index = notes.findIndex((n) => n.id === updatedNote.id);
  if (index === -1) {
    notes.unshift(updatedNote); // New note
  } else {
    notes[index] = updatedNote; // Update existing
  }
  await setNotes(notes);
}

async function deleteNote(id) {
  const notes = await getNotes();
  await setNotes(notes.filter((n) => n.id !== id));
}
```

### Storage size management

Plain text notes are tiny. A note with 500 words is approximately 3KB. The 10MB limit supports roughly 3,000 such notes. No special management is needed in Phase 1.

If attachments or rich text are added in a future phase, the storage strategy should be revisited (consider IndexedDB for larger payloads).

---

## 11. Service Worker (Background)

The Service Worker (`background.js`) is intentionally kept minimal. It does exactly two things:

1. Listens for messages from the Side Panel to register or cancel alarms
2. Listens for alarm events to fire notifications

The full `background.js` for Phase 2:

```javascript
// background.js
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
    chrome.sidePanel.open({ windowId: win.id });
  });
});
```

### Important Service Worker constraints

- The Service Worker has no access to the DOM — never try to manipulate UI elements from background.js.
- `console.log` in the Service Worker only appears in the Service Worker's DevTools, not the panel's DevTools. Open it via `chrome://extensions` → "Inspect views: service worker".
- The Service Worker may be terminated by Chrome at any time between events. Never rely on in-memory state — always read from `chrome.storage.local`.
- Always use `return true` at the end of an `onMessage` listener that sends an asynchronous response, otherwise the message channel closes before the response can be sent.

---

## 12. UI Design Spec

### Layout

The Side Panel is a fixed 400px wide panel on the right side of the browser. The layout is:

```
┌─────────────────────────────────────┐
│  Personal Assistant            ⚙️   │  ← Header bar (48px)
├─────────────────────────────────────┤
│  📋 Notes    🔔 Reminders    ...    │  ← Tab bar (44px)
├─────────────────────────────────────┤
│                                     │
│                                     │  ← Active tab content (fills rest)
│                                     │
│                                     │
└─────────────────────────────────────┘
```

### Notes tab layout

**List view:**

```
┌─────────────────────────────────────┐
│  🔍  Search notes...                │  ← Search input
├─────────────────────────────────────┤
│  ┌───────────────────────────────┐  │
│  │ 📌 Meeting with Sarah         │  │  ← Pinned note card
│  │ Discuss Q3 roadmap...         │  │
│  │                    2 hrs ago  │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ Grocery list                  │  │  ← Regular note card
│  │ Eggs, milk, bread...          │  │
│  │                   Yesterday   │  │
│  └───────────────────────────────┘  │
│                                     │
│           + New Note                │  ← Floating action button
└─────────────────────────────────────┘
```

**Detail / edit view:**

```
┌─────────────────────────────────────┐
│  ←  Back              Saved ✓  🔔  │  ← Top bar with save status + bell
├─────────────────────────────────────┤
│                                     │
│  [Title input — large, borderless]  │
│                                     │
│  [Body textarea — fills space,      │
│   borderless, grows with content]   │
│                                     │
│                                     │
│                                     │
│  ─────────────────────────────────  │
│  🗑️ Delete          📌 Pin          │  ← Action bar at bottom
└─────────────────────────────────────┘
```

### Reminders tab layout

```
┌─────────────────────────────────────┐
│  Upcoming reminders                 │
├─────────────────────────────────────┤
│  Today                              │
│  ┌───────────────────────────────┐  │
│  │ 🔔 Daily standup    10:00 AM  │  │
│  │ Recurring daily        ✏️ 🗑️  │  │
│  └───────────────────────────────┘  │
│                                     │
│  Tomorrow                           │
│  ┌───────────────────────────────┐  │
│  │ 🔔 Meeting with Sarah  2:00PM │  │
│  │ From note                ✏️ 🗑️ │  │
│  └───────────────────────────────┘  │
│                                     │
│           + Add Task                │  ← Button opens task form
└─────────────────────────────────────┘
```

### Color system (CSS custom properties)

```css
:root {
  --color-bg-primary: #ffffff;
  --color-bg-secondary: #f8f8f7;
  --color-bg-tertiary: #f0efec;

  --color-text-primary: #1a1a18;
  --color-text-secondary: #6b6b68;
  --color-text-tertiary: #9b9b97;

  --color-border: rgba(0, 0, 0, 0.1);
  --color-border-strong: rgba(0, 0, 0, 0.2);

  --color-accent: #2563eb;
  --color-accent-soft: #eff6ff;

  --color-success: #16a34a;
  --color-danger: #dc2626;
  --color-warning: #d97706;

  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;

  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-mono: "SF Mono", "Fira Code", monospace;
}
```

### Typography scale

| Usage                | Size | Weight |
| -------------------- | ---- | ------ |
| Panel title          | 16px | 600    |
| Tab labels           | 13px | 500    |
| Note title (list)    | 14px | 500    |
| Note body preview    | 13px | 400    |
| Timestamp / metadata | 12px | 400    |
| Note title (edit)    | 20px | 500    |
| Note body (edit)     | 15px | 400    |

### Toast / save indicator

The "Saved" indicator is a small badge in the top-right of the edit view. It has three states:

- **Idle** — invisible
- **Saving...** — visible, muted gray, shown immediately when the user starts typing
- **Saved ✓** — visible, green, shown for 1.5 seconds after a successful save, then fades out

---

## 13. Keyboard Shortcuts

These shortcuts work when focus is inside the Side Panel.

| Shortcut              | Action                                  |
| --------------------- | --------------------------------------- |
| Ctrl+N (Cmd+N on Mac) | Create new note                         |
| Ctrl+S (Cmd+S on Mac) | Save current note immediately           |
| Escape                | Go back to list view from detail view   |
| Ctrl+F (Cmd+F on Mac) | Focus the search input                  |
| Ctrl+D (Cmd+D on Mac) | Delete current note (with confirmation) |

---

## 14. Permissions

### Full permissions list for manifest.json

```json
"permissions": ["storage", "alarms", "notifications"]
```

### What each permission allows and why it's needed

**storage**

Allows use of `chrome.storage.local` and `chrome.storage.sync`. Required to save notes and reminders persistently. Without this, all data is cleared when the panel closes.

Chrome warning level: None — not shown to users.

**alarms**

Allows use of `chrome.alarms.create()`, `.clear()`, and the `onAlarm` event. Required for scheduled notifications to work when the panel is closed. Without this, reminders can only fire while the panel is open (using `setTimeout`), which is unreliable.

Chrome warning level: None — not shown to users.

**notifications**

Allows use of `chrome.notifications.create()`. Required to show OS-level push notifications. Without this, there is no way to alert the user outside the panel.

Chrome warning level: None — not shown to users.

### Permissions explicitly not requested

- `tabs` — not needed. The extension does not read or manipulate page content.
- `activeTab` — not needed.
- `host_permissions` — not needed. No web requests are made.
- `identity` — not needed. No login or sync in Phase 1.

---

## 15. Build Phases & Roadmap

### Phase 1 — Foundation (Target: Week 1)

**Goal:** Working extension with full Notes feature.

Deliverables:

- `manifest.json` with side_panel, storage permission, service worker
- `background.js` with toolbar click → open panel
- `sidepanel.html` shell with tab bar (Notes tab + placeholder Reminders tab)
- `sidepanel.css` with full design system (colors, typography, components)
- Full Notes feature: create, edit, delete, list view, detail view, auto-save, manual save, pin, search
- `modules/storage.js` with helpers for notes
- Empty state for Notes tab
- Soft-delete with 5-second undo toast

**Does not include:** Notifications, alarms, tasks, recurring reminders.

**Test criteria:**

- Create a note, close the panel, reopen — note is still there
- Edit a note in the middle of a sentence — "Saved" badge appears 2 seconds after stopping
- Delete a note — undo toast appears; clicking undo restores the note
- Pin a note — it moves to top of list and stays there across reopens
- Search "meeting" — only notes containing "meeting" are shown

---

### Phase 2 — Notifications (Target: Week 2)

**Goal:** Full notification scheduling for notes and standalone tasks.

Deliverables:

- `alarms` and `notifications` permissions added to manifest
- `background.js` expanded with full alarm + notification handler
- Bell icon in note detail view → datetime picker → saves reminder
- Reminders tab: list view of all upcoming reminders and tasks, sorted by time
- Add Task form: title, description, datetime, recurrence selector
- Cancel and reschedule actions on each reminder
- Clicking a notification opens the side panel
- Recurring reminders: daily and weekly
- `modules/scheduler.js` helper

**Test criteria:**

- Schedule a reminder 2 minutes in the future → close the panel → notification fires at the right time
- Click the notification → side panel opens
- Schedule a daily recurring task → fires the next day → reschedules automatically
- Cancel a reminder → alarm is cleared → no notification fires

---

### Phase 3 — Polish (Target: Week 3)

**Goal:** Production-quality experience.

Deliverables:

- Tags on notes (add, remove, filter by tag)
- Notification click navigates directly to the linked note (not just opens panel)
- "Upcoming" badge on Reminders tab showing count of reminders due today
- Settings panel: notification sound on/off, default reminder time, color theme
- Dark mode using CSS custom property swap
- Full keyboard navigation
- Import/export notes as JSON (backup)

---

## 16. Edge Cases & Error Handling

### Notes

| Scenario                                           | Handling                                                                                                                                             |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| User closes panel while auto-save timer is pending | On `window.beforeunload` (or `visibilitychange`), force-save immediately without waiting for the debounce                                            |
| Storage write fails                                | Show a red "Save failed" badge. Retry once after 1 second. If still failing, alert the user with an inline error message. Do not silently lose data. |
| Two notes with the same title                      | Allowed. Notes are identified by `id`, not title. No uniqueness constraint.                                                                          |
| Note body is very long (100,000+ characters)       | No hard limit. `chrome.storage.local` handles it. Performance may degrade — if noted, consider virtual scrolling in the textarea.                    |
| User deletes a note that has a pending reminder    | Also clear the alarm: `chrome.alarms.clear(note.id)` and remove the reminder from storage.                                                           |

### Notifications

| Scenario                                         | Handling                                                                                                                                                                                                                                      |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alarm fires but reminder is missing from storage | Log a warning, skip notification. This can happen if storage was cleared externally.                                                                                                                                                          |
| Chrome is closed when alarm fires                | Chrome will NOT fire the alarm while it is closed. On next Chrome launch, if the scheduled time has passed, the alarm is gone. This is a Chrome platform limitation. Display a note in the UI: "Reminders only fire while Chrome is running." |
| User schedules a reminder in the past            | Validate in the UI. If `timestamp < Date.now()`, show an error: "Please choose a future time." Do not register the alarm.                                                                                                                     |
| User schedules many alarms (100+)                | `chrome.alarms` supports up to 500 alarms. No special handling needed for normal use.                                                                                                                                                         |
| Notifications permission denied by OS            | `chrome.notifications.create()` will silently fail. On extension load, check notification permission. If unavailable, show a banner in the Reminders tab: "Notifications are blocked. Enable them in your system settings."                   |

### Storage

| Scenario               | Handling                                                                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage quota exceeded | `chrome.storage.local.set()` will call its callback with `chrome.runtime.lastError` set. Catch this and show an error: "Storage full. Please delete some notes." |
| Storage data corrupted | Wrap all `JSON.parse` calls in try/catch. If data is unreadable, reset to an empty array and show a warning. Never crash silently.                               |

---

## 17. Future Features

These are not scoped for the current build but are documented here so the architecture can accommodate them without breaking changes.

### Markdown rendering

Allow note bodies to be written in Markdown and rendered as formatted HTML in read view. Edit view stays plain text. Implementation: a lightweight Markdown parser (e.g. `marked.js` included as a local file — no CDN dependency).

### Note attachments

Allow images to be pasted or dragged into a note. Would require switching storage from `chrome.storage.local` to IndexedDB for binary data. The Note data model already has an `attachments` field placeholder.

### Cross-device sync

Add a "Sync" toggle in settings. When enabled, saves to `chrome.storage.sync` (100KB limit, syncs via Google account) in addition to local storage. The data schema is identical — no migration needed.

### Web Clipper

A content script injected into web pages that lets the user select text and save it directly to a new note. Requires adding `"contextMenus"` permission and `"scripting"` permission.

### AI Assistant tab

An additional tab powered by any LLM API. Capabilities: summarize a note, generate a task list from a note, answer questions about saved notes. Requires adding `"host_permissions"` for the API endpoint. The notes would be passed as context in the API request — no fine-tuning or vector database needed for personal use at this scale.

---

## 18. Glossary

**Alarm** — a scheduled event registered with `chrome.alarms.create()`. Owned by Chrome, not by JavaScript's `setTimeout`. Persists across browser restarts.

**Auto-save** — saving triggered automatically without user action. In this extension, implemented as a debounced timer that fires 2 seconds after the user stops typing.

**Debounce** — a technique that delays function execution until after a burst of events has stopped. Used for auto-save to avoid writing to storage on every individual keystroke.

**Manifest V3 (MV3)** — the current version of Chrome's extension manifest format. Replaces background pages with Service Workers. Required for all new Chrome extensions.

**Service Worker** — a JavaScript file that runs as a background script in MV3 extensions. Has no DOM access. Event-driven — Chrome wakes it when needed and may terminate it between events.

**Side Panel** — Chrome's native sidebar UI, introduced in Chrome 114. Opened via `chrome.sidePanel.open()`. Stays visible while the user browses.

**chrome.alarms** — Chrome extension API for scheduling future JavaScript events. Minimum granularity: 1 minute. Survives browser restarts. The correct tool for scheduled notifications in extensions.

**chrome.notifications** — Chrome extension API for creating OS-level notifications. Appears in the system notification center (Windows Action Center, macOS Notification Center, etc.).

**chrome.storage.local** — Chrome extension API for persistent key-value storage. ~10MB limit. Available to both the Side Panel and Service Worker. The single source of truth in this extension.

**Soft delete** — marking a record as deleted in memory and UI while keeping it in storage temporarily. Allows undo. Permanent deletion happens after a timeout or explicit confirmation.

**Toast** — a brief, non-blocking notification message that appears temporarily in the UI and disappears automatically. Used for "Saved ✓", "Note deleted — Undo", etc.

---

_End of document — Personal Assistant Chrome Extension v1.0_
