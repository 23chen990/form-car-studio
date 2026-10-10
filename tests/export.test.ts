import { test } from "node:test";
import assert from "node:assert/strict";
import { fitContain } from "../src/lib/export.js";
test("wallpaper containment preserves the whole landscape car with portrait padding", () => {
  const fit = fitContain(1500, 1095, 1080, 1920);
  assert.equal(fit.imageWidth, 1080);
  assert.ok(fit.imageHeight < 1920 && fit.imageY > 0);
  assert.equal(fit.imageX, 0);
  assert.ok(Math.abs(fit.imageWidth / fit.imageHeight - 1500 / 1095) < 1e-12);
  assert.throws(() => fitContain(0, 10, 1080, 1920));
});
