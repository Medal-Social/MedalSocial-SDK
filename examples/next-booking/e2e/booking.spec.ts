import { expect, test } from "@playwright/test";

test("books one service end to end, then opens the manage page", async ({ page }) => {
  await page.goto("/bestill");
  await expect(page.getByRole("heading", { name: "Bestill time" })).toBeVisible();

  await page.getByLabel("Barneklipp").check();
  await page.getByRole("group", { name: "Tidspunkt" }).getByRole("button").first().click();
  await page.getByLabel("Telefon").fill("400 00 000");
  await page.getByLabel("Jeg godtar vilkårene").check();
  await page.getByRole("button", { name: "Bekreft" }).click();

  await expect(page.getByRole("heading", { name: "Timen er bestilt" })).toBeVisible();
  await page.getByRole("link", { name: "Se eller endre timen" }).click();
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
