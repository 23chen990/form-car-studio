import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { renderDemoImage } from "../server/demo.js";

const source = await readFile(
  new URL("../public/images/street-sport.jpg", import.meta.url),
);

async function pixels(buffer: Buffer) {
  return sharp(buffer).raw().toBuffer({ resolveWithObject: true });
}

test("demo renderer returns a same-sized PNG and preserves pixels when both fields are Keep current", async () => {
  const input = await pixels(source);
  const output = await renderDemoImage(source, {
    bodyColor: "keep",
    wheelColor: "keep",
  });
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, input.info.width);
  assert.equal(metadata.height, input.info.height);
  const rendered = await pixels(output);
  assert.deepEqual(rendered.info, input.info);
  assert.deepEqual(rendered.data, input.data);
});

test("demo renderer changes the body paint while retaining image dimensions and background edges", async () => {
  const input = await pixels(source);
  const output = await renderDemoImage(source, {
    bodyColor: "forest green",
    wheelColor: "keep",
  });
  const rendered = await pixels(output);
  assert.equal(rendered.info.width, input.info.width);
  assert.equal(rendered.info.height, input.info.height);
  const edge = 0;
  const changed =
    rendered.data[edge] !== input.data[edge] ||
    rendered.data[edge + 1] !== input.data[edge + 1] ||
    rendered.data[edge + 2] !== input.data[edge + 2];
  assert.equal(changed, false, "background corner should remain unchanged");
  let pixelDifferences = 0;
  for (let i = 0; i < input.data.length; i += input.info.channels) {
    if (
      input.data[i] !== rendered.data[i] ||
      input.data[i + 1] !== rendered.data[i + 1] ||
      input.data[i + 2] !== rendered.data[i + 2]
    )
      pixelDifferences++;
  }
  assert.ok(
    pixelDifferences > 10_000,
    `expected body recolor to affect many pixels, got ${pixelDifferences}`,
  );
});

test("demo renderer changes bronze spokes to cool silver while leaving the body unchanged", async () => {
  const output = await renderDemoImage(source, {
    bodyColor: "keep",
    wheelColor: "cool silver",
  });
  const input = await pixels(source);
  const rendered = await pixels(output);
  const width = input.info.width;
  // Front wheel spokes are near the center of the visible front wheel.
  const samples = [
    [Math.round(width * 0.495), Math.round(input.info.height * 0.67)],
    [Math.round(width * 0.52), Math.round(input.info.height * 0.7)],
  ];
  assert.ok(
    samples.some(([x, y]) => {
      const i = (y * width + x) * input.info.channels;
      return (
        Math.abs(rendered.data[i] - input.data[i]) +
          Math.abs(rendered.data[i + 1] - input.data[i + 1]) +
          Math.abs(rendered.data[i + 2] - input.data[i + 2]) >
        15
      );
    }),
    "at least one wheel spoke sample should change",
  );
  const bodyX = Math.round(width * 0.62);
  const bodyY = Math.round(input.info.height * 0.53);
  const bodyI = (bodyY * width + bodyX) * input.info.channels;
  assert.ok(
    Math.abs(rendered.data[bodyI] - input.data[bodyI]) +
      Math.abs(rendered.data[bodyI + 1] - input.data[bodyI + 1]) +
      Math.abs(rendered.data[bodyI + 2] - input.data[bodyI + 2]) <
      30,
    "body must remain unchanged when only wheels are edited",
  );
});
