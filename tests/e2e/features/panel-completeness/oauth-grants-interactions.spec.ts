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

	test("filters grants, deep-links to auth sessions, and revokes the selected grant", async ({ page }) => {
		const now = new Date().toISOString();
		let deletedId = "";
		let grants = [
			{
				id: "grant-user",
				client_id: "client-user",
				client_name: "User Client",
				bf_mode: "user",
				bf_sub: "user-1",
				bf_sub_display: "Alice Admin",
				scope: "mcp:tools",
				created_at: now,
				last_used_at: now,
			},
			{
				id: "grant-vk",
				client_id: "client-vk",
				client_name: "Team Client",
				bf_mode: "vk",
				bf_sub: "vk-team",
				bf_sub_display: "Team Virtual Key",
				scope: "mcp:tools",
				created_at: now,
				last_used_at: now,
			},
		];

		await page.route("**/api/oauth2/sessions?**", async (route) => {
			const url = new URL(route.request().url());
			const q = (url.searchParams.get("q") ?? "").toLowerCase();
			const modes = (url.searchParams.get("bf_mode") ?? "").split(",").filter(Boolean);
			const filtered = grants.filter((grant) => {
				const searchable = `${grant.client_name} ${grant.bf_sub_display}`.toLowerCase();
				return (!q || searchable.includes(q)) && (!modes.length || modes.includes(grant.bf_mode));
			});
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ sessions: filtered, count: filtered.length, total_count: filtered.length, limit: 50, offset: 0 }),
			});
		});

		await page.route("**/api/oauth2/sessions/*", async (route) => {
			if (route.request().method() !== "DELETE") {
				await route.continue();
				return;
			}
			deletedId = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
			grants = grants.filter((grant) => grant.id !== deletedId);
			await route.fulfill({ status: 204, body: "" });
		});

		await page.goto("/workspace/oauth-grants", { waitUntil: "domcontentloaded" });
		await page.getByTestId("oauth-grants-search-input").fill("Team");
		await expect(page).toHaveURL(/(?:\?|&)q=Team(?:&|$)/);
		await expect(page.getByText("Team Client", { exact: true })).toBeVisible();
		await expect(page.getByText("User Client", { exact: true })).toBeHidden();
		await page.getByTestId("oauth-grants-clear-filters-btn").click();

		await page.getByTestId("oauth-grants-mode-filter").click();
		await page.getByRole("option", { name: "Virtual key", exact: true }).click();
		await page.keyboard.press("Escape");
		await expect(page).toHaveURL(/(?:\?|&)bf_mode=vk(?:&|$)/);
		await page.getByTestId("oauth-grants-clear-filters-btn").click();

		let grantRow = page.getByRole("row").filter({ hasText: "Team Client" });
		await grantRow.getByTestId("oauth-grants-actions-trigger").click();
		const sessionsLink = page.getByTestId("oauth-grants-view-sessions-link");
		await expect(sessionsLink).toHaveAttribute("href", "/workspace/mcp-sessions?auth_mode=vk&identity=vk-team");
		await sessionsLink.click();
		await expect(page).toHaveURL(/\/workspace\/mcp-sessions\?auth_mode=vk&identity=vk-team$/);

		await page.goto("/workspace/oauth-grants", { waitUntil: "domcontentloaded" });
		grantRow = page.getByRole("row").filter({ hasText: "Team Client" });
		await grantRow.getByTestId("oauth-grants-actions-trigger").click();
		await page.getByTestId("oauth-grants-revoke-action").click();
		await expect(page.getByRole("heading", { name: "Revoke this OAuth grant?" })).toBeVisible();
		await page.getByTestId("oauth-grants-revoke-confirm-btn").click();
		await expect.poll(() => deletedId).toBe("grant-vk");
		await expect(page.getByText("Grant revoked", { exact: true })).toBeVisible();
		await expect(page.getByText("Team Client", { exact: true })).toBeHidden();
	});

	test("moves between OAuth grant pages and restores the first page", async ({ page }) => {
		await page.route("**/api/oauth2/sessions?**", async (route) => {
			const offset = Number(new URL(route.request().url()).searchParams.get("offset") ?? 0);
			const label = offset === 0 ? "Grant Page One" : "Grant Page Two";
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					sessions: [{ id: `grant-${offset}`, client_id: `client-${offset}`, client_name: label, bf_mode: "session", bf_sub: `session-${offset}`, scope: "mcp:tools", created_at: new Date().toISOString() }],
					count: 1,
					total_count: 51,
					limit: 50,
					offset,
				}),
			});
		});

		await page.goto("/workspace/oauth-grants", { waitUntil: "domcontentloaded" });
		await expect(page.getByText("Grant Page One", { exact: true })).toBeVisible();
		await page.getByTestId("oauth-grants-next-page-btn").click();
		await expect(page).toHaveURL(/(?:\?|&)offset=50(?:&|$)/);
		await expect(page.getByText("Grant Page Two", { exact: true })).toBeVisible();
		await page.getByTestId("oauth-grants-prev-page-btn").click();
		await expect(page).not.toHaveURL(/(?:\?|&)offset=50(?:&|$)/);
		await expect(page.getByText("Grant Page One", { exact: true })).toBeVisible();
	});
});
