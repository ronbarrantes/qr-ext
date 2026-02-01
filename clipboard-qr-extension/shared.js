// Shared utilities used by both popup and content scripts.
// Exposed as a global `ClipboardQrShared` in the extension, and as CommonJS exports in Node (tests).
;(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ClipboardQrShared = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function trimmedText(text) {
    return (text ?? "").toString().trim();
  }

  function coerceTextArray(value) {
    if (!Array.isArray(value)) return [];
    return value.map(trimmedText).filter(Boolean);
  }

  // Newest items are stored at the end of the array.
  function updateHistory(history, text, limit = 10) {
    const queue = coerceTextArray(history);
    const t = trimmedText(text);
    if (!t) return queue;

    const filtered = queue.filter((h) => h !== t);
    filtered.push(t);

    if (filtered.length > limit) {
      filtered.splice(0, filtered.length - limit);
    }
    return filtered;
  }

  // Serializes async tasks in a single JS context to avoid lost updates.
  function createSerialQueue() {
    let chain = Promise.resolve();
    return function enqueue(task) {
      const run = () => Promise.resolve().then(task);
      chain = chain.then(run, run);
      return chain;
    };
  }

  // Best-effort extraction of the copied text without relying on navigator.clipboard.
  function extractCopiedTextFromCopyEvent(e, doc) {
    const d = doc || (typeof document !== "undefined" ? document : null);

    // 1) Sometimes available on the event (often empty in Chrome, but cheap to try).
    try {
      const fromEvent = e?.clipboardData?.getData?.("text/plain");
      const t = trimmedText(fromEvent);
      if (t) return t;
    } catch {
      // ignore
    }

    if (!d) return "";

    // 2) If user copied from an input/textarea, selectionStart/End is reliable.
    const fromTextControl = (el) => {
      if (!el) return "";
      const tag = (el.tagName || "").toUpperCase();
      const isTextArea = tag === "TEXTAREA";
      const isInput = tag === "INPUT";
      if (!isTextArea && !isInput) return "";

      const value = typeof el.value === "string" ? el.value : "";
      const start = el.selectionStart;
      const end = el.selectionEnd;
      if (typeof start !== "number" || typeof end !== "number") return "";
      if (start === end) return "";
      return value.slice(start, end);
    };

    const active = d.activeElement;
    const tFromActive = trimmedText(fromTextControl(active));
    if (tFromActive) return tFromActive;

    const tFromTarget = trimmedText(fromTextControl(e?.target));
    if (tFromTarget) return tFromTarget;

    // 3) Generic selection text (works for normal page text).
    try {
      const sel = d.getSelection?.();
      const t = trimmedText(sel?.toString?.());
      if (t) return t;
    } catch {
      // ignore
    }

    return "";
  }

  return {
    trimmedText,
    coerceTextArray,
    updateHistory,
    createSerialQueue,
    extractCopiedTextFromCopyEvent,
  };
});

