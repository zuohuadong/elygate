import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../../core/fixtures/base.fixture";
import { PANEL_ROUTE_CONTRACTS, PANEL_VIEWPORTS, type LocatorSpec } from "./route-manifest";

interface BrowserErrorLog {
	consoleErrors: string[];
	pageErrors: string[];
}

function startBrowserErrorLog(page: Page): BrowserErrorLog {
	const log: BrowserErrorLog = { consoleErrors: [], pageErrors: [] };
	page.on("console", (message) => {
		if (message.type() === "error") log.consoleErrors.push(message.text());
	});
	page.on("pageerror", (error) => log.pageErrors.push(error.message));
	return log;
}

function resolveLocator(page: Page, spec: LocatorSpec): Locator {
	switch (spec.kind) {
		case "testId":
			return page.getByTestId(spec.value);
		case "heading":
			return page.getByRole("heading", { name: spec.value });
		case "link":
			return page.getByRole("link", { name: spec.value });
		case "text":
			return page.getByText(spec.value, { exact: typeof spec.value === "string" });
	}
}

async function expectAnyVisible(page: Page, specs: readonly LocatorSpec[], message: string): Promise<void> {
	await expect
		.poll(async () => {
			for (const spec of specs) {
				if (await resolveLocator(page, spec).first().isVisible()) return true;
			}
			return false;
		}, { message })
		.toBe(true);
}

for (const viewport of PANEL_VIEWPORTS) {
	test.describe(`${viewport.name} panel route completeness`, () => {
		for (const route of PANEL_ROUTE_CONTRACTS) {
			test(`${route.name} is reachable and usable`, async ({ page }) => {
				await page.setViewportSize({ width: viewport.width, height: viewport.height });
				const browserErrors = startBrowserErrorLog(page);

				const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });
				expect(response, `${route.name} should return a navigation response`).not.toBeNull();
				expect(response?.ok(), `${route.name} should return a successful HTTP status`).toBe(true);
				await expect(page).toHaveURL((url) => url.pathname === route.path);
				await expect(page.locator("main")).toBeVisible();
				await expectAnyVisible(page, route.identity, `${route.name} should render its page identity`);
				await expectAnyVisible(page, route.primaryContent, `${route.name} should render usable primary content`);

				const viewportMetrics = await page.evaluate(() => ({
					clientWidth: document.documentElement.clientWidth,
					scrollWidth: document.documentElement.scrollWidth,
				}));
				expect(
					viewportMetrics.scrollWidth,
					`${route.name} must not introduce root-level horizontal scrolling at ${viewport.width}px`,
				).toBeLessThanOrEqual(viewportMetrics.clientWidth + 1);
				expect(browserErrors.pageErrors, `${route.name} emitted page errors`).toEqual([]);
				expect(browserErrors.consoleErrors, `${route.name} emitted console errors`).toEqual([]);
			});
		}
	});
}
