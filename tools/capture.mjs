import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
const executablePath = [1243, 1234, 1223]
  .map((build) =>
    join(
      homedir(),
      `Library/Caches/ms-playwright/chromium-${build}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
    ),
  )
  .find((path) => existsSync(path));
const browser = await chromium.launch({ executablePath });
await mkdir("artifacts", { recursive: true });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
page.on("pageerror", (error) => errors.push(error.message));
await page.goto("http://127.0.0.1:5173/");
await page.getByRole("button", { name: "Explore Street Sport" }).waitFor();
await page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all(
    Array.from(document.images).map((image) => image.decode().catch(() => {})),
  );
  await Promise.all(
    document
      .getAnimations()
      .filter(
        (animation) =>
          animation.effect?.getComputedTiming().iterations !== Infinity,
      )
      .map((animation) => animation.finished.catch(() => {})),
  );
});
await page.screenshot({ path: "artifacts/discover-desktop.png" });
await page.getByRole("button", { name: "Explore Street Sport" }).click();
await page.getByRole("button", { name: "Try this look on my car" }).click();
await page.getByRole("button", { name: "Use demo car" }).click();
await page.getByRole("checkbox", { name: /I have permission/ }).check();
await page
  .getByRole("button", { name: "Generate 1 look", exact: true })
  .click();
await page.getByRole("button", { name: "Refine this look" }).click();
await page.getByRole("button", { name: "Cool silver", exact: true }).click();
await page.getByRole("button", { name: "Body color", exact: true }).click();
await page.getByRole("button", { name: "Forest green", exact: true }).click();
await page.getByText("Draft saved", { exact: true }).waitFor();
await page.screenshot({ path: "artifacts/refine-desktop.png" });
await page.getByRole("button", { name: "Back to your look" }).click();
await page.getByRole("button", { name: "Keep draft & leave" }).click();
await page.getByRole("button", { name: "Compare", exact: true }).click();
await page.getByRole("dialog").getByRole("slider").waitFor();
await page.evaluate(async () => {
  await Promise.all(
    Array.from(document.images).map((image) => image.decode().catch(() => {})),
  );
  await Promise.all(
    document
      .getAnimations()
      .filter(
        (animation) =>
          animation.effect?.getComputedTiming().iterations !== Infinity,
      )
      .map((animation) => animation.finished.catch(() => {})),
  );
});
await page.screenshot({ path: "artifacts/compare-desktop.png" });
const mobile = await browser.newPage({
  viewport: { width: 360, height: 780 },
  isMobile: true,
  hasTouch: true,
});
mobile.on("pageerror", (error) => errors.push(error.message));
await mobile.goto("http://127.0.0.1:5173/");
await mobile.getByRole("button", { name: "Explore Street Sport" }).waitFor();
await mobile.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all(
    Array.from(document.images).map((image) => image.decode().catch(() => {})),
  );
  await Promise.all(
    document
      .getAnimations()
      .filter(
        (animation) =>
          animation.effect?.getComputedTiming().iterations !== Infinity,
      )
      .map((animation) => animation.finished.catch(() => {})),
  );
});
await mobile.screenshot({ path: "artifacts/discover-mobile.png" });
const overflow = await mobile.evaluate(
  () => document.documentElement.scrollWidth > innerWidth,
);
console.log(
  JSON.stringify({
    errors,
    overflow,
    screenshots: [
      "discover-desktop.png",
      "discover-mobile.png",
      "refine-desktop.png",
      "compare-desktop.png",
    ],
  }),
);
await browser.close();
if (errors.length || overflow) process.exitCode = 1;
