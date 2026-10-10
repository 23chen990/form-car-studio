import { test } from "node:test";
import assert from "node:assert/strict";
import { STYLES, styleTarget } from "../shared/catalog.js";

test("eight distinct directions share a valid color vocabulary and simple discovery categories", () => {
  assert.equal(STYLES.length, 8);
  assert.equal(new Set(STYLES.map((style) => style.id)).size, 8);
  for (const style of STYLES) {
    assert.ok(["Subtle", "Sporty", "Expressive"].includes(style.category));
    assert.ok(
      ["keep", "blue", "silver", "green", "graphite", "red"].includes(
        styleTarget(style.id).bodyColor,
      ),
    );
    assert.ok(
      ["keep", "silver", "bronze", "graphite"].includes(
        styleTarget(style.id).wheelColor,
      ),
    );
  }
});
