// Records copy events into extension history, even when popup is closed.

const shared = globalThis.ClipboardQrShared;
const enqueueMessage = shared?.createSerialQueue?.() ?? ((fn) => Promise.resolve().then(fn));

async function addToHistory(text) {
  const t = shared?.trimmedText?.(text) ?? "";
  if (!t) return;

  // Serialize messages to the background service worker to avoid cross-tab races.
  await enqueueMessage(async () => {
    try {
      await chrome.runtime.sendMessage({ type: "CLIPBOARD_ADD", text: t });
    } catch (error) {
      console.debug("Clipboard QR Code: failed to send copy event", error);
    }
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
