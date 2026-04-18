import { getNotes, setNotes, updateNote, deleteNote, getReminders, setReminders, getPendingAction, clearPendingAction } from './modules/storage.js';
import { scheduleReminder, cancelReminder } from './modules/scheduler.js';

// ---- STATE ----
let currentNote = null;
let autoSaveTimer = null;
let currentTask = null; // For standalone tasks

// ---- UI ELEMENTS ----
const els = {
  // Tabs
  tabs: document.querySelectorAll('.tab-btn'),
  contents: document.querySelectorAll('.tab-content'),
  
  // Notes UI
  notesListView: document.getElementById('notes-list-view'),
  noteDetailView: document.getElementById('note-detail-view'),
  notesList: document.getElementById('notes-list'),
  searchInput: document.getElementById('search-input'),
  btnNewNote: document.getElementById('btn-new-note'),
  
  // Note Detail
  btnBack: document.getElementById('btn-back'),
  saveStatus: document.getElementById('save-status'),
  btnReminder: document.getElementById('btn-reminder'),
  titleInput: document.getElementById('note-title-input'),
  bodyInput: document.getElementById('note-body-input'),
  btnDelete: document.getElementById('btn-delete'),
  btnPin: document.getElementById('btn-pin'),
  
  // Reminder Modal inside Note
  reminderModal: document.getElementById('reminder-modal'),
  reminderDatetime: document.getElementById('reminder-datetime'),
  btnCancelReminderModal: document.getElementById('btn-cancel-reminder-modal'),
  btnSaveReminder: document.getElementById('btn-save-reminder'),
  
  // Reminders / Tasks UI
  remindersListView: document.getElementById('reminders-list-view'),
  taskDetailView: document.getElementById('task-detail-view'),
  remindersList: document.getElementById('reminders-list'),
  btnNewTask: document.getElementById('btn-new-task'),
  btnBackTask: document.getElementById('btn-back-task'),
  
  // Task Detail
  taskTitleInput: document.getElementById('task-title-input'),
  taskDescInput: document.getElementById('task-desc-input'),
  taskDatetime: document.getElementById('task-datetime'),
  taskRecurrence: document.getElementById('task-recurrence'),
  btnSaveTask: document.getElementById('btn-save-task')
};

// ---- INITIALIZATION ----
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupNotesEvents();
  setupRemindersEvents();
  renderNotes();
  renderReminders();
  processPendingActions();
});

async function processPendingActions() {
    const action = await getPendingAction();
    if (!action) return;

    if (action.action === 'open_note') {
        const notes = await getNotes();
        const note = notes.find(n => n.id === action.id);
        if (note) {
            document.querySelector('[data-tab="notes"]').click();
            openNoteDetail(note);
        }
    } else if (action.action === 'create_task') {
        document.querySelector('[data-tab="reminders"]').click();
        openTaskDetail(null);
        els.taskDescInput.value = action.text;
    }
    await clearPendingAction();
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes['pa_pending_action'] && changes['pa_pending_action'].newValue) {
        processPendingActions();
    }
});

// ---- UTILS ----
function showToast(message, undoCallback = null) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  
  const text = document.createElement('span');
  text.textContent = message;
  toast.appendChild(text);

  let timeoutId;

  if (undoCallback) {
    const undoBtn = document.createElement('button');
    undoBtn.textContent = 'Undo';
    undoBtn.onclick = () => {
      clearTimeout(timeoutId);
      undoCallback();
      toast.remove();
    };
    toast.appendChild(undoBtn);
  }

  container.appendChild(toast);
  timeoutId = setTimeout(() => {
    toast.remove();
  }, 5000); // Wait 5 seconds for undo
}

function showSaveStatus(status) {
  if (status === 'saving') {
    els.saveStatus.textContent = 'Saving...';
    els.saveStatus.className = 'save-status';
  } else if (status === 'saved') {
    els.saveStatus.textContent = 'Saved ✓';
    els.saveStatus.className = 'save-status saved';
    setTimeout(() => {
      if (els.saveStatus.textContent === 'Saved ✓') {
        els.saveStatus.textContent = '';
      }
    }, 1500);
  } else {
    els.saveStatus.textContent = '';
  }
}

function timeAgo(ms) {
    const min = 60 * 1000;
    const hr = min * 60;
    const day = hr * 24;
    const diff = Date.now() - ms;
    if (diff < min) return 'Just now';
    if (diff < hr) return `${Math.floor(diff/min)}m ago`;
    if (diff < day) return `${Math.floor(diff/hr)}h ago`;
    return new Date(ms).toLocaleDateString();
}

// ==== TABS ====
function setupTabs() {
  els.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Update Tab active state
      els.tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // Update Content
      const targetId = tab.getAttribute('data-tab') + '-tab';
      els.contents.forEach(c => c.classList.remove('active'));
      document.getElementById(targetId).classList.add('active');
      
      if(targetId === 'reminders-tab') {
          renderReminders();
      } else {
          renderNotes();
      }
    });
  });
}

// ==== NOTES ====
function setupNotesEvents() {
  els.btnNewNote.addEventListener('click', () => openNoteDetail(null));
  els.btnBack.addEventListener('click', () => {
    // Force save on back if edited
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      saveCurrentNote();     
    }
    closeNoteDetail();
  });
  
  const onNoteInput = () => {
    clearTimeout(autoSaveTimer);
    showSaveStatus('saving');
    autoSaveTimer = setTimeout(() => {
      saveCurrentNote().then(() => showSaveStatus('saved'));
    }, 2000);
  };

  els.titleInput.addEventListener('input', onNoteInput);
  els.bodyInput.addEventListener('input', onNoteInput);

  els.btnDelete.addEventListener('click', deleteCurrentNote);
  
  els.btnPin.addEventListener('click', async () => {
    currentNote.pinned = !currentNote.pinned;
    els.btnPin.classList.toggle('pinned', currentNote.pinned);
    await updateNote(currentNote);
  });

  // Search
  els.searchInput.addEventListener('input', (e) => {
    renderNotes(e.target.value.toLowerCase());
  });

  // Reminder within Note Detail
  els.btnReminder.addEventListener('click', () => {
    els.reminderModal.classList.add('active');
    // Pre-fill if reminder exists
    if(currentNote.reminderAt) {
      const dt = new Date(currentNote.reminderAt);
      const iso = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      els.reminderDatetime.value = iso;
    } else {
      els.reminderDatetime.value = "";
    }
  });

  els.btnCancelReminderModal.addEventListener('click', () => {
    els.reminderModal.classList.remove('active');
  });

  els.btnSaveReminder.addEventListener('click', async () => {
    const dt = new Date(els.reminderDatetime.value).getTime();
    if(dt) {
      if(dt < Date.now()) {
          alert('Cannot set reminder in the past');
          return;
      }
      currentNote.reminderAt = dt;
      await saveCurrentNote();
      await scheduleReminder(currentNote.id, currentNote.title || 'Untitled Note', dt, 'note_reminder');
      showToast('Reminder scheduled');
    }
    els.reminderModal.classList.remove('active');
  });

  // Keyboard Shortcuts
  document.addEventListener('keydown', (e) => {
    if (els.noteDetailView.classList.contains('active')) {
      // Ctrl+S
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        clearTimeout(autoSaveTimer);
        saveCurrentNote().then(() => showSaveStatus('saved'));
      }
      // Escape
      if (e.key === 'Escape' && !els.reminderModal.classList.contains('active')) {
          els.btnBack.click();
      }
      // Ctrl+D
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
          e.preventDefault();
          deleteCurrentNote();
      }
    } else if(els.notesListView.classList.contains('active')) {
      // Ctrl+N
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
          e.preventDefault();
          openNoteDetail(null);
      }
      // Ctrl+F
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
          e.preventDefault();
          els.searchInput.focus();
      }
    }
  });
}

function getSortedNotes(notes, query = '') {
  let filtered = notes.filter(n => !n.deleted);
  
  if (query) {
    filtered = filtered.filter(n => 
      (n.title && n.title.toLowerCase().includes(query)) ||
      (n.body && n.body.toLowerCase().includes(query))
    );
  }

  return filtered.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.updatedAt - a.updatedAt;
  });
}

async function renderNotes(query = '') {
  const notes = await getNotes();
  const sorted = getSortedNotes(notes, query);
  
  els.notesList.innerHTML = '';
  
  if (sorted.length === 0) {
    els.notesList.innerHTML = `
      <div class="empty-state">
        <div style="font-size: 24px; margin-bottom: 8px;">📝</div>
        <div>${query ? 'No notes match your search.' : 'No notes yet. Create one!'}</div>
      </div>
    `;
    return;
  }

  sorted.forEach(note => {
    const el = document.createElement('div');
    el.className = 'note-card';
    el.innerHTML = `
      <div class="note-card-title">${note.pinned ? '📌 ' : ''}${note.title || 'Untitled note'}</div>
      <div class="note-card-body">${note.body ? note.body.substring(0, 100) : 'No content'}</div>
      <div class="note-card-meta">
        <span>${timeAgo(note.updatedAt)}</span>
        ${note.reminderAt ? '<span>🔔</span>' : ''}
      </div>
    `;
    el.addEventListener('click', () => openNoteDetail(note));
    els.notesList.appendChild(el);
  });
}

function openNoteDetail(note) {
  if (note) {
    currentNote = note;
  } else {
    currentNote = {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      title: '',
      body: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pinned: false,
      reminderAt: null,
      tags: [],
      deleted: false
    };
  }

  els.titleInput.value = currentNote.title;
  els.bodyInput.value = currentNote.body;
  els.btnPin.classList.toggle('pinned', currentNote.pinned);
  showSaveStatus('');
  
  els.notesListView.classList.remove('active');
  els.noteDetailView.classList.add('active');
  
  if(!note) els.bodyInput.focus();
}

function closeNoteDetail() {
  currentNote = null;
  els.noteDetailView.classList.remove('active');
  els.notesListView.classList.add('active');
  renderNotes(els.searchInput.value.toLowerCase());
}

async function saveCurrentNote() {
  if (!currentNote) return;
  
  // If blank without saving, ignore
  if(!currentNote.title && !currentNote.body && currentNote.createdAt === currentNote.updatedAt && !els.titleInput.value && !els.bodyInput.value) {
      return;
  }

  currentNote.title = els.titleInput.value;
  currentNote.body = els.bodyInput.value;
  currentNote.updatedAt = Date.now();
  await updateNote(currentNote);
}

async function deleteCurrentNote() {
  if (!currentNote) return;
  const noteToDelete = currentNote;
  
  // Soft delete
  noteToDelete.deleted = true;
  await updateNote(noteToDelete);
  
  // Remove alarm if exists
  if(noteToDelete.reminderAt) {
      await cancelReminder(noteToDelete.id, false);
  }
  
  closeNoteDetail();

  // Show undo toast
  let permanentlyDeleted = false;
  showToast('Note deleted', async () => {
    noteToDelete.deleted = false;
    permanentlyDeleted = true;
    await updateNote(noteToDelete);
    renderNotes(els.searchInput.value.toLowerCase());
  });

  // Permanently delete after 5s if not undone
  setTimeout(async () => {
    if (!permanentlyDeleted && noteToDelete.deleted) {
      await deleteNote(noteToDelete.id);
    }
  }, 5000);
}

// ==== REMINDERS / TASKS ====

function setupRemindersEvents() {
  els.btnNewTask.addEventListener('click', () => openTaskDetail(null));
  els.btnBackTask.addEventListener('click', closeTaskDetail);

  els.btnSaveTask.addEventListener('click', async () => {
    const title = els.taskTitleInput.value.trim();
    if(!title) {
        alert("Task must have a title.");
        return;
    }
    const dt = new Date(els.taskDatetime.value).getTime();
    if(!dt || dt < Date.now()) {
        alert("Please set a future date and time.");
        return;
    }

    if (!currentTask) {
        currentTask = {
            id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            type: "task"
        };
    }
    
    await scheduleReminder(
        currentTask.id,
        title,
        dt,
        'task',
        els.taskDescInput.value,
        els.taskRecurrence.value
    );

    showToast('Task reminder saved');
    closeTaskDetail();
  });
}

function openTaskDetail(task) {
    if (task) {
        currentTask = task;
        els.taskTitleInput.value = task.title;
        els.taskDescInput.value = task.description || '';
        
        const dt = new Date(task.scheduledAt);
        const iso = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        els.taskDatetime.value = iso;
        els.taskRecurrence.value = task.recurrence || 'none';
        
    } else {
        currentTask = null;
        els.taskTitleInput.value = '';
        els.taskDescInput.value = '';
        els.taskDatetime.value = '';
        els.taskRecurrence.value = 'none';
    }

    els.remindersListView.classList.remove('active');
    els.taskDetailView.classList.add('active');
}

function closeTaskDetail() {
    currentTask = null;
    els.taskDetailView.classList.remove('active');
    els.remindersListView.classList.add('active');
    renderReminders();
}

async function renderReminders() {
    const allRemindersObj = await getReminders();
    const allReminders = Object.values(allRemindersObj).sort((a,b) => a.scheduledAt - b.scheduledAt);

    els.remindersList.innerHTML = '';
  
    if (allReminders.length === 0) {
      els.remindersList.innerHTML = `
        <div class="empty-state">
          <div style="font-size: 24px; margin-bottom: 8px;">🔔</div>
          <div>No upcoming reminders.</div>
        </div>
      `;
      return;
    }

    allReminders.forEach(task => {
        const el = document.createElement('div');
        el.className = 'reminder-card';
        const dateStr = new Date(task.scheduledAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short'});
        const recurrenceStr = task.recurrence !== 'none' ? `🔄 ${task.recurrence}` : '';
        
        el.innerHTML = `
          <div class="reminder-card-title">🔔 ${task.title}</div>
          ${task.description ? `<div class="reminder-card-body">${task.description}</div>` : ''}
          <div class="reminder-card-meta">
            <span class="${task.active ? 'active-badge' : 'inactive-badge'}">${dateStr} ${recurrenceStr}</span>
            <div class="reminder-card-actions">
                <button title="Edit" class="btn-edit-task">✏️</button>
                <button title="Delete" class="btn-delete-task">🗑️</button>
            </div>
          </div>
        `;
        
        el.querySelector('.btn-edit-task').addEventListener('click', (e) => {
            e.stopPropagation();
            if(task.type === 'task') {
                openTaskDetail(task);
            } else {
                // It's a note reminder, just open the note
                getNotes().then(notes => {
                    const linkedNote = notes.find(n => n.id === task.id);
                    if(linkedNote) {
                        // Switch to notes tab
                        document.querySelector('[data-tab="notes"]').click();
                        openNoteDetail(linkedNote);
                    } else {
                        showToast("Original note not found.");
                    }
                });
            }
        });

        el.querySelector('.btn-delete-task').addEventListener('click', async (e) => {
            e.stopPropagation();
            if(confirm("Delete this reminder?")) {
                await cancelReminder(task.id, false);
                
                // If it's a note reminder, clear the note's reminderAt
                if(task.type === 'note_reminder') {
                    const notes = await getNotes();
                    const linkedNote = notes.find(n => n.id === task.id);
                    if(linkedNote) {
                       linkedNote.reminderAt = null;
                       await updateNote(linkedNote);
                    }
                }

                showToast("Reminder deleted");
                renderReminders();
            }
        });

        els.remindersList.appendChild(el);
    });
}

// ---- WINDOW UNLOAD ----
window.addEventListener('beforeunload', () => {
    if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
        if(currentNote) saveCurrentNote();
    }
});
