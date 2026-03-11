// DOM Elements
const qrCodeContainer = document.getElementById("qr-code");
const emptyMessage = document.getElementById("empty-message");
const textInput = document.getElementById("text-input");
const statusEl = document.getElementById("status");
const historyDropdown = document.getElementById("history-dropdown");
const showCopyToastCheckbox = document.getElementById("show-copy-toast");
const batchModeToggle = document.getElementById("batch-mode-toggle");
const batchPrevBtn = document.getElementById("batch-prev");
const batchNextBtn = document.getElementById("batch-next");
const batchCountEl = document.getElementById("batch-count");
const batchControls = document.getElementById("batch-controls");

let qrCodeInstance = null;

// Storage keys
const STORAGE_KEY = "clipboardHistory";       // string[] - history of items (newest at end)
const LAST_SEEN_KEY = "lastSeenClipboard";    // string - last selected/copied value (for dropdown state)
const SHOW_TOAST_KEY = "showCopyToast";       // boolean - show page toast when copying (content script)
const BATCH_MODE_KEY = "batchMode";           // boolean - toggle for batch mode
const BATCH_ITEMS_KEY = "batchItems";         // string[] - batch items (one per line)
const BATCH_INDEX_KEY = "batchIndex";         // number - current batch index
const HISTORY_LIMIT = 15;
const BATCH_LIMIT = 20;

// Shared utilities
const shared = globalThis.ClipboardQrShared;

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

function trimmedText(text) {
  return shared?.trimmedText?.(text) ?? (text ?? "").toString().trim();
}

function truncateLabel(text, maxLen = 60) {
  const t = trimmedText(text);
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

function coerceTextArray(value) {
  return shared?.coerceTextArray?.(value) ?? (Array.isArray(value) ? value.map(trimmedText).filter(Boolean) : []);
}

function parseBatchItems(raw) {
  const text = (raw ?? "").toString();
  const lines = text.split(/\r?\n/);
  const items = lines.map((line) => trimmedText(line)).filter(Boolean);
  return items.slice(0, BATCH_LIMIT);
}

function clampIndex(index, length) {
  if (!Number.isFinite(index)) return 0;
  if (length <= 0) return 0;
  if (index < 0) return 0;
  if (index >= length) return length - 1;
  return index;
}

// Update history array: dedupe and add to end, enforce limit
function updateHistoryArray(history, text) {
  const trimmed = trimmedText(text);
  if (!trimmed) return history;
  
  const filtered = history.filter(h => h !== trimmed);
  filtered.push(trimmed);
  
  if (filtered.length > HISTORY_LIMIT) {
    filtered.splice(0, filtered.length - HISTORY_LIMIT);
  }
  return filtered;
}

// Populate the history dropdown
function populateHistoryDropdown(history) {
  historyDropdown.innerHTML = '<option value="">Recent items…</option>';
  
  // Add history items in reverse order (newest first in dropdown)
  for (let i = history.length - 1; i >= 0; i--) {
    const item = history[i];
    const option = document.createElement("option");
    option.value = item;
    option.textContent = truncateLabel(item);
    historyDropdown.appendChild(option);
  }
}

// Generate or update QR code
function generateQRCode(text) {
  const normalized = trimmedText(text);
  if (!normalized) {
    if (qrCodeInstance) {
      try {
        qrCodeInstance.clear();
      } catch (e) {
        // Ignore errors when clearing
      }
      qrCodeInstance = null;
    }
    qrCodeContainer.innerHTML = "";
    qrCodeContainer.classList.add("hidden");
    emptyMessage.classList.remove("hidden");
    return;
  }

  qrCodeContainer.classList.remove("hidden");
  emptyMessage.classList.add("hidden");

  try {
    if (qrCodeInstance) {
      qrCodeInstance.makeCode(normalized);
    } else {
      qrCodeInstance = new QRCode(qrCodeContainer, {
        text: normalized,
        width: 150,
        height: 150,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M,
      });
    }
  } catch (error) {
    showStatus("Error generating QR code", "error");
    console.error("QR Code generation error:", error);
  }
}

// Show status message
function showStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = "status";
  if (type) {
    statusEl.classList.add(type);
  }
  setTimeout(() => {
    statusEl.textContent = "";
    statusEl.className = "status";
  }, 2000);
}

// Read from system clipboard (used when popup opens to pick up copies from anywhere)
async function readClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    return trimmedText(text);
  } catch (error) {
    console.error("Could not read clipboard:", error);
    return "";
  }
}

// Copy text to system clipboard
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error("Failed to copy to clipboard:", error);
    return false;
  }
}

// Debounce function with flush capability
function debounce(func, wait) {
  let timeout;
  let pendingArgs = null;

  function executedFunction(...args) {
    pendingArgs = args;
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      pendingArgs = null;
      func(...args);
    }, wait);
  }

  executedFunction.flush = function () {
    if (pendingArgs !== null) {
      clearTimeout(timeout);
      const args = pendingArgs;
      pendingArgs = null;
      func(...args);
    }
  };

  return executedFunction;
}

// ============================================================================
// CORE STATE MANAGEMENT
// ============================================================================

// Save state to storage (fire-and-forget for speed)
function saveState(history, lastSeen) {
  storageSet({
    [STORAGE_KEY]: history,
    [LAST_SEEN_KEY]: lastSeen,
  }).catch(err => console.error("Failed to save state:", err));
}

// Save just the history (when editing, we don't update lastSeen)
function saveHistoryOnly(history) {
  storageSet({ [STORAGE_KEY]: history }).catch(err => console.error("Failed to save history:", err));
}

function saveBatchState() {
  storageSet({
    [BATCH_MODE_KEY]: batchMode,
    [BATCH_ITEMS_KEY]: batchItems,
    [BATCH_INDEX_KEY]: batchIndex,
  }).catch(err => console.error("Failed to save batch state:", err));
}

function getActiveText() {
  if (batchMode) {
    return batchItems[batchIndex] ?? "";
  }
  return trimmedText(textInput.value);
}

function updateBatchControls() {
  if (!batchCountEl || !batchPrevBtn || !batchNextBtn || !batchControls || !historyDropdown) return;
  const count = batchItems.length;
  batchCountEl.textContent = count ? `${batchIndex + 1} / ${count}` : "0 / 0";
  const enabled = batchMode && count > 0;
  batchPrevBtn.disabled = !enabled || batchIndex <= 0;
  batchNextBtn.disabled = !enabled || batchIndex >= count - 1;
  batchControls.classList.toggle("hidden", !batchMode);
  historyDropdown.classList.toggle("hidden", batchMode);
}

// Current in-memory state
let currentHistory = [];
let lastSeenClipboard = "";
let batchMode = false;
let batchItems = [];
let batchIndex = 0;

// ============================================================================
// INITIALIZATION
// ============================================================================

async function loadInitialState() {
  const stored = await storageGet([
    STORAGE_KEY,
    LAST_SEEN_KEY,
    SHOW_TOAST_KEY,
    BATCH_MODE_KEY,
    BATCH_ITEMS_KEY,
    BATCH_INDEX_KEY,
  ]);
  currentHistory = coerceTextArray(stored?.[STORAGE_KEY]);
  lastSeenClipboard = trimmedText(stored?.[LAST_SEEN_KEY]);
  batchMode = stored?.[BATCH_MODE_KEY] === true;
  batchItems = coerceTextArray(stored?.[BATCH_ITEMS_KEY]).slice(0, BATCH_LIMIT);
  batchIndex = clampIndex(Number(stored?.[BATCH_INDEX_KEY]), batchItems.length);

  if (showCopyToastCheckbox) {
    showCopyToastCheckbox.checked = stored?.[SHOW_TOAST_KEY] === true;
  }
  if (batchModeToggle) {
    batchModeToggle.checked = batchMode;
  }

  populateHistoryDropdown(currentHistory);

  // When you copy from anywhere, we pick it up when you open the popup and add it to our history
  await new Promise((resolve) => setTimeout(resolve, 50));
  const clipboardContent = await readClipboard();

  let clipboardChanged = false;
  if (clipboardContent && clipboardContent !== lastSeenClipboard) {
    currentHistory = updateHistoryArray(currentHistory, clipboardContent);
    lastSeenClipboard = clipboardContent;
    saveState(currentHistory, lastSeenClipboard);
    populateHistoryDropdown(currentHistory);
    clipboardChanged = true;
  }

  if (batchMode) {
    textInput.value = batchItems.join("\n");
    updateBatchControls();
    generateQRCode(getActiveText());
    return;
  }

  updateBatchControls();

  if (clipboardChanged) {
    textInput.value = clipboardContent;
    generateQRCode(clipboardContent);
    showStatus("Loaded from clipboard", "success");
  } else {
    const mostRecent = currentHistory.length > 0 ? currentHistory[currentHistory.length - 1] : "";
    textInput.value = mostRecent;
    generateQRCode(mostRecent);
  }
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

// Debounced QR code update
const debouncedQRUpdate = debounce(() => {
  generateQRCode(getActiveText());
}, 300);

// Debounced history save (for text edits)
const debouncedHistorySave = debounce(() => {
  const trimmed = trimmedText(textInput.value);
  if (!trimmed) return;
  
  // Update history with edited text
  currentHistory = updateHistoryArray(currentHistory, trimmed);
  saveHistoryOnly(currentHistory);
  populateHistoryDropdown(currentHistory);
}, 400);

const debouncedBatchUpdate = debounce(() => {
  const rawLines = (textInput.value ?? "").toString().split(/\r?\n/);
  const normalized = rawLines.map((line) => trimmedText(line)).filter(Boolean);
  const truncated = normalized.length > BATCH_LIMIT;
  batchItems = normalized.slice(0, BATCH_LIMIT);
  batchIndex = clampIndex(batchIndex, batchItems.length);
  saveBatchState();
  updateBatchControls();
  generateQRCode(getActiveText());
  if (truncated) {
    showStatus(`Batch limited to ${BATCH_LIMIT} items`, "error");
  }
}, 350);

// Text input handler
textInput.addEventListener("input", () => {
  if (batchMode) {
    debouncedBatchUpdate();
    return;
  }
  debouncedQRUpdate();
  debouncedHistorySave();
});

// Paste handler
textInput.addEventListener("paste", () => {
  setTimeout(() => {
    if (batchMode) {
      debouncedBatchUpdate();
      return;
    }

    const trimmed = trimmedText(textInput.value);
    if (!trimmed) return;

    textInput.value = trimmed;
    currentHistory = updateHistoryArray(currentHistory, trimmed);
    saveHistoryOnly(currentHistory);
    populateHistoryDropdown(currentHistory);
    generateQRCode(trimmed);
  }, 0);
});

// Toast toggle – content script reads this to show/hide copy toast
if (showCopyToastCheckbox) {
  showCopyToastCheckbox.addEventListener("change", () => {
    storageSet({ [SHOW_TOAST_KEY]: showCopyToastCheckbox.checked }).catch((err) =>
      console.error("Failed to save toast preference", err)
    );
  });
}

if (batchModeToggle) {
  batchModeToggle.addEventListener("change", () => {
    const previousActive = getActiveText();
    batchMode = batchModeToggle.checked === true;

    if (batchMode) {
      if (batchItems.length === 0) {
        batchItems = parseBatchItems(textInput.value);
      }
      if (batchItems.length === 0 && previousActive) {
        batchItems = [previousActive];
      }
      batchIndex = clampIndex(batchIndex, batchItems.length);
      textInput.value = batchItems.join("\n");
    } else {
      textInput.value = previousActive;
    }

    saveBatchState();
    updateBatchControls();
    generateQRCode(getActiveText());
  });
}

if (batchPrevBtn) {
  batchPrevBtn.addEventListener("click", () => {
    if (!batchMode) return;
    if (batchIndex <= 0) return;
    batchIndex -= 1;
    saveBatchState();
    updateBatchControls();
    generateQRCode(getActiveText());
  });
}

if (batchNextBtn) {
  batchNextBtn.addEventListener("click", () => {
    if (!batchMode) return;
    if (batchIndex >= batchItems.length - 1) return;
    batchIndex += 1;
    saveBatchState();
    updateBatchControls();
    generateQRCode(getActiveText());
  });
}

// History dropdown handler – select a recent item (updates input, QR, and copies to clipboard)
historyDropdown.addEventListener("change", async () => {
  const val = historyDropdown.value;
  if (!val) return;

  // Update text input and QR code
  textInput.value = val;
  generateQRCode(val);
  if (batchMode) {
    batchItems = [val];
    batchIndex = 0;
    saveBatchState();
    updateBatchControls();
  }

  // Copy to clipboard - this makes the extension a clipboard manager!
  const copied = await copyToClipboard(val);
  
  // Update state: move to end of history and update lastSeen
  currentHistory = updateHistoryArray(currentHistory, val);
  lastSeenClipboard = val;
  saveState(currentHistory, lastSeenClipboard);
  populateHistoryDropdown(currentHistory);

  // Reset dropdown to placeholder
  historyDropdown.selectedIndex = 0;

  if (copied) {
    showStatus("Copied to clipboard!", "success");
  } else {
    showStatus("Loaded from history", "success");
  }
});

// Flush pending saves on popup close
function flushPendingSaves() {
  debouncedHistorySave.flush();
  debouncedBatchUpdate.flush();
}

window.addEventListener("pagehide", flushPendingSaves);
window.addEventListener("beforeunload", flushPendingSaves);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    flushPendingSaves();
  }
});

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  loadInitialState();
});
