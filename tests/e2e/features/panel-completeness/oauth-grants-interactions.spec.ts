import { expect, test } from "../../core/fixtures/base.fixture";

test.describe.serial("OAuth Grants core interactions", () => {
	test("uses the configured access-token TTL when displaying grant expiry", async ({ page }) => {
		const configuredTtlSeconds = 120;

		await page.route("**/api/config?**", async (route) => {
			const response = await route.fetch();
			const config = await response.json();
			config.client_config ??= {};
			config.client_config.oauth2_server_config ??= {};
			config.client_config.oauth2_server_config.access_token_ttl = configuredTtlSeconds;
			await route.fulfill({ response, json: config });
		});

		const now = new Date().toISOString();
		const clientName = `TTL Test Client ${Date.now()}`;
		await page.route("**/api/oauth2/sessions?**", async (route) => {
			const url = new URL(route.request().url());
			if (url.pathname !== "/api/oauth2/sessions") {
				await route.continue();
				return;
			}

			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					sessions: [
						{
							id: `ttl-grant-${Date.now()}`,
							client_id: "ttl-test-client",
							client_name: clientName,
							bf_mode: "session",
							bf_sub: "ttl-test-session",
							scope: "mcp:tools",
							created_at: now,
							last_used_at: now,
						},
					],
					count: 1,
					total_count: 1,
					limit: 50,
					offset: 0,
				}),
			});
		});

		await page.goto("/workspace/oauth-grants", { waitUntil: "domcontentloaded" });
		const grantRow = page.getByRole("row").filter({ hasText: clientName });
		await expect(grantRow).toBeVisible();
		await expect(grantRow.getByText("in 2 min", { exact: true })).toBeVisible();
	});
});
