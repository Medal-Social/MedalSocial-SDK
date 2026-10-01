import { expect, test } from "@playwright/test";

test("books one service end to end through the wizard, then opens the manage page", async ({
  page,
}) => {
  await page.goto("/bestill");
  await expect(page.getByRole("heading", { name: "Bestill time" })).toBeVisible();

  // Step 1: who. One child is one tap.
  await page.getByRole("radio", { name: "1 barn" }).click();
  // Step 2: what.
  await page.getByRole("button", { name: /Barneklipp/ }).click();
  // Step 3: who with and when — first available, the first free time.
  await expect(page.getByRole("radio", { name: /Første ledige/ })).toBeVisible();
  await page
    .getByRole("button", { name: /^\d{2}:\d{2}$/ })
    .first()
    .click();
  // Step 4: the details.
  await page.getByLabel("Mobil").fill("400 00 000");
  await page.getByLabel(/Jeg vet at timen kan flyttes/).check();
  await page.getByRole("button", { name: /^Bestill –/ }).click();

  await expect(page.getByRole("heading", { name: /Timen er bestilt/ })).toBeVisible();
  await page.getByRole("link", { name: "Flytt eller avbestill" }).click();
  await expect(page.getByRole("heading", { name: "Timen din" })).toBeVisible();
  await expect(page.getByText("Barneklipp · confirmed")).toBeVisible();
});

test("the API answers through the one handler", async ({ request }) => {
  const services = await request.get("/api/booking/services");
  expect(services.status()).toBe(200);
  expect((await services.json()).services[0].name).toBe("Barneklipp");
  expect((await request.get("/api/booking/nope")).status()).toBe(404);
  const touch = await request.post("/api/portal/session/touch");
  expect(touch.status()).toBe(401);
});
