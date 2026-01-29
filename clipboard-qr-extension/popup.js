// DOM Elements
const qrCodeContainer = document.getElementById('qr-code');
const emptyMessage = document.getElementById('empty-message');
const textInput = document.getElementById('text-input');
const statusEl = document.getElementById('status');
const historySelect = document.getElementById('history-select');

let qrCodeInstance = null;

// Simplified storage - only track history array
const STORAGE_KEYS = {
  history: 'clipboardHistory'
};

const HISTORY_LIMIT = 10;
const HISTORY_SELECT_LIMIT = 10;

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(obj) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(obj, () => {
      const err = chrome.runtime?.lastError;
      if (err) reject(err);
      else resolve();
    });
  });
}

function normalizeText(text) {
  return (text ?? '').toString().trim();
}

function truncateLabel(text, maxLen = 60) {
  const t = normalizeText(text);
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

function isQuotaError(err) {
  const msg = (err?.message ?? '').toString();
  return /quota/i.test(msg);
}

function coerceTextArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeText).filter(Boolean);
}

/**
 * Get the history queue from storage.
 * History is stored as FIFO: oldest first, newest last.
 * The last item is always the current/active item.
 */
async function getHistoryQueue() {
  const saved = await storageGet([STORAGE_KEYS.history]);
  return coerceTextArray(saved?.[STORAGE_KEYS.history]);
}

/**
 * Get the current (most recent) item from history.
 * Returns empty string if history is empty.
 */
function getCurrentFromHistory(queue) {
  if (!queue || queue.length === 0) return '';
  return queue[queue.length - 1];
}

/**
 * Populate the history dropdown.
 * Display is reversed (newest first) for user convenience.
 */
function populateHistorySelect(queue) {
  const currentValue = historySelect.value;

  historySelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Recent items…';
  historySelect.appendChild(placeholder);

  // Show most-recent first in dropdown (reversed from storage order)
  const displayItems = queue.slice(-HISTORY_SELECT_LIMIT).reverse();
  displayItems.forEach((item) => {
    const opt = document.createElement('option');
    opt.value = item;
    opt.textContent = truncateLabel(item);
    historySelect.appendChild(opt);
  });

  // Keep selection if still present
  if (currentValue && queue.includes(currentValue)) {
    historySelect.value = currentValue;
  } else {
    historySelect.value = '';
  }
}

/**
 * Push an item to the history queue.
 * - If item already exists, it's moved to the end (newest position)
 * - If max limit reached, oldest item is shifted out
 * - Returns the updated queue
 */
async function pushToHistory(text) {
  const trimmed = normalizeText(text);
  if (!trimmed) return await getHistoryQueue();

  const existingQueue = await getHistoryQueue();

  // Remove if exists (to re-add at end), then push to end
  let nextQueue = existingQueue.filter((h) => h !== trimmed);
  nextQueue.push(trimmed);

  // Enforce limit by shifting oldest items
  if (nextQueue.length > HISTORY_LIMIT) {
    nextQueue = nextQueue.slice(nextQueue.length - HISTORY_LIMIT);
  }

  let didEvictForQuota = false;
  while (true) {
    try {
      await storageSet({
        [STORAGE_KEYS.history]: nextQueue
      });
      break;
    } catch (err) {
      if (isQuotaError(err) && nextQueue.length > 1) {
        // Storage full: shift oldest items until it fits
        nextQueue = nextQueue.slice(1);
        didEvictForQuota = true;
        continue;
      }

      console.error('Failed saving history:', err);
      showStatus('Could not save to history (storage full?)', 'error');
      return existingQueue;
    }
  }

  populateHistorySelect(nextQueue);
  if (didEvictForQuota) {
    showStatus('Storage full: dropped oldest history item(s)', '');
  }

  return nextQueue;
}

/**
 * Generate QR code for the given text.
 */
function generateQRCode(text) {
  const normalized = normalizeText(text);
  qrCodeContainer.innerHTML = '';

  if (!normalized) {
    qrCodeContainer.classList.add('hidden');
    emptyMessage.classList.remove('hidden');
    return;
  }

  qrCodeContainer.classList.remove('hidden');
  emptyMessage.classList.add('hidden');

  try {
    qrCodeInstance = new QRCode(qrCodeContainer, {
      text: normalized,
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

/**
 * Show status message with optional type (success/error).
 */
function showStatus(message, type = '') {
  statusEl.textContent = message;
  statusEl.className = 'status';
  if (type) {
    statusEl.classList.add(type);
  }

  setTimeout(() => {
    statusEl.textContent = '';
    statusEl.className = 'status';
  }, 2000);
}

/**
 * Set the text input value and generate QR code.
 */
function setTextAndGenerate(text) {
  const normalized = normalizeText(text);
  textInput.value = normalized;
  generateQRCode(normalized);
}

/**
 * Push text to history and generate QR from the last item.
 * This is the core function - QR always reflects the last item in history.
 */
async function pushAndGenerateQR(text, statusMessage = '') {
  const queue = await pushToHistory(text);
  const current = getCurrentFromHistory(queue);
  setTextAndGenerate(current);
  if (statusMessage) {
    showStatus(statusMessage, 'success');
  }
  return queue;
}

/**
 * Read from clipboard and push to history.
 * QR is generated from the new last item in history.
 */
async function readClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      const normalized = normalizeText(text);
      await pushAndGenerateQR(normalized, 'Loaded from clipboard');
    } else {
      showStatus('Clipboard is empty', '');
    }
  } catch (error) {
    console.log('Could not read clipboard:', error);
    showStatus('Click in the text area to paste', '');
  }
}

/**
 * Load and display the last saved state.
 * QR is generated from the last item in history.
 */
async function loadFromHistory() {
  const queue = await getHistoryQueue();
  populateHistorySelect(queue);

  const current = getCurrentFromHistory(queue);
  if (current) {
    setTextAndGenerate(current);
    showStatus('Loaded last text', 'success');
  }
}

// Debounce function to avoid too many operations
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

// Handle text input changes - generate QR immediately
function handleInputChange() {
  const text = textInput.value;
  generateQRCode(text);
}

// Debounced handlers
const debouncedInputChange = debounce(handleInputChange, 300);

// Save to history after user stops typing
const debouncedSaveToHistory = debounce(async () => {
  const normalized = normalizeText(textInput.value);
  if (normalized) {
    await pushToHistory(normalized);
  }
}, 600);

// Event listeners

// Text input: generate QR on each change, save to history after delay
textInput.addEventListener('input', () => {
  debouncedInputChange();
  debouncedSaveToHistory();
});

// Paste: immediately process and save
textInput.addEventListener('paste', () => {
  setTimeout(async () => {
    const normalized = normalizeText(textInput.value);
    if (normalized) {
      await pushAndGenerateQR(normalized);
    }
  }, 0);
});

// History dropdown: selecting an item moves it to the end and generates QR
historySelect.addEventListener('change', async () => {
  const val = historySelect.value;
  if (!val) return;

  // Push selected item to history (moves it to end) and generate QR
  await pushAndGenerateQR(val, 'Loaded from history');

  // Reset dropdown to placeholder after selection
  historySelect.value = '';
});

// On popup open: load from history, then try to read clipboard
document.addEventListener('DOMContentLoaded', () => {
  loadFromHistory().finally(() => {
    // Try to read clipboard - if successful, it will push to history
    // and update the QR to the new clipboard content
    readClipboard();
  });
});
