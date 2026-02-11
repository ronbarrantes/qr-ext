// Shows an optional toast when user copies on the page; adds copied text to history (storage).

const shared = globalThis.ClipboardQrShared;
const enqueueMessage = shared?.createSerialQueue?.() ?? ((fn) => Promise.resolve().then(fn));

const SHOW_TOAST_KEY = "showCopyToast";
const STORAGE_KEY = "clipboardHistory";
const HISTORY_LIMIT = 10;
const TOAST_ID = "cqr-copy-toast";
const TOAST_MAX_TEXT_LENGTH = 120;
const TOAST_HIDE_DELAY_MS = 2200;
let toastHideTimeoutId = null;

function getCopiedText(ev) {
  try {
    const fromEvent = ev?.clipboardData?.getData?.("text/plain");
    const t = (fromEvent ?? "").toString().trim();
    if (t) return t;
  } catch (_) {}
  const selection = document.getSelection();
  return selection ? selection.toString() : "";
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

async function addToHistory(text) {
  const t = shared?.trimmedText?.(text) ?? "";
  if (!t) return;

  await enqueueMessage(async () => {
    try {
      const result = await new Promise((resolve) => chrome.storage.local.get([STORAGE_KEY], resolve));
      const history = shared?.coerceTextArray?.(result?.[STORAGE_KEY]) ?? [];
      const updated = shared?.updateHistory?.(history, t, HISTORY_LIMIT) ?? history;
      await new Promise((resolve, reject) => {
        chrome.storage.local.set({ [STORAGE_KEY]: updated }, () => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve();
        });
      });
    } catch (err) {
      console.debug("Clipboard QR Code: failed to store copy event", err);
    }
  });
}

document.addEventListener(
  "copy",
  (e) => {
    const raw = getCopiedText(e);
    const text = (raw ?? "").trim() || null;
    if (!text) return;

    void (async () => {
      try {
        await addToHistory(text);

        const showToast = await new Promise((resolve) => {
          chrome.storage.local.get([SHOW_TOAST_KEY], (r) => {
            resolve(r[SHOW_TOAST_KEY] === true);
          });
        });
        if (showToast) {
          const displayLabel = clampTextForToast(text) || "Item";
          showCopyToast(`${displayLabel} is on your clipboard`);
        }
      } catch (err) {
        console.debug("Clipboard QR Code: failed to store copy event", err);
      }
    })();
  },
  true
);
