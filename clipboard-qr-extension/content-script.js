// Shows an optional toast when user copies on the page.
// Primary persistence path: service worker message.
// Fallback path: direct storage write when messaging is unavailable.

const shared = globalThis.ClipboardQrShared;

const SHOW_TOAST_KEY = "showCopyToast";
const STORAGE_KEY = "clipboardHistory";
const HISTORY_LIMIT = 15;
const TOAST_ID = "cqr-copy-toast";
const TOAST_MAX_TEXT_LENGTH = 120;
const TOAST_HIDE_DELAY_MS = 2200;
const MESSAGE_TIMEOUT_MS = 800;
const enqueueFallbackWrite =
  shared?.createSerialQueue?.() ?? ((task) => Promise.resolve().then(task));
let toastHideTimeoutId = null;

function getCopiedText(ev) {
  const extracted = shared?.extractCopiedTextFromCopyEvent?.(ev, document) ?? "";
  return (extracted ?? "").toString().trim();
}

function clampTextForToast(text) {
  const t = (text ?? "").toString().trim();
  if (t.length <= TOAST_MAX_TEXT_LENGTH) return t;
  return `${t.slice(0, TOAST_MAX_TEXT_LENGTH - 3)}...`;
}

function ensureToast() {
  let toast = document.getElementById(TOAST_ID);
  if (toast) return toast;

  toast = document.createElement("div");
  toast.id = TOAST_ID;
  toast.dataset.state = "closed";

  const card = document.createElement("div");
  card.className = "cqr-card";
  card.setAttribute("role", "status");
  card.setAttribute("aria-live", "polite");

  const dot = document.createElement("span");
  dot.className = "cqr-dot";
  const textEl = document.createElement("span");
  textEl.className = "cqr-text";

  card.appendChild(dot);
  card.appendChild(textEl);
  toast.appendChild(card);
  document.documentElement.appendChild(toast);

  return toast;
}

function showCopyToast(message) {
  const toast = ensureToast();
  const textNode = toast.querySelector(".cqr-text");
  if (!textNode) return;

  textNode.textContent = message;
  toast.dataset.state = "open";

  if (toastHideTimeoutId) clearTimeout(toastHideTimeoutId);
  toastHideTimeoutId = window.setTimeout(() => {
    toast.dataset.state = "closed";
  }, TOAST_HIDE_DELAY_MS);
}

async function addToHistoryFallback(text) {
  return enqueueFallbackWrite(async () => {
    const trimmed = shared?.trimmedText?.(text) ?? "";
    if (!trimmed) return;

    const result = await new Promise((resolve) => chrome.storage.local.get([STORAGE_KEY], resolve));
    const history = shared?.coerceTextArray?.(result?.[STORAGE_KEY]) ?? [];
    const updated = shared?.updateHistory?.(history, trimmed, HISTORY_LIMIT) ?? history;
    await new Promise((resolve, reject) => {
      chrome.storage.local.set({ [STORAGE_KEY]: updated }, () => {
        const err = chrome.runtime?.lastError;
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

function sendCopyEventToBackground(text) {
  return new Promise((resolve) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(false);
    }, MESSAGE_TIMEOUT_MS);

    try {
      chrome.runtime.sendMessage({ type: "COPY_CAPTURED", text }, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        if (chrome.runtime?.lastError) {
          resolve(false);
          return;
        }
        resolve(response?.ok === true);
      });
    } catch (_) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(false);
    }
  });
}

document.addEventListener(
  "copy",
  (e) => {
    const text = getCopiedText(e) || null;
    if (!text) return;

    void (async () => {
      try {
        const showToast = await new Promise((resolve) => {
          chrome.storage.local.get([SHOW_TOAST_KEY], (r) => {
            resolve(r[SHOW_TOAST_KEY] === true);
          });
        });
        if (showToast) {
          const displayLabel = clampTextForToast(text) || "Item";
          showCopyToast(`${displayLabel} is on your clipboard`);
        }

        const persistedInBackground = await sendCopyEventToBackground(text);
        if (!persistedInBackground) {
          await addToHistoryFallback(text);
        }
      } catch (err) {
        console.debug("Clipboard QR Code: failed to process copy event", err);
      }
    })();
  },
  true
);
