// content/toolbar.js

const SANS_BOLD = { upperBase: 0x1D5D4, lowerBase: 0x1D5EE, digitBase: 0x1D7EC };
const SANS_ITALIC = { upperBase: 0x1D608, lowerBase: 0x1D622 };

const DEFAULT_EMOJIS = "⚡,⭐,🔥,🚀,💡,📌,❗,✅,❌,🛠️,💻,📈";
let currentEmojis = DEFAULT_EMOJIS.split(',').map(e => e.trim());

let activeTextarea = null;
let toolbarElement = null;

async function initToolbar() {
    if (document.getElementById('upwork-fmt-toolbar')) return;

    toolbarElement = document.createElement('div');
    toolbarElement.id = 'upwork-fmt-toolbar';
    toolbarElement.className = 'upk-toolbar';
    toolbarElement.style.display = 'none';

    // Toolbar HTML
    toolbarElement.innerHTML = `
        <div class="upk-tb-buttons">
            <button class="upk-tb-btn" id="upk-btn-bold" title="Bold (Unicode)"><b>B</b></button>
            <button class="upk-tb-btn" id="upk-btn-italic" title="Italic (Unicode)"><i>I</i></button>
            <div class="upk-tb-divider"></div>
            <button class="upk-tb-btn" id="upk-btn-emoji" title="Emojis">😊</button>
            <div class="upk-tb-divider"></div>
            <button class="upk-tb-btn upk-tb-close" id="upk-btn-close" title="Close Toolbar">✖</button>
        </div>
        <div class="upk-emoji-picker" id="upk-emoji-picker" style="display: none;">
        </div>
    `;

    document.body.appendChild(toolbarElement);

    // Initial load of emojis
    const data = await chrome.storage.local.get('userPreferences');
    if (data.userPreferences && data.userPreferences.customEmojis) {
        currentEmojis = data.userPreferences.customEmojis.split(',').map(e => e.trim());
    }
    renderEmojis(currentEmojis);

    // Event Listeners for Toolbar
    document.getElementById('upk-btn-bold').addEventListener('click', (e) => {
        e.preventDefault();
        applyFormatting('bold');
    });

    document.getElementById('upk-btn-italic').addEventListener('click', (e) => {
        e.preventDefault();
        applyFormatting('italic');
    });

    document.getElementById('upk-btn-emoji').addEventListener('click', (e) => {
        e.preventDefault();
        const picker = document.getElementById('upk-emoji-picker');
        picker.style.display = picker.style.display === 'none' ? 'grid' : 'none';
    });

    document.getElementById('upk-btn-close').addEventListener('click', (e) => {
        e.preventDefault();
        hideToolbar();
    });

    // Emoji clicks are now handled in renderEmojis

    // Listen for textarea focus globally
    document.addEventListener('focusin', handleFocus);
}

function handleFocus(e) {
    if (e.target && e.target.tagName === 'TEXTAREA') {
        activeTextarea = e.target;
        showToolbar(activeTextarea);
    }
}

function showToolbar(textarea) {
    if (!toolbarElement) return;
    
    // Position the toolbar just above the textarea
    const rect = textarea.getBoundingClientRect();
    
    // Check if there is space above, else put below
    let topPos = rect.top + window.scrollY - 45;
    if (topPos < window.scrollY) {
        topPos = rect.bottom + window.scrollY + 5;
    }

    toolbarElement.style.top = `${topPos}px`;
    toolbarElement.style.left = `${rect.left + window.scrollX + 5}px`;
    toolbarElement.style.display = 'block';
    document.getElementById('upk-emoji-picker').style.display = 'none'; // hide picker initially
}

function hideToolbar() {
    if (toolbarElement) {
        toolbarElement.style.display = 'none';
        activeTextarea = null;
    }
}

function toUnicodeMath(text, type) {
    const config = type === 'bold' ? SANS_BOLD : SANS_ITALIC;
    return text.split('').map(char => {
        const code = char.charCodeAt(0);
        if (code >= 65 && code <= 90) { // A-Z
            return String.fromCodePoint(config.upperBase + (code - 65));
        } else if (code >= 97 && code <= 122) { // a-z
            return String.fromCodePoint(config.lowerBase + (code - 97));
        } else if (type === 'bold' && code >= 48 && code <= 57) { // 0-9
            return String.fromCodePoint(config.digitBase + (code - 48));
        }
        return char;
    }).join('');
}

function applyFormatting(type) {
    if (!activeTextarea) return;

    const start = activeTextarea.selectionStart;
    const end = activeTextarea.selectionEnd;
    
    if (start === end) {
        // No text selected
        return;
    }

    const text = activeTextarea.value;
    const selectedText = text.substring(start, end);
    const convertedText = toUnicodeMath(selectedText, type);

    const newText = text.substring(0, start) + convertedText + text.substring(end);
    
    // Update value and maintain focus/selection
    activeTextarea.value = newText;
    activeTextarea.focus();
    activeTextarea.setSelectionRange(start, start + convertedText.length);
    
    // Dispatch input event to trigger React/Angular bindings on Upwork
    activeTextarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function insertTextAtCursor(insertText) {
    if (!activeTextarea) return;

    const start = activeTextarea.selectionStart;
    const end = activeTextarea.selectionEnd;
    const text = activeTextarea.value;

    const newText = text.substring(0, start) + insertText + text.substring(end);
    
    activeTextarea.value = newText;
    activeTextarea.focus();
    activeTextarea.setSelectionRange(start + insertText.length, start + insertText.length);
    
    // Dispatch input event
    activeTextarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function renderEmojis(emojiArray) {
    const picker = document.getElementById('upk-emoji-picker');
    if (!picker) return;
    
    picker.innerHTML = emojiArray.map(e => `<span class="upk-emoji-item">${e}</span>`).join('');
    
    // Bind emoji clicks
    document.querySelectorAll('.upk-emoji-item').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            insertTextAtCursor(e.target.textContent);
            document.getElementById('upk-emoji-picker').style.display = 'none';
        });
    });
}

// Add storage listener for live updates
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.userPreferences) {
        const newPrefs = changes.userPreferences.newValue;
        if (newPrefs && newPrefs.customEmojis) {
            currentEmojis = newPrefs.customEmojis.split(',').map(e => e.trim());
            renderEmojis(currentEmojis);
        }
    }
});

// Initialize when ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initToolbar);
} else {
    initToolbar();
}
