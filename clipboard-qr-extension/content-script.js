// Records copy events into extension history, even when popup is closed.

const STORAGE_KEY = "clipboardHistory";
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

async function getHistory() {
  const saved = await storageGet([STORAGE_KEY]);
  return shared?.coerceTextArray?.(saved?.[STORAGE_KEY]) ?? [];
}

async function setHistory(history) {
  const queue = (shared?.coerceTextArray?.(history) ?? []).slice();
  if (queue.length > HISTORY_LIMIT) {
    queue.splice(0, queue.length - HISTORY_LIMIT);
  }
  await storageSet({ [STORAGE_KEY]: queue });
  return queue;
}

async function addToHistory(text) {
  const t = shared?.trimmedText?.(text) ?? "";
  if (!t) return;

  // Serialize read-modify-write to avoid losing intermediate copies.
  await enqueueHistoryWrite(async () => {
    const history = await getHistory();
    const updated = shared?.updateHistory?.(history, t, HISTORY_LIMIT) ?? history;
    await storageSet({ [STORAGE_KEY]: updated });
  });
}

document.addEventListener(
  "copy",
  (e) => {
    // Fire-and-forget; never block the user's copy.
    void (async () => {
      try {
        const text = shared?.extractCopiedTextFromCopyEvent?.(e, document) ?? "";
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

