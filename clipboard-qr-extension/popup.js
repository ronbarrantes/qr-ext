// DOM Elements
const qrCodeContainer = document.getElementById("qr-code");
const emptyMessage = document.getElementById("empty-message");
const textInput = document.getElementById("text-input");
const statusEl = document.getElementById("status");
const historyDropdown = document.getElementById("history-dropdown");

let qrCodeInstance = null;

const STORAGE_KEY = "clipboardHistory";
const CURRENT_TEXT_KEY = "currentText";
const LAST_CLIPBOARD_KEY = "lastClipboard";
const HISTORY_LIMIT = 10;
const shared = globalThis.ClipboardQrShared;
const enqueueHistoryWrite = shared?.createSerialQueue?.() ?? ((fn) => Promise.resolve().then(fn));

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

// Get the current history array from storage
async function getHistory() {
  const saved = await storageGet([STORAGE_KEY]);
  return coerceTextArray(saved?.[STORAGE_KEY]);
}

// Save history to storage, enforcing HISTORY_LIMIT
async function setHistory(history) {
  const queue = coerceTextArray(history);

  // If length exceeds limit, splice from beginning
  if (queue.length > HISTORY_LIMIT) {
    queue.splice(0, queue.length - HISTORY_LIMIT);
  }

  await storageSet({ [STORAGE_KEY]: queue });
  return queue;
}

// Add an item to history (trimmed, removes duplicates, moves to end)
async function addToHistory(text) {
  const trimmed = trimmedText(text);
  if (!trimmed) return;

  // Serialize read-modify-write to avoid losing intermediate updates.
  await enqueueHistoryWrite(async () => {
    const history = await getHistory();
    const updatedArr =
      shared?.updateHistory?.(history, trimmed, HISTORY_LIMIT) ??
      (() => {
        const filtered = history.filter((h) => h !== trimmed);
        filtered.push(trimmed);
        if (filtered.length > HISTORY_LIMIT) {
          filtered.splice(0, filtered.length - HISTORY_LIMIT);
        }
        return filtered;
      })();
    const updated = await setHistory(updatedArr);
    populateHistoryDropdown(updated);
  });
}

// Move an item from its current position to the end of history
async function moveToEnd(text) {
  const trimmed = trimmedText(text);
  if (!trimmed) return;

  await enqueueHistoryWrite(async () => {
    const history = await getHistory();
    const index = history.indexOf(trimmed);

    // If not found, just add it
    if (index === -1) {
      const updated = await setHistory(
        shared?.updateHistory?.(history, trimmed, HISTORY_LIMIT) ??
          (() => {
            const filtered = history.filter((h) => h !== trimmed);
            filtered.push(trimmed);
            if (filtered.length > HISTORY_LIMIT) {
              filtered.splice(0, filtered.length - HISTORY_LIMIT);
            }
            return filtered;
          })()
      );
      populateHistoryDropdown(updated);
      return;
    }

    // Remove from current position and push to end
    history.splice(index, 1);
    history.push(trimmed);

    // Save and update dropdown
    const updated = await setHistory(history);
    populateHistoryDropdown(updated);
  });
}

// Populate the history dropdown
function populateHistoryDropdown(history) {
  // Clear existing options except the first one
  historyDropdown.innerHTML = '<option value="">Recent items…</option>';

  // Add history items in reverse order (newest first)
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
    // Clear existing QR code
    if (qrCodeInstance) {
      qrCodeInstance.clear();
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
    // Reuse existing instance if available, otherwise create a new one
    if (qrCodeInstance) {
      // Update the QR code with new text
      qrCodeInstance.makeCode(normalized);
    } else {
      // Create a new QRCode instance
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

  // Clear status after 2 seconds
  setTimeout(() => {
    statusEl.textContent = "";
    statusEl.className = "status";
  }, 2000);
}

// Handle text input changes - ONLY generates QR code
function handleInputChange() {
  generateQRCode(textInput.value);
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

// Debounced handler for saving to history (trims text once after typing)
const debouncedInputChange = debounce(handleInputChange, 300);
const debouncedSave = debounce(async () => {
  const trimmed = trimmedText(textInput.value);
  if (!trimmed) return;

  // Save both to history and as current text
  await addToHistory(trimmed);
  await storageSet({ [CURRENT_TEXT_KEY]: trimmed });
}, 600);

// Load initial state
async function loadInitialState() {
  // Load all stored state
  const stored = await storageGet([STORAGE_KEY, CURRENT_TEXT_KEY, LAST_CLIPBOARD_KEY]);
  const history = coerceTextArray(stored?.[STORAGE_KEY]);
  const currentText = trimmedText(stored?.[CURRENT_TEXT_KEY]);
  const lastClipboard = trimmedText(stored?.[LAST_CLIPBOARD_KEY]);

  // Populate dropdown with existing history
  populateHistoryDropdown(history);

  // Small delay to ensure clipboard API is ready
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Try to read clipboard
  let newClipboard = "";
  try {
    const text = await navigator.clipboard.readText();
    newClipboard = trimmedText(text);
  } catch (error) {
    // Clipboard access denied or failed
    console.error("Could not read clipboard:", error);
  }

  // Use computeInitialState to determine what to display
  const computeFn = shared?.computeInitialState;
  if (computeFn) {
    const result = computeFn({
      lastClipboard,
      currentText,
      newClipboard,
      history,
      limit: HISTORY_LIMIT,
    });

    // Update text input
    textInput.value = result.displayText;
    generateQRCode(result.displayText);

    // Save updated state
    await storageSet({
      [STORAGE_KEY]: result.newHistory,
      [CURRENT_TEXT_KEY]: result.newCurrentText,
      [LAST_CLIPBOARD_KEY]: result.newLastClipboard,
    });

    // Update dropdown if history changed
    populateHistoryDropdown(result.newHistory);

    if (result.clipboardChanged) {
      showStatus("Loaded from clipboard", "success");
    }
    return;
  }

  // Fallback if shared module not available (shouldn't happen in extension)
  if (newClipboard) {
    textInput.value = newClipboard;
    await addToHistory(newClipboard);
    generateQRCode(newClipboard);
    showStatus("Loaded from clipboard", "success");
    return;
  }

  if (history.length > 0) {
    textInput.value = history[history.length - 1];
    generateQRCode(textInput.value);
    return;
  }

  textInput.value = "";
  generateQRCode("");
}

// Event listeners
textInput.addEventListener("input", () => {
  debouncedInputChange();
  debouncedSave();
});

textInput.addEventListener("paste", async () => {
  // Wait for paste to apply to textarea value
  setTimeout(async () => {
    const trimmed = trimmedText(textInput.value);
    if (!trimmed) return;

    textInput.value = trimmed;
    await addToHistory(trimmed);
    await storageSet({ [CURRENT_TEXT_KEY]: trimmed });
  }, 0);
});

// History dropdown change handler
historyDropdown.addEventListener("change", async () => {
  const val = historyDropdown.value;
  if (!val) return;

  // Set textInput.value to selected item
  textInput.value = val;

  // Move selected item to end of array
  await moveToEnd(val);

  // Save as current text
  await storageSet({ [CURRENT_TEXT_KEY]: val });

  // Generate QR code
  generateQRCode(val);

  showStatus("Loaded from history", "success");
});

// Initialize when popup opens
document.addEventListener("DOMContentLoaded", () => {
  loadInitialState();
});
