// DOM Elements
const qrCodeContainer = document.getElementById("qr-code");
const emptyMessage = document.getElementById("empty-message");
const textInput = document.getElementById("text-input");
const statusEl = document.getElementById("status");
const historySelect = document.getElementById("history-select");

let qrCodeInstance = null;

const STORAGE_KEY = "clipboardHistory";
const HISTORY_LIMIT = 10;

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
  return (text ?? "").toString().trim();
}

function truncateLabel(text, maxLen = 60) {
  const t = normalizeText(text);
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

function isQuotaError(err) {
  const msg = (err?.message ?? "").toString();
  return /quota/i.test(msg);
}

function coerceTextArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeText).filter(Boolean);
}

// Get the current history array from storage
async function getHistory() {
  const saved = await storageGet([STORAGE_KEY]);
  return coerceTextArray(saved?.[STORAGE_KEY]);
}

// Save the history array to storage
async function saveHistory(history) {
  const queue = coerceTextArray(history);
  
  // Ensure we don't exceed the limit
  let finalQueue = queue;
  if (finalQueue.length > HISTORY_LIMIT) {
    finalQueue = finalQueue.slice(-HISTORY_LIMIT);
  }

  // Handle quota errors by removing oldest items
  let didEvictForQuota = false;
  while (true) {
    try {
      await storageSet({ [STORAGE_KEY]: finalQueue });
      break;
    } catch (err) {
      if (isQuotaError(err) && finalQueue.length > 1) {
        finalQueue = finalQueue.slice(1);
        didEvictForQuota = true;
        continue;
      }
      console.error("Failed saving history:", err);
      showStatus("Could not save to history (storage full?)", "error");
      return;
    }
  }

  if (didEvictForQuota) {
    showStatus("Storage full: dropped oldest history item(s)", "");
  }

  return finalQueue;
}

// Add an item to the history array (push to end)
async function addToHistory(text) {
  const trimmed = normalizeText(text);
  if (!trimmed) return;

  const currentHistory = await getHistory();
  
  // Remove if already exists (to avoid duplicates)
  const filtered = currentHistory.filter((h) => h !== trimmed);
  
  // Push to end
  filtered.push(trimmed);
  
  // Save and return the updated history
  return await saveHistory(filtered);
}

// Move an item to the end of the history array (used when selecting from dropdown)
async function moveToEnd(text) {
  const trimmed = normalizeText(text);
  if (!trimmed) return;

  const currentHistory = await getHistory();
  
  // Remove if exists
  const filtered = currentHistory.filter((h) => h !== trimmed);
  
  // Push to end
  filtered.push(trimmed);
  
  // Save and return the updated history
  return await saveHistory(filtered);
}

// Populate the dropdown with history (most recent first for display)
function populateHistorySelect(history) {
  const queue = coerceTextArray(history);
  const currentValue = historySelect.value;

  historySelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Recent items…";
  historySelect.appendChild(placeholder);

  // Show most-recent first (reverse the array for display)
  const displayItems = queue.slice().reverse();
  displayItems.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item;
    opt.textContent = truncateLabel(item);
    historySelect.appendChild(opt);
  });

  // Keep selection if still present
  if (currentValue && queue.includes(currentValue)) {
    historySelect.value = currentValue;
  } else {
    historySelect.value = "";
  }
}

// Generate or update QR code
function generateQRCode(text) {
  const normalized = normalizeText(text);
  // Clear existing QR code
  qrCodeContainer.innerHTML = "";

  if (!normalized) {
    qrCodeContainer.classList.add("hidden");
    emptyMessage.classList.remove("hidden");
    return;
  }

  qrCodeContainer.classList.remove("hidden");
  emptyMessage.classList.add("hidden");

  try {
    qrCodeInstance = new QRCode(qrCodeContainer, {
      text: normalized,
      width: 150,
      height: 150,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M,
    });
    showStatus("QR code generated", "success");
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

// Update UI to reflect the current state (last item in history)
async function updateUI() {
  const history = await getHistory();
  const lastItem = history.length > 0 ? history[history.length - 1] : "";
  
  // Update text input
  textInput.value = lastItem;
  
  // Generate QR code from last item
  generateQRCode(lastItem);
  
  // Update dropdown
  populateHistorySelect(history);
}

// Read from clipboard and add to history
async function readClipboard({ applyToUI } = { applyToUI: true }) {
  try {
    console.log("Attempting to read clipboard...");
    const text = await navigator.clipboard.readText();
    console.log("Clipboard text:", text);
    
    if (text) {
      const normalized = normalizeText(text);
      if (normalized) {
        console.log("Adding to history:", normalized);
        await addToHistory(normalized);
        if (applyToUI) {
          await updateUI();
          showStatus("Loaded from clipboard", "success");
        }
      } else {
        console.log("Clipboard text was empty after normalization");
        if (applyToUI) showStatus("Clipboard is empty", "");
      }
    } else {
      console.log("Clipboard text was empty");
      if (applyToUI) showStatus("Clipboard is empty", "");
    }
  } catch (error) {
    // Clipboard access may be denied
    console.error("Could not read clipboard:", error);
    console.error("Error details:", {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    if (applyToUI) {
      showStatus("Click in the text area to paste", "");
    }
  }
}

// Load initial state
async function loadInitialState() {
  console.log("Loading initial state...");
  const history = await getHistory();
  console.log("Current history:", history);
  
  // If we have history, show the last item
  if (history.length > 0) {
    console.log("Found history, updating UI with last item:", history[history.length - 1]);
    await updateUI();
  } else {
    console.log("No history found");
    // Show empty state
    textInput.value = "";
    generateQRCode("");
  }
  
  // Try to read clipboard (may be blocked without user gesture)
  // This will work if user has interacted with the page, otherwise
  // user needs to click/focus the textarea
  console.log("Attempting initial clipboard read...");
  await readClipboard({ applyToUI: true });
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

// Debounced input handler - adds to history when user types
const debouncedInputChange = debounce(handleInputChange, 300);
const debouncedSave = debounce(async () => {
  const normalized = normalizeText(textInput.value);
  if (normalized) {
    await addToHistory(normalized);
    await updateUI();
  }
}, 600);

// Event listeners
textInput.addEventListener("input", () => {
  debouncedInputChange();
  debouncedSave();
});

textInput.addEventListener("paste", async () => {
  // Wait for paste to apply to textarea value
  setTimeout(async () => {
    const normalized = normalizeText(textInput.value);
    if (normalized) {
      textInput.value = normalized;
      await addToHistory(normalized);
      await updateUI();
    }
  }, 0);
});

// Read clipboard when user focuses/clicks on textarea (user gesture required)
textInput.addEventListener("focus", async () => {
  console.log("Textarea focused, reading clipboard...");
  await readClipboard({ applyToUI: true });
});

textInput.addEventListener("click", async () => {
  console.log("Textarea clicked, reading clipboard...");
  await readClipboard({ applyToUI: true });
});

historySelect.addEventListener("change", async () => {
  const val = historySelect.value;
  if (!val) return;
  
  // Move selected item to end of array
  await moveToEnd(val);
  
  // Update UI to reflect the change
  await updateUI();
  
  showStatus("Loaded from history", "success");
});

// Initialize when popup opens
document.addEventListener("DOMContentLoaded", () => {
  loadInitialState();
});
