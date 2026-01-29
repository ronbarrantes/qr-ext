// DOM Elements
const qrCodeContainer = document.getElementById('qr-code');
const emptyMessage = document.getElementById('empty-message');
const textInput = document.getElementById('text-input');
const statusEl = document.getElementById('status');
const historySelect = document.getElementById('history-select');

let qrCodeInstance = null;

const STORAGE_KEYS = {
  history: 'clipboardHistory',
  // Legacy key (older versions): used as a best-effort fallback/migration source.
  lastText: 'lastText',
  // New keys:
  lastClipboardText: 'lastClipboardText',
  lastUserText: 'lastUserText',
  userEdited: 'userEdited'
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

function coerceHistoryQueue(saved) {
  const lastText =
    normalizeText(saved?.[STORAGE_KEYS.lastClipboardText]) ||
    normalizeText(saved?.[STORAGE_KEYS.lastText]) ||
    normalizeText(saved?.[STORAGE_KEYS.lastUserText]);
  const historyRaw = coerceTextArray(saved?.[STORAGE_KEYS.history]);

  // Migration: older versions stored history as "newest-first" (history[0] === lastText).
  // New format is a FIFO queue: oldest-first (history[0] is the oldest).
  const looksLikeLegacyNewestFirst =
    historyRaw.length > 1 && lastText && historyRaw[0] === lastText;
  const queue = looksLikeLegacyNewestFirst ? historyRaw.slice().reverse() : historyRaw;

  return { queue, lastText, migrated: looksLikeLegacyNewestFirst };
}

function populateHistorySelect(history) {
  const queue = coerceTextArray(history);
  const currentValue = historySelect.value;

  historySelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Recent items…';
  historySelect.appendChild(placeholder);

  // Show most-recent first, even though storage is a FIFO queue (oldest-first).
  const displayItems = queue.slice(-HISTORY_SELECT_LIMIT).reverse();
  displayItems.forEach((item) => {
    const opt = document.createElement('option');
    opt.value = item;
    opt.textContent = truncateLabel(item);
    historySelect.appendChild(opt);
  });

  // Keep selection if still present.
  if (currentValue && queue.includes(currentValue)) {
    historySelect.value = currentValue;
  } else {
    historySelect.value = '';
  }
}

async function saveToHistory(text) {
  const trimmed = normalizeText(text);
  if (!trimmed) return;

  const existing = await storageGet([STORAGE_KEYS.history, STORAGE_KEYS.lastText]);
  const { queue: existingQueue } = coerceHistoryQueue(existing);

  // FIFO queue with uniqueness: re-adding an item moves it to the back (newest).
  let nextQueue = existingQueue.filter((h) => h !== trimmed);
  nextQueue.push(trimmed);
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
        // Storage is "full": dequeue the oldest item(s) until it fits.
        nextQueue = nextQueue.slice(1);
        didEvictForQuota = true;
        continue;
      }

      console.error('Failed saving history:', err);
      showStatus('Could not save to history (storage full?)', 'error');
      return;
    }
  }

  populateHistorySelect(nextQueue);
  if (didEvictForQuota) {
    showStatus('Storage full: dropped oldest history item(s)', '');
  }
}

async function saveLastState({ lastClipboardText, lastUserText, userEdited }) {
  const update = {};
  if (typeof lastClipboardText === 'string') update[STORAGE_KEYS.lastClipboardText] = lastClipboardText;
  if (typeof lastUserText === 'string') update[STORAGE_KEYS.lastUserText] = lastUserText;
  if (typeof userEdited === 'boolean') update[STORAGE_KEYS.userEdited] = userEdited;

  // Keep legacy `lastText` around as a best-effort migration/fallback source.
  const legacyCandidate =
    typeof lastClipboardText === 'string'
      ? lastClipboardText
      : typeof lastUserText === 'string'
        ? lastUserText
        : undefined;
  if (typeof legacyCandidate === 'string') update[STORAGE_KEYS.lastText] = legacyCandidate;

  try {
    await storageSet(update);
  } catch (err) {
    console.error('Failed saving last state:', err);
  }
}

// Generate or update QR code
function generateQRCode(text) {
  const normalized = normalizeText(text);
  // Clear existing QR code
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

function setTextAndGenerate(text) {
  const normalized = normalizeText(text);
  textInput.value = normalized;
  generateQRCode(normalized);
}

// Read from clipboard
async function readClipboard({ applyToUI } = { applyToUI: true }) {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      const normalized = normalizeText(text);
      if (applyToUI) {
        setTextAndGenerate(normalized);
        await saveLastState({ lastClipboardText: normalized, lastUserText: normalized, userEdited: false });
      } else {
        await saveLastState({ lastClipboardText: normalized });
      }
      await saveToHistory(normalized);
      if (applyToUI) showStatus('Loaded from clipboard', 'success');
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
  const saved = await storageGet([
    STORAGE_KEYS.lastText,
    STORAGE_KEYS.lastClipboardText,
    STORAGE_KEYS.lastUserText,
    STORAGE_KEYS.userEdited,
    STORAGE_KEYS.history
  ]);
  const { queue, lastText, migrated } = coerceHistoryQueue(saved);

  populateHistorySelect(queue);
  if (migrated) {
    // Best-effort: persist migrated FIFO order.
    storageSet({ [STORAGE_KEYS.history]: queue }).catch(() => {});
  }

  const userEdited = Boolean(saved?.[STORAGE_KEYS.userEdited]);
  const lastClipboardText =
    normalizeText(saved?.[STORAGE_KEYS.lastClipboardText]) || normalizeText(lastText);
  const lastUserText =
    normalizeText(saved?.[STORAGE_KEYS.lastUserText]) || normalizeText(saved?.[STORAGE_KEYS.lastText]);

  // If the user previously changed the text (typed or chose a history item), preserve that.
  // Otherwise default to clipboard-derived content (best-effort fallback to last known clipboard).
  if (userEdited && lastUserText) {
    setTextAndGenerate(lastUserText);
    showStatus('Loaded last text', 'success');
  } else if (lastClipboardText) {
    setTextAndGenerate(lastClipboardText);
    // Keep stored state consistent even if this is coming from legacy values.
    saveLastState({ lastClipboardText, lastUserText: lastClipboardText, userEdited: false }).catch(() => {});
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
const debouncedSave = debounce(() => {
  const normalized = normalizeText(textInput.value);
  saveToHistory(normalized);
  saveLastState({ lastUserText: normalized, userEdited: true });
}, 600);

// Event listeners
textInput.addEventListener('input', () => {
  debouncedInputChange();
  debouncedSave();
});

textInput.addEventListener('paste', () => {
  // Wait for paste to apply to textarea value.
  setTimeout(() => {
    const normalized = normalizeText(textInput.value);
    textInput.value = normalized;
    generateQRCode(normalized);
    saveToHistory(normalized);
    saveLastState({ lastUserText: normalized, userEdited: true });
  }, 0);
});

historySelect.addEventListener('change', () => {
  const val = historySelect.value;
  if (!val) return;
  setTextAndGenerate(val);
  saveToHistory(val);
  saveLastState({ lastUserText: normalizeText(val), userEdited: true });
  showStatus('Loaded from history', 'success');
});

// Try to read clipboard when popup opens
document.addEventListener('DOMContentLoaded', () => {
  loadLastSavedText().finally(async () => {
    const saved = await storageGet([STORAGE_KEYS.userEdited]);
    const userEdited = Boolean(saved?.[STORAGE_KEYS.userEdited]);
    // Best-effort attempt; Chrome may block without user gesture.
    // Only apply clipboard to the UI if the user hasn't changed the last text.
    readClipboard({ applyToUI: !userEdited });
  });
});
