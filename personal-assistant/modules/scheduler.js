// modules/scheduler.js
import { getReminders, setReminders } from "./storage.js";

/**
 * Validates and schedules a reminder through the background service worker
 * @param {string} id Unique identifier for the reminder/task
 * @param {string} title Text to show in the notification
 * @param {number} timestamp Unix timestamp in ms when the alarm should fire
 * @param {string} type 'note_reminder' | 'task'
 * @param {string} description Optional detailed description
 * @param {string} recurrence 'none' | 'daily' | 'weekly'
 */
export async function scheduleReminder(id, title, timestamp, type = 'note_reminder', description = '', recurrence = 'none') {
  if (timestamp < Date.now()) {
    throw new Error("Cannot schedule a reminder in the past.");
  }

  const reminders = await getReminders();
  
  // Create / update reminder object in storage
  reminders[id] = { 
    id, 
    type,
    title, 
    description,
    scheduledAt: timestamp, 
    recurrence,
    createdAt: reminders[id]?.createdAt || Date.now(),
    active: true
  };
  await setReminders(reminders);

  // Tell the Service Worker to register the alarm
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: "SCHEDULE_REMINDER",
      id,
      timestamp,
    }, resolve);
  });
}

/**
 * Cancels a reminder/task alarm while keeping it in storage (optional)
 * @param {string} id The id of the reminder/task
 * @param {boolean} keepInStorage whether to preserve it loosely in storage vs fully clean up
 */
export async function cancelReminder(id, keepInStorage = false) {
  if (!keepInStorage) {
      const reminders = await getReminders();
      delete reminders[id];
      await setReminders(reminders);
  } else {
      const reminders = await getReminders();
      if(reminders[id]) {
          reminders[id].active = false;
          await setReminders(reminders);
      }
  }

  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: "CANCEL_REMINDER",
      id,
    }, resolve);
  });
}
