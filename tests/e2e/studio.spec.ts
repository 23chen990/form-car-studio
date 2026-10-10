import { test, expect } from "@playwright/test";

test("sample flow keeps reference selections free, restores a draft, creates one version, and exports without generation", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore Street Sport" }).click();
  await page.getByRole("button", { name: "Try this look on my car" }).click();
  await page.getByRole("button", { name: "Use demo car" }).click();
  await page.getByRole("checkbox", { name: /I have permission/ }).check();
  await page
    .getByRole("button", { name: "Generate 1 look", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Refine this look" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save to My Looks", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Saved to My Looks", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Refine this look" }).click();
  const baseImage = await page
    .getByTestId("current-car-image")
    .getAttribute("src");
  await page.getByRole("button", { name: "Wheel color", exact: true }).click();
  await page.getByRole("button", { name: "Cool silver", exact: true }).click();
  await page.getByRole("button", { name: "Graphite", exact: true }).click();
  await page.getByRole("button", { name: "Body color", exact: true }).click();
  await page.getByRole("button", { name: "Forest green", exact: true }).click();
  await expect(
    page.getByText("2 changes selected. Image not updated.", { exact: true }),
  ).toBeVisible();
  expect(await page.getByTestId("current-car-image").getAttribute("src")).toBe(
    baseImage,
  );
  const before = await page.evaluate(async () =>
    (await fetch("/api/state")).json(),
  );
  expect(before.tasks).toHaveLength(1);
  expect(before.credits).toBe(11);
  await expect(page.getByText("Draft saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("2 changes selected. Image not updated.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "A few details. A new feeling." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Generate 1 new version", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Refine this look" }),
  ).toBeVisible();
  await expect(page.getByText("V2", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Previous / Current", exact: true }),
  ).toBeVisible();
  const comparison = page.getByRole("dialog").getByRole("slider");
  await expect(comparison).toHaveAttribute("aria-valuenow", "50");
  await comparison.focus();
  await page.keyboard.press("ArrowRight");
  await expect(comparison).toHaveAttribute("aria-valuenow", "55");
  const frame = page.getByTestId("comparison-frame");
  const bounds = (await frame.boundingBox())!;
  await page.mouse.click(
    bounds.x + bounds.width * 0.3,
    bounds.y + bounds.height * 0.5,
  );
  await expect
    .poll(async () =>
      Math.round(Number(await comparison.getAttribute("aria-valuenow"))),
    )
    .toBe(30);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Export image", exact: true }).click();
  await page.getByRole("button", { name: "Wallpaper", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download image" }).click();
  expect((await download).suggestedFilename()).toContain("wallpaper");
  const after = await page.evaluate(async () =>
    (await fetch("/api/state")).json(),
  );
  expect(after.tasks).toHaveLength(2);
  expect(after.projects[0].versions).toHaveLength(2);
  expect(after.credits).toBe(10);
  expect(after.projects[0].versions[1].parentVersionId).toBe(
    after.projects[0].versions[0].id,
  );
});

test("draft can be kept, reopened, undone and discarded without creating another task", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore Modern Classic" }).click();
  await page.getByRole("button", { name: "Try this look on my car" }).click();
  await page.getByRole("button", { name: "Use demo car" }).click();
  await page.getByRole("checkbox", { name: /I have permission/ }).check();
  await page
    .getByRole("button", { name: "Generate 1 look", exact: true })
    .click();
  await page.getByRole("button", { name: "Refine this look" }).click();
  await expect(
    page.getByRole("button", { name: "Review changes" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Warm bronze", exact: true }).click();
  await page.getByRole("button", { name: "Graphite", exact: true }).click();
  await page.getByRole("button", { name: "Undo selection" }).click();
  await expect(
    page.getByRole("button", { name: "Warm bronze", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Back to your look" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep draft & leave" }).click();
  await page.getByRole("button", { name: "Refine this look" }).click();
  await expect(
    page.getByText("1 change selected. Image not updated.", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
  await page.getByRole("button", { name: "Back to your look" }).click();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await page.getByRole("button", { name: "Refine this look" }).click();
  await expect(
    page.getByRole("button", { name: "Review changes" }),
  ).toBeDisabled();
  const state = await page.evaluate(async () =>
    (await fetch("/api/state")).json(),
  );
  expect(state.tasks).toHaveLength(1);
  expect(state.credits).toBe(11);
  expect(state.projects[0].draft).toBeNull();
});

test("360px layout is usable and saving a style never generates a look", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/");
  await page.getByRole("button", { name: "Save Clean Upgrade style" }).click();
  await page.getByRole("button", { name: "My Looks", exact: true }).click();
  await page.getByRole("button", { name: "Saved styles", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Explore Clean Upgrade" }),
  ).toBeVisible();
  const state = await page.evaluate(async () =>
    (await fetch("/api/state")).json(),
  );
  expect(state.tasks).toHaveLength(0);
  expect(state.savedStyles).toEqual(["clean"]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
});

test("a failed refinement stays visible in its review dialog and can be retried without losing the draft", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore Street Sport" }).click();
  await page.getByRole("button", { name: "Try this look on my car" }).click();
  await page.getByRole("button", { name: "Use demo car" }).click();
  await page.getByRole("checkbox", { name: /I have permission/ }).check();
  await page
    .getByRole("button", { name: "Generate 1 look", exact: true })
    .click();
  await page.getByRole("button", { name: "Refine this look" }).click();
  await page.getByRole("button", { name: "Cool silver", exact: true }).click();
  await page.getByText("Draft saved", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  const failure =
    "The image service is unavailable. Your selections are saved.";
  await page.route("**/api/tasks", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: failure }),
    }),
  );
  const generateButton = page.getByRole("button", {
    name: "Generate 1 new version",
    exact: true,
  });
  await generateButton.click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(failure);
  await expect(generateButton).toBeEnabled();
  const state = await page.evaluate(async () =>
    (await fetch("/api/state")).json(),
  );
  expect(state.tasks).toHaveLength(1);
  expect(state.credits).toBe(11);
  expect(state.projects[0].draft.target.wheelColor).toBe("silver");
  await page.unroute("**/api/tasks");
  await generateButton.click();
  await expect(
    page.getByRole("button", { name: "Refine this look" }),
  ).toBeVisible();
  await expect(page.getByText("V2", { exact: true }).first()).toBeVisible();
});

test("a failed draft save is retried on generation without requiring another color selection", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore Street Sport" }).click();
  await page.getByRole("button", { name: "Try this look on my car" }).click();
  await page.getByRole("button", { name: "Use demo car" }).click();
  await page.getByRole("checkbox", { name: /I have permission/ }).check();
  await page
    .getByRole("button", { name: "Generate 1 look", exact: true })
    .click();
  await page.getByRole("button", { name: "Refine this look" }).click();
  await page.route(
    "**/api/projects/*",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Draft could not be saved. Please retry.",
        }),
      }),
    { times: 1 },
  );
  await page.getByRole("button", { name: "Cool silver", exact: true }).click();
  await expect(
    page.getByText("Draft not saved — try again", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Generate 1 new version", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Refine this look" }),
  ).toBeVisible();
  await expect(page.getByText("V2", { exact: true }).first()).toBeVisible();
  const state = await page.evaluate(async () =>
    (await fetch("/api/state")).json(),
  );
  expect(state.tasks).toHaveLength(2);
  expect(state.tasks[1].target.wheelColor).toBe("silver");
  expect(state.projects[0].draft).toBeNull();
  expect(state.credits).toBe(10);
});

test("retry confirmation sends the failed request snapshot with a fresh key and source-task association", async ({
  page,
}) => {
  const submissions: Record<string, unknown>[] = [];
  let failedTaskId = "";
  await page.route("**/api/tasks", async (route) => {
    submissions.push(route.request().postDataJSON());
    if (submissions.length === 1) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Retry service unavailable. Please retry.",
      }),
    });
  });
  await page.route("**/api/state", async (route) => {
    const response = await route.fetch();
    const state = await response.json();
    // Transport fixture for a server-confirmed failure; server tests exercise the real retry.
    if (state.tasks.length) {
      const task = state.tasks[0];
      failedTaskId = task.id;
      task.status = "failed";
      task.versionId = null;
      task.error = "The provider could not complete this request.";
      state.credits = 12;
      state.reservedCredits = 0;
    }
    await route.fulfill({ response, json: state });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore Modern Classic" }).click();
  await page.getByRole("button", { name: "Try this look on my car" }).click();
  await page.getByRole("button", { name: "Use demo car" }).click();
  await page.getByRole("checkbox", { name: /I have permission/ }).check();
  await page
    .getByRole("button", { name: "Generate 1 look", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Retry this request", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Retry this request" }),
  ).toBeVisible();
  expect(submissions).toHaveLength(1);
  await page
    .getByRole("button", { name: "Confirm retry", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(
    "Retry service unavailable. Please retry.",
  );
  expect(submissions).toHaveLength(2);
  expect(submissions[1].idempotencyKey).not.toBe(submissions[0].idempotencyKey);
  expect(submissions[1]).toEqual({
    ...submissions[0],
    idempotencyKey: submissions[1].idempotencyKey,
    retryOfTaskId: failedTaskId,
  });
});
