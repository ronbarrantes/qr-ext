// Records copy events into extension history, even when popup is closed.

const STORAGE_KEY = "clipboardHistory";
const HISTORY_LIMIT = 10;

function trimmedText(text) {
  return (text ?? "").toString().trim();
}

function coerceTextArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(trimmedText).filter(Boolean);
}

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

async function getHistory() {
  const saved = await storageGet([STORAGE_KEY]);
  return coerceTextArray(saved?.[STORAGE_KEY]);
}

async function setHistory(history) {
  const queue = coerceTextArray(history);
  if (queue.length > HISTORY_LIMIT) {
    queue.splice(0, queue.length - HISTORY_LIMIT);
  }
  await storageSet({ [STORAGE_KEY]: queue });
  return queue;
}

async function addToHistory(text) {
  const trimmed = trimmedText(text);
  if (!trimmed) return;

  const history = await getHistory();

  // Remove duplicates and push newest to end (matches popup behavior)
  const filtered = history.filter((h) => h !== trimmed);
  filtered.push(trimmed);

  await setHistory(filtered);
}

async function readCopiedTextFromEvent(e) {
  try {
    const fromEvent = e?.clipboardData?.getData?.("text/plain");
    const t = trimmedText(fromEvent);
    if (t) return t;
  } catch {
    // ignore
  }

  // Fallback: try clipboard API (may fail on some sites)
  try {
    const fromClipboard = await navigator.clipboard.readText();
    const t = trimmedText(fromClipboard);
    if (t) return t;
  } catch {
    // ignore
  }

  return "";
}

document.addEventListener(
  "copy",
  (e) => {
    // Fire-and-forget; never block the user's copy.
    void (async () => {
      try {
        const text = await readCopiedTextFromEvent(e);
        if (!text) return;
        await addToHistory(text);
      } catch (err) {
        // Prevent unhandled promise rejections (e.g., storage quota exceeded).
        console.debug("Clipboard QR Code: failed to store copy event", err);
      }
    })();
  },
  true
);

