import { test } from "node:test";
import assert from "node:assert/strict";

test("color selection replaces one field, keeps the other, and returning to a verified color removes the change", async () => {
  let draft: any;
  try {
    draft = await import("../src/lib/draft.js");
  } catch {
    assert.fail(
      "Draft helpers must exist to keep references separate from generated images.",
    );
  }
  const base = { bodyColor: "blue", wheelColor: "silver" };
  const first = draft.selectColor(
    { bodyColor: "keep", wheelColor: "keep" },
    "wheelColor",
    "bronze",
    base,
  );
  const second = draft.selectColor(first, "wheelColor", "graphite", base);
  const both = draft.selectColor(second, "bodyColor", "green", base);
  assert.deepEqual(both, { bodyColor: "green", wheelColor: "graphite" });
  assert.equal(draft.countChanges(both), 2);
  const restored = draft.selectColor(both, "wheelColor", "silver", base);
  assert.deepEqual(restored, { bodyColor: "green", wheelColor: "keep" });
  assert.equal(
    draft.countChanges(draft.selectColor(restored, "bodyColor", "blue", base)),
    0,
  );
});

test("unknown current colors stay Keep current instead of inheriting an unverified requested color", async () => {
  let draft: any;
  try {
    draft = await import("../src/lib/draft.js");
  } catch {
    assert.fail("Draft helpers must exist.");
  }
  assert.deepEqual(
    draft.selectColor(
      { bodyColor: "keep", wheelColor: "keep" },
      "bodyColor",
      "silver",
    ),
    { bodyColor: "silver", wheelColor: "keep" },
  );
  assert.equal(
    draft.countChanges({ bodyColor: "keep", wheelColor: "keep" }),
    0,
  );
});
