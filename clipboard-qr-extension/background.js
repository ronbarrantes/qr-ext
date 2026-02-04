// Centralized clipboard history writer to avoid cross-tab race conditions.

importScripts("shared.js");

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

async function addToHistory(text) {
  const t = shared?.trimmedText?.(text) ?? "";
  if (!t) return;

  await enqueueHistoryWrite(async () => {
    const history = await getHistory();
    const updated = shared?.updateHistory?.(history, t, HISTORY_LIMIT) ?? history;
    await storageSet({ [STORAGE_KEY]: updated });
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CLIPBOARD_ADD") {
    enqueueHistoryWrite(async () => {
      try {
        await addToHistory(message?.text ?? "");
        sendResponse({ ok: true });
      } catch (error) {
        console.debug("Clipboard QR Code: failed to store copy event", error);
        sendResponse({ ok: false });
      }
    });
    return true;
  }
  return false;
});
