import { expect, shellUser, test } from "./fixtures";

// H12: a slow public geocoder must not block a complete enrollment answer.
test("can select a city and complete the location while Photon is unavailable", async ({
  page,
}) => {
  let savedAnswers: unknown = {};
  let responseReads = 0;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    // Exercise lossy-stream recovery while editing: each finite mock stream closes.
    if (path === "/api/realtime/stream") {
      await route.fulfill({ contentType: "text/event-stream", body: ": ready\n\n" });
      return;
    }
    let body: unknown = {};
    if (path === "/api/me") body = shellUser;
    if (path === "/api/public/applications/1") {
      body = {
        id: 1,
        name: "Enrollment",
        template: [
          {
            key: "origin",
            kind: "city",
            label: { en: "City of origin", es: "Ciudad de origen", gl: "Cidade de orixe" },
            required: true,
          },
        ],
        sections: [],
        open_at: null,
        close_at: null,
        ask_shirt_size: false,
        ask_food_intolerances: false,
      };
    }
    if (path === "/api/applications/1/response") {
      if (route.request().method() === "GET") responseReads++;
      if (route.request().method() === "PUT")
        savedAnswers = route.request().postDataJSON().responses;
      body = {
        id: 1,
        application_id: 1,
        status: "draft",
        responses: savedAnswers,
      };
    }
    if (path === "/api/public/food-intolerances") body = { intolerances: [] };
    if (path === "/api/me/notifications") body = { items: [], total: 0 };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("https://photon.komoot.io/**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        features: [
          { properties: { name: "Madrid", state: "Community of Madrid", country: "Spain" } },
        ],
      }),
    }),
  );
  await page.goto("/my-applications/1");
  const cookies = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  await expect(cookies).toBeVisible();
  await cookies.locator("button").first().click();
  await expect(cookies).toBeHidden();
  const city = page.getByRole("combobox", { name: "City of origin" });
  await city.fill("Madird");
  await expect(
    page.getByRole("option", { name: "Madrid, Community of Madrid, Spain" }),
  ).toBeVisible();
  await page.screenshot({ path: "artifacts/city-suggestions.png" });
  await city.press("ArrowDown");
  await city.press("Enter");
  await expect(city).toHaveValue("Madrid, Community of Madrid, Spain");

  await page.unroute("https://photon.komoot.io/**");
  await page.route("https://photon.komoot.io/**", (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await city.fill("Coruña");
  await expect(page.getByRole("status").filter({ hasText: "Search failed." })).toBeVisible();
  await page.screenshot({ path: "artifacts/city-search-error.png" });
  await page.getByRole("button", { name: "Enter location manually" }).click();
  await page.getByRole("textbox", { name: "City", exact: true }).fill("A Coruña");
  await page.getByRole("textbox", { name: "Province", exact: true }).fill("A Coruña");
  await page.getByRole("textbox", { name: "Country", exact: true }).fill("España");
  await page.getByRole("heading", { name: "Your answers" }).click();
  await expect
    .poll(() => savedAnswers)
    .toEqual({ origin: { city: "A Coruña", province: "A Coruña", country: "España" } });
  await expect(page.getByRole("textbox", { name: "City", exact: true })).not.toHaveAttribute(
    "aria-invalid",
    "true",
  );
  const readsAfterSave = responseReads;
  await expect.poll(() => responseReads).toBeGreaterThan(readsAfterSave);
  await page.screenshot({ path: "artifacts/city-manual.png" });
  await expect(page.getByRole("textbox", { name: "City", exact: true })).toHaveValue("A Coruña");
});
