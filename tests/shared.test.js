const shared = require("../clipboard-qr-extension/shared.js");

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

