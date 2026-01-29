// DOM Elements
const qrCodeContainer = document.getElementById('qr-code');
const emptyMessage = document.getElementById('empty-message');
const textInput = document.getElementById('text-input');
const statusEl = document.getElementById('status');
const historySelect = document.getElementById('history-select');
const refreshBtn = document.getElementById('refresh-btn');

let qrCodeInstance = null;

const STORAGE_KEYS = {
  history: 'clipboardHistory',
  lastText: 'lastText'
};

const HISTORY_LIMIT = 10;
const HISTORY_SELECT_LIMIT = 10;

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

function normalizeText(text) {
  return (text ?? '').toString().trim();
}

function truncateLabel(text, maxLen = 60) {
  const t = normalizeText(text);
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

function populateHistorySelect(history) {
  const items = Array.isArray(history) ? history : [];
  const currentValue = historySelect.value;

  historySelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Recent items…';
  historySelect.appendChild(placeholder);

  items.slice(0, HISTORY_SELECT_LIMIT).forEach((item) => {
    const opt = document.createElement('option');
    opt.value = item;
    opt.textContent = truncateLabel(item);
    historySelect.appendChild(opt);
  });

  // Keep selection if still present.
  if (currentValue && items.includes(currentValue)) {
    historySelect.value = currentValue;
  } else {
    historySelect.value = '';
  }
}

async function saveToHistory(text) {
  const trimmed = normalizeText(text);
  if (!trimmed) return;

  const existing = await storageGet([STORAGE_KEYS.history]);
  const history = Array.isArray(existing[STORAGE_KEYS.history])
    ? existing[STORAGE_KEYS.history]
    : [];

  const deduped = [trimmed, ...history.filter((h) => h !== trimmed)].slice(0, HISTORY_LIMIT);
  await storageSet({
    [STORAGE_KEYS.lastText]: trimmed,
    [STORAGE_KEYS.history]: deduped
  });

  populateHistorySelect(deduped);
}

// Generate or update QR code
function generateQRCode(text) {
  // Clear existing QR code
  qrCodeContainer.innerHTML = '';
  
  if (!text || text.trim() === '') {
    qrCodeContainer.classList.add('hidden');
    emptyMessage.classList.remove('hidden');
    return;
  }
  
  qrCodeContainer.classList.remove('hidden');
  emptyMessage.classList.add('hidden');
  
  try {
    qrCodeInstance = new QRCode(qrCodeContainer, {
      text: text,
      width: 150,
      height: 150,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
    showStatus('QR code generated', 'success');
  } catch (error) {
    showStatus('Error generating QR code', 'error');
    console.error('QR Code generation error:', error);
  }
}

// Show status message
function showStatus(message, type = '') {
  statusEl.textContent = message;
  statusEl.className = 'status';
  if (type) {
    statusEl.classList.add(type);
  }
  
  // Clear status after 2 seconds
  setTimeout(() => {
    statusEl.textContent = '';
    statusEl.className = 'status';
  }, 2000);
}

// Read from clipboard
async function readClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      textInput.value = text;
      generateQRCode(text);
      await saveToHistory(text);
      showStatus('Loaded from clipboard', 'success');
    } else {
      showStatus('Clipboard is empty', '');
    }
  } catch (error) {
    // Clipboard access may be denied
    console.log('Could not read clipboard:', error);
    showStatus('Click in the text area to paste', '');
  }
}

async function loadLastSavedText() {
  const saved = await storageGet([STORAGE_KEYS.lastText, STORAGE_KEYS.history]);
  const lastText = saved[STORAGE_KEYS.lastText];
  const history = saved[STORAGE_KEYS.history];

  populateHistorySelect(history);

  const trimmed = normalizeText(lastText);
  if (trimmed) {
    textInput.value = trimmed;
    generateQRCode(trimmed);
    showStatus('Loaded last item', 'success');
  }
}

// Handle text input changes
function handleInputChange() {
  const text = textInput.value;
  generateQRCode(text);
}

// Debounce function to avoid too many QR code generations
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Debounced input handler
const debouncedInputChange = debounce(handleInputChange, 300);
const debouncedSave = debounce(() => saveToHistory(textInput.value), 600);

// Event listeners
textInput.addEventListener('input', () => {
  debouncedInputChange();
  debouncedSave();
});

textInput.addEventListener('paste', () => {
  // Wait for paste to apply to textarea value.
  setTimeout(() => {
    generateQRCode(textInput.value);
    saveToHistory(textInput.value);
  }, 0);
});

historySelect.addEventListener('change', () => {
  const val = historySelect.value;
  if (!val) return;
  textInput.value = val;
  generateQRCode(val);
  saveToHistory(val);
  showStatus('Loaded from history', 'success');
});

refreshBtn.addEventListener('click', () => {
  readClipboard();
});

// Try to read clipboard when popup opens
document.addEventListener('DOMContentLoaded', () => {
  loadLastSavedText().finally(() => {
    // Best-effort attempt; Chrome may block without user gesture.
    readClipboard();
  });
});
