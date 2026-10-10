import sharp from "sharp";
import { readFile } from "node:fs/promises";
import type { Target, StyleId } from "../shared/types";

// This mask only applies to the supplied sample photograph, never an upload.
const palette: Record<string, [number, number, number]> = {
  blue: [24, 89, 148],
  silver: [163, 174, 181],
  green: [46, 92, 69],
  graphite: [57, 65, 73],
  red: [146, 35, 44],
  bronze: [154, 119, 67],
  black: [42, 47, 52],
};
function colorId(value: string) {
  return (
    (
      {
        "deep-blue": "blue",
        "cool-silver": "silver",
        "forest-green": "green",
        "warm-bronze": "bronze",
        "forest green": "green",
        "cool silver": "silver",
      } as Record<string, string>
    )[value] ?? value
  );
}
export async function renderDemoImage(
  source: Buffer,
  target: Target,
): Promise<Buffer> {
  const { data, info } = await sharp(source)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const body = colorId(target.bodyColor),
    wheel = colorId(target.wheelColor);
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      const r = data[i],
        g = data[i + 1],
        b = data[i + 2];
      const nx = x / info.width,
        ny = y / info.height;
      const frontWheel =
        ((nx - 0.516) / 0.064) ** 2 + ((ny - 0.746) / 0.119) ** 2 < 1;
      const rearWheel =
        ((nx - 0.919) / 0.039) ** 2 + ((ny - 0.675) / 0.092) ** 2 < 1;
      const isWheel =
        (frontWheel || rearWheel) && r > g * 1.08 && g > b * 1.1 && r > 45;
      const isPaint =
        ny > 0.279 &&
        ny < 0.826 &&
        nx > 0.032 &&
        nx < 0.978 &&
        b > r * 1.25 &&
        b > g * 1.12 &&
        b - r > 15 &&
        !frontWheel &&
        !rearWheel;
      const desired =
        isWheel && wheel !== "keep" && wheel !== "bronze"
          ? palette[wheel]
          : isPaint && body !== "keep" && body !== "blue"
            ? palette[body]
            : undefined;
      if (!desired) continue;
      const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
      const strength = luminance / (isWheel ? 100 : 73);
      const highlight = Math.max(0, strength - 1.6) * 40;
      for (let channel = 0; channel < 3; channel++)
        data[i + channel] = Math.max(
          0,
          Math.min(255, desired[channel] * strength + highlight),
        );
    }
  return sharp(data, { raw: info }).png().toBuffer();
}
let sample: Promise<Buffer> | undefined;
export async function renderDemo(
  target: Target,
  _styleId?: StyleId,
): Promise<Buffer> {
  sample ??= readFile(
    new URL("../public/images/street-sport.jpg", import.meta.url),
  );
  return renderDemoImage(await sample, target);
}
