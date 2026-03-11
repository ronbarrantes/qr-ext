importScripts('shared.js');

// Centralized history writer (single extension context) to avoid race conditions
// from multiple tabs/frames writing clipboard history concurrently.

const STORAGE_KEY = "clipboardHistory";
const HISTORY_LIMIT = 15;

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

async function addCopiedTextToHistory(text) {
  const shared = globalThis.ClipboardQrShared;
  const trimmed = shared?.trimmedText?.(text) ?? "";
  if (!trimmed) return;

  const result = await storageGet([STORAGE_KEY]);
  const history = shared?.coerceTextArray?.(result?.[STORAGE_KEY]) ?? [];
  const updated = shared?.updateHistory?.(history, trimmed, HISTORY_LIMIT) ?? history;
  await storageSet({ [STORAGE_KEY]: updated });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "COPY_CAPTURED") return;

  void (async () => {
    try {
      await addCopiedTextToHistory(message?.text);
      sendResponse({ ok: true });
    } catch (err) {
      console.debug("Clipboard QR Code: failed to store copy event", err);
      sendResponse({ ok: false });
    }
  })();

  return true;
});
