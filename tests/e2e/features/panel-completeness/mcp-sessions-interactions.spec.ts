import { expect, test } from "../../core/fixtures/base.fixture";

interface SessionRow {
	id: string;
	kind: "token" | "flow" | "header";
	auth_kind: "oauth" | "headers";
	auth_mode: "user" | "vk" | "session";
	status: "active" | "pending" | "needs_reauth" | "needs_update";
	created_at: string;
	can_reauth: boolean;
	mcp_client: { client_id: string; name: string };
	user_id?: string;
	user?: { id: string; name: string; email: string };
	virtual_key?: { id: string; name: string };
	session_id?: string;
}

const now = new Date().toISOString();

test.describe("MCP Sessions core interactions", () => {
	test("filters sessions, exposes row actions, completes a pending flow, and revokes headers", async ({ page }) => {
		let sessions: SessionRow[] = [
			{
				id: "token-alice",
				kind: "token",
				auth_kind: "oauth",
				auth_mode: "user",
				status: "active",
				created_at: now,
				can_reauth: true,
				mcp_client: { client_id: "alpha", name: "Alpha OAuth" },
				user_id: "user-alice",
				user: { id: "user-alice", name: "Alice Admin", email: "alice@example.com" },
			},
			{
				id: "header-team",
				kind: "header",
				auth_kind: "headers",
				auth_mode: "vk",
				status: "needs_update",
				created_at: now,
				can_reauth: true,
				mcp_client: { client_id: "beta", name: "Beta Headers" },
				virtual_key: { id: "vk-team", name: "Team Virtual Key" },
			},
			{
				id: "flow-pending",
				kind: "flow",
				auth_kind: "oauth",
				auth_mode: "session",
				status: "pending",
				created_at: now,
				can_reauth: false,
				mcp_client: { client_id: "pending", name: "Pending OAuth" },
				session_id: "browser-session-1",
			},
		];
		let revokedId = "";

		await page.route("**/api/mcp/sessions?**", async (route) => {
			const url = new URL(route.request().url());
			const q = (url.searchParams.get("q") ?? "").toLowerCase();
			const kinds = (url.searchParams.get("kind") ?? "").split(",").filter(Boolean);
			const statuses = (url.searchParams.get("status") ?? "").split(",").filter(Boolean);
			const modes = (url.searchParams.get("auth_mode") ?? "").split(",").filter(Boolean);
			const filtered = sessions.filter((row) => {
				const searchable = [row.mcp_client.name, row.user?.name, row.virtual_key?.name, row.session_id].filter(Boolean).join(" ").toLowerCase();
				return (!q || searchable.includes(q)) && (!kinds.length || kinds.includes(row.kind)) &&
					(!statuses.length || statuses.includes(row.status)) && (!modes.length || modes.includes(row.auth_mode));
			});
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ sessions: filtered, count: filtered.length, total_count: filtered.length, limit: 50, offset: 0 }),
			});
		});

		await page.route("**/api/mcp/sessions/*", async (route) => {
			const url = new URL(route.request().url());
			if (route.request().method() === "DELETE") {
				revokedId = url.pathname.split("/").at(-1) ?? "";
				sessions = sessions.filter((row) => row.id !== revokedId);
				await route.fulfill({ status: 204, body: "" });
				return;
			}
			await route.continue();
		});

		await page.goto("/workspace/mcp-sessions", { waitUntil: "domcontentloaded" });
		await expect(page.getByText("Alpha OAuth", { exact: true })).toBeVisible();
		await expect(page.getByText("Beta Headers", { exact: true })).toBeVisible();
		await expect(page.getByText("Pending OAuth", { exact: true })).toBeVisible();

		await page.getByTestId("mcp-sessions-search-input").fill("Beta");
		await expect(page).toHaveURL(/(?:\?|&)q=Beta(?:&|$)/);
		await expect(page.getByText("Beta Headers", { exact: true })).toBeVisible();
		await expect(page.getByText("Alpha OAuth", { exact: true })).toBeHidden();
		await page.getByTestId("mcp-sessions-clear-filters-btn").click();

		await page.getByTestId("mcp-sessions-kind-filter").click();
		await page.getByRole("option", { name: "Headers", exact: true }).click();
		await page.keyboard.press("Escape");
		await expect(page).toHaveURL(/(?:\?|&)kind=header(?:&|$)/);
		await expect(page.getByText("Beta Headers", { exact: true })).toBeVisible();
		await page.getByTestId("mcp-sessions-clear-filters-btn").click();

		await page.getByTestId("mcp-sessions-status-filter").click();
		await page.getByRole("option", { name: "Needs update", exact: true }).click();
		await page.keyboard.press("Escape");
		await page.getByTestId("mcp-sessions-auth-mode-filter").click();
		await page.getByRole("option", { name: "Virtual key", exact: true }).click();
		await page.keyboard.press("Escape");
		await expect(page).toHaveURL(/(?:\?|&)status=needs_update(?:&|$)/);
		await expect(page).toHaveURL(/(?:\?|&)auth_mode=vk(?:&|$)/);
		await page.getByTestId("mcp-sessions-clear-filters-btn").click();

		const headerRow = page.getByRole("row").filter({ hasText: "Beta Headers" });
		await headerRow.getByTestId("mcp-session-row-actions-header-team").click();
		await expect(page.getByTestId("mcp-session-edit-headers-menu-item")).toBeVisible();
		await page.getByTestId("mcp-session-revoke-menu-item").click();
		await expect(page.getByRole("heading", { name: "Revoke these stored header values?" })).toBeVisible();
		await page.getByTestId("mcp-session-revoke-confirm").click();
		await expect.poll(() => revokedId).toBe("header-team");
		await expect(page.getByText("Header values revoked", { exact: true })).toBeVisible();
		await expect(page.getByText("Beta Headers", { exact: true })).toBeHidden();

		const pendingRow = page.getByRole("row").filter({ hasText: "Pending OAuth" });
		await pendingRow.getByTestId("mcp-session-row-actions-flow-pending").click();
		await page.getByTestId("mcp-session-complete-auth-menu-item").click();
		await expect(page).toHaveURL(/\/workspace\/mcp-sessions\/auth\?flow=flow-pending$/);
	});

	test("moves between MCP session pages using the authoritative offset", async ({ page }) => {
		await page.route("**/api/mcp/sessions?**", async (route) => {
			const offset = Number(new URL(route.request().url()).searchParams.get("offset") ?? 0);
			const row: SessionRow = {
				id: offset === 0 ? "page-one" : "page-two",
				kind: "token",
				auth_kind: "oauth",
				auth_mode: "session",
				status: "active",
				created_at: now,
				can_reauth: true,
				mcp_client: { client_id: "paged", name: offset === 0 ? "Session Page One" : "Session Page Two" },
				session_id: offset === 0 ? "page-1" : "page-2",
			};
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ sessions: [row], count: 1, total_count: 51, limit: 50, offset }),
			});
		});

		await page.goto("/workspace/mcp-sessions", { waitUntil: "domcontentloaded" });
		await expect(page.getByText("Session Page One", { exact: true })).toBeVisible();
		await page.getByTestId("mcp-sessions-pagination-next-btn").click();
		await expect(page).toHaveURL(/(?:\?|&)offset=50(?:&|$)/);
		await expect(page.getByText("Session Page Two", { exact: true })).toBeVisible();
		await page.getByTestId("mcp-sessions-pagination-prev-btn").click();
		await expect(page).not.toHaveURL(/(?:\?|&)offset=50(?:&|$)/);
		await expect(page.getByText("Session Page One", { exact: true })).toBeVisible();
	});
});
