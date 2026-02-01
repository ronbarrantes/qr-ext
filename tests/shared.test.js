const shared = require("../clipboard-qr-extension/shared.js");

describe("ClipboardQrShared.computeInitialState", () => {
  test("shows new clipboard when clipboard changed and adds it to history", () => {
    const result = shared.computeInitialState({
      lastClipboard: "item1",
      currentText: "item1",
      newClipboard: "item2",
      history: ["item1"],
      limit: 10,
    });

    expect(result.displayText).toBe("item2");
    expect(result.newHistory).toEqual(["item1", "item2"]);
    expect(result.newLastClipboard).toBe("item2");
    expect(result.newCurrentText).toBe("item2");
    expect(result.clipboardChanged).toBe(true);
  });

  test("preserves edited text in history when clipboard changes", () => {
    // User copied item1, edited to "item 12", then copied item2
    const result = shared.computeInitialState({
      lastClipboard: "item1",
      currentText: "item 12",
      newClipboard: "item2",
      history: ["item1"],
      limit: 10,
    });

    expect(result.displayText).toBe("item2");
    // History should be: item1 (original), item 12 (edited), item2 (new copy)
    expect(result.newHistory).toEqual(["item1", "item 12", "item2"]);
    expect(result.newLastClipboard).toBe("item2");
    expect(result.newCurrentText).toBe("item2");
    expect(result.clipboardChanged).toBe(true);
  });

  test("shows saved currentText when clipboard has not changed", () => {
    // User copied item1, edited to "item 12", closed and reopened
    const result = shared.computeInitialState({
      lastClipboard: "item1",
      currentText: "item 12",
      newClipboard: "item1", // clipboard still has item1
      history: ["item1", "item 12"],
      limit: 10,
    });

    expect(result.displayText).toBe("item 12");
    expect(result.newHistory).toEqual(["item1", "item 12"]);
    expect(result.newLastClipboard).toBe("item1");
    expect(result.newCurrentText).toBe("item 12");
    expect(result.clipboardChanged).toBe(false);
  });

  test("shows saved currentText when clipboard read fails (empty)", () => {
    const result = shared.computeInitialState({
      lastClipboard: "item1",
      currentText: "item 12",
      newClipboard: "", // clipboard read failed
      history: ["item1", "item 12"],
      limit: 10,
    });

    expect(result.displayText).toBe("item 12");
    expect(result.clipboardChanged).toBe(false);
  });

  test("falls back to most recent history item when no currentText", () => {
    const result = shared.computeInitialState({
      lastClipboard: "",
      currentText: "",
      newClipboard: "",
      history: ["old1", "old2", "old3"],
      limit: 10,
    });

    expect(result.displayText).toBe("old3");
    expect(result.newCurrentText).toBe("old3");
    expect(result.clipboardChanged).toBe(false);
  });

  test("returns empty state when no clipboard, currentText, or history", () => {
    const result = shared.computeInitialState({
      lastClipboard: "",
      currentText: "",
      newClipboard: "",
      history: [],
      limit: 10,
    });

    expect(result.displayText).toBe("");
    expect(result.newHistory).toEqual([]);
    expect(result.clipboardChanged).toBe(false);
  });

  test("first open with clipboard content sets everything correctly", () => {
    // First time opening extension with item1 in clipboard
    const result = shared.computeInitialState({
      lastClipboard: "",
      currentText: "",
      newClipboard: "item1",
      history: [],
      limit: 10,
    });

    expect(result.displayText).toBe("item1");
    expect(result.newHistory).toEqual(["item1"]);
    expect(result.newLastClipboard).toBe("item1");
    expect(result.newCurrentText).toBe("item1");
    expect(result.clipboardChanged).toBe(true);
  });

  test("enforces history limit when adding edited text and new clipboard", () => {
    const result = shared.computeInitialState({
      lastClipboard: "item1",
      currentText: "item 12",
      newClipboard: "item2",
      history: ["a", "b", "c", "d", "e", "f", "g", "h", "item1"],
      limit: 10,
    });

    // Should drop oldest items to stay within limit
    // After adding "item 12" and "item2", need to trim to 10
    expect(result.newHistory.length).toBeLessThanOrEqual(10);
    expect(result.newHistory).toContain("item 12");
    expect(result.newHistory).toContain("item2");
    expect(result.newHistory[result.newHistory.length - 1]).toBe("item2");
  });

  test("does not duplicate edited text if it matches lastClipboard", () => {
    // Edge case: user didn't actually edit anything
    const result = shared.computeInitialState({
      lastClipboard: "item1",
      currentText: "item1", // same as lastClipboard
      newClipboard: "item2",
      history: ["item1"],
      limit: 10,
    });

    // Should not have duplicate item1
    expect(result.newHistory).toEqual(["item1", "item2"]);
  });
});

describe("ClipboardQrShared.updateHistory", () => {
  test("appends new item to end (newest at end)", () => {
    expect(shared.updateHistory(["item1"], "item2", 10)).toEqual(["item1", "item2"]);
  });

  test("deduplicates and moves existing item to end", () => {
    expect(shared.updateHistory(["item1", "item2"], "item1", 10)).toEqual(["item2", "item1"]);
  });

  test("trims and ignores empty input", () => {
    expect(shared.updateHistory(["a"], "   ", 10)).toEqual(["a"]);
  });

  test("enforces limit by dropping oldest items", () => {
    const out = shared.updateHistory(["1", "2", "3"], "4", 3);
    expect(out).toEqual(["2", "3", "4"]);
  });
});

describe("ClipboardQrShared.createSerialQueue", () => {
  test("serializes async tasks to avoid lost updates", async () => {
    let history = [];
    const enqueue = shared.createSerialQueue();

    const add = (text, delayMs) =>
      enqueue(async () => {
        const snapshot = history.slice();
        await new Promise((r) => setTimeout(r, delayMs));
        history = shared.updateHistory(snapshot, text, 10);
      });

    // Fire "concurrently" (out-of-order delays)
    const p1 = add("item1", 30);
    const p2 = add("item2", 10);
    const p3 = add("item3", 0);
    await Promise.all([p1, p2, p3]);

    expect(history).toEqual(["item1", "item2", "item3"]);
  });
});

describe("ClipboardQrShared.extractCopiedTextFromCopyEvent", () => {
  test("prefers clipboardData text/plain when available", () => {
    const e = {
      clipboardData: {
        getData: () => " item3 ",
      },
    };
    const doc = {
      activeElement: null,
      getSelection: () => ({ toString: () => "ignored" }),
    };
    expect(shared.extractCopiedTextFromCopyEvent(e, doc)).toBe("item3");
  });

  test("extracts from active textarea selection", () => {
    const doc = {
      activeElement: {
        tagName: "TEXTAREA",
        value: "item1 item2",
        selectionStart: 0,
        selectionEnd: 5,
      },
      getSelection: () => ({ toString: () => "" }),
    };
    expect(shared.extractCopiedTextFromCopyEvent({}, doc)).toBe("item1");
  });

  test("falls back to document selection text", () => {
    const doc = {
      activeElement: null,
      getSelection: () => ({ toString: () => " item2 " }),
    };
    expect(shared.extractCopiedTextFromCopyEvent({}, doc)).toBe("item2");
  });
});

