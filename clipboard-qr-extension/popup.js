// DOM Elements
const qrCodeContainer = document.getElementById("qr-code");
const emptyMessage = document.getElementById("empty-message");
const textInput = document.getElementById("text-input");
const statusEl = document.getElementById("status");
const historyDropdown = document.getElementById("history-dropdown");

let qrCodeInstance = null;

// Storage keys - simplified to just two
const STORAGE_KEY = "clipboardHistory";       // string[] - history of items (newest at end)
const LAST_SEEN_KEY = "lastSeenClipboard";    // string - clipboard content when we last read it
const HISTORY_LIMIT = 10;

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

// Read from system clipboard
async function readClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    return trimmedText(text);
  } catch (error) {
    console.error("Could not read clipboard:", error);
    return "";
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

// Current in-memory state
let currentHistory = [];
let lastSeenClipboard = "";

// ============================================================================
// INITIALIZATION
// ============================================================================

async function loadInitialState() {
  // Load stored state
  const stored = await storageGet([STORAGE_KEY, LAST_SEEN_KEY]);
  currentHistory = coerceTextArray(stored?.[STORAGE_KEY]);
  lastSeenClipboard = trimmedText(stored?.[LAST_SEEN_KEY]);

  // Populate dropdown
  populateHistoryDropdown(currentHistory);

  // Small delay for clipboard API
  await new Promise(resolve => setTimeout(resolve, 50));

  // Read current clipboard
  const clipboardContent = await readClipboard();

  // Determine what to display
  if (clipboardContent && clipboardContent !== lastSeenClipboard) {
    // NEW clipboard content detected - user copied something new
    currentHistory = updateHistoryArray(currentHistory, clipboardContent);
    lastSeenClipboard = clipboardContent;
    
    // Save state and update UI
    saveState(currentHistory, lastSeenClipboard);
    populateHistoryDropdown(currentHistory);
    
    textInput.value = clipboardContent;
    generateQRCode(clipboardContent);
    showStatus("Loaded from clipboard", "success");
  } else {
    // Clipboard unchanged (or empty/failed) - show most recent history item
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
  generateQRCode(textInput.value);
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

// Text input handler
textInput.addEventListener("input", () => {
  debouncedQRUpdate();
  debouncedHistorySave();
});

// Paste handler
textInput.addEventListener("paste", () => {
  setTimeout(() => {
    const trimmed = trimmedText(textInput.value);
    if (!trimmed) return;
    
    textInput.value = trimmed;
    currentHistory = updateHistoryArray(currentHistory, trimmed);
    saveHistoryOnly(currentHistory);
    populateHistoryDropdown(currentHistory);
    generateQRCode(trimmed);
  }, 0);
});

// History dropdown handler - NOW COPIES TO CLIPBOARD
historyDropdown.addEventListener("change", async () => {
  const val = historyDropdown.value;
  if (!val) return;

  // Update text input and QR code
  textInput.value = val;
  generateQRCode(val);

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
