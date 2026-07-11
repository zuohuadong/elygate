import type { APIResponse } from "@playwright/test";
import { expect, test } from "../../core/fixtures/base.fixture";

interface MCPLibraryEntry {
	id: number;
	slug: string;
	name: string;
}

interface CreateMCPLibraryEntryResponse {
	entry: MCPLibraryEntry;
}

interface ListMCPLibraryEntriesResponse {
	servers: MCPLibraryEntry[];
}

async function expectSuccessfulResponse(response: APIResponse, action: string): Promise<void> {
	expect(response.ok(), `${action} failed with HTTP ${response.status()}: ${await response.text()}`).toBe(true);
}

test.describe("MCP Library install defaults", () => {
	test("preserves per-user auth scope and required header keys from a custom library entry", async ({ page, request }) => {
		const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const entryName = `E2E required headers ${suffix}`;
		const requiredHeaderKeys = ["X-API-Key", "X-Tool-Token"];
		let entry: MCPLibraryEntry | undefined;

		try {
			const createResponse = await request.post("/api/mcp/library", {
				data: {
					name: entryName,
					description: "Run-scoped E2E fixture for MCP Library install defaults.",
					category: "E2E",
					connection_type: "http",
					connection_url: "http://127.0.0.1:65535/mcp",
					auth_type: "per_user_headers",
					required_header_keys: requiredHeaderKeys,
					tags: ["e2e", "per-user-headers"],
				},
			});
			await expectSuccessfulResponse(createResponse, "Create MCP Library fixture");
			entry = ((await createResponse.json()) as CreateMCPLibraryEntryResponse).entry;
			expect(entry.id).toBeGreaterThan(0);

			await page.addInitScript(() => {
				window.localStorage.setItem("mcp-library-view-mode", "table");
			});
			await page.goto("/workspace/mcp-registry/library", { waitUntil: "domcontentloaded" });
			await page.getByTestId("mcp-library-search-input").fill(entryName);

			const row = page.getByTestId(`mcp-library-table-row-${entry.slug}`);
			await expect(row).toBeVisible();
			await page.getByTestId(`mcp-library-table-install-${entry.slug}`).click();

			await expect(page.getByRole("heading", { name: "Install MCP server" })).toBeVisible();
			await expect(page.getByTestId("library-auth-type-select")).toContainText("Headers");
			await expect.soft(page.getByTestId("library-auth-scope-select")).toContainText("Per-User");
			await expect.soft(page.getByTestId("library-per-user-header-keys-textarea")).toHaveValue(requiredHeaderKeys.join(", "));
		} finally {
			if (entry) {
				const deleteResponse = await request.delete(`/api/mcp/library/${entry.id}`);
				if (!deleteResponse.ok() && deleteResponse.status() !== 404) {
					throw new Error(`Failed to clean MCP Library fixture ${entry.id}: HTTP ${deleteResponse.status()} ${await deleteResponse.text()}`);
				}
			}
		}
	});

	test("publishes a custom server from the UI, switches views, searches, and removes it", async ({ page, request }) => {
		const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const entryName = `E2E UI Library ${suffix}`;
		let entry: MCPLibraryEntry | undefined;

		try {
			await page.addInitScript(() => {
				window.localStorage.setItem("mcp-library-view-mode", "table");
			});
			await page.goto("/workspace/mcp-registry/library", { waitUntil: "domcontentloaded" });
			await page.getByTestId("mcp-library-add-server-btn").click();
			await expect(page.getByRole("heading", { name: "Add MCP Server" })).toBeVisible();
			await page.getByTestId("mcp-add-name-input").fill(entryName);
			await page.getByTestId("mcp-add-description-input").fill("Published through the real Elygate panel flow.");
			await page.getByTestId("mcp-add-url-input").fill("http://127.0.0.1:65535/mcp");
			await page.getByTestId("mcp-add-category-input").fill("E2E");
			await page.getByTestId("mcp-add-tags-input").fill("e2e, ui-published");
			await page.getByTestId("mcp-add-submit-btn").click();
			await expect(page.getByText("MCP server published to the library.", { exact: true })).toBeVisible();

			await page.getByTestId("mcp-library-search-input").fill(entryName);
			const listResponse = await request.get(`/api/mcp/library?search=${encodeURIComponent(entryName)}&limit=10&offset=0`);
			await expectSuccessfulResponse(listResponse, "Read UI-created MCP Library entry");
			const listed = (await listResponse.json()) as ListMCPLibraryEntriesResponse;
			entry = listed.servers.find((server) => server.name === entryName);
			expect(entry, "UI-created MCP Library entry was not returned by the API").toBeDefined();

			const row = page.getByTestId(`mcp-library-table-row-${entry!.slug}`);
			await expect(row).toContainText(entryName);
			await expect(row).toContainText("Custom");

			await page.getByTestId("mcp-library-grid-view-toggle").click();
			await expect(page.getByTestId(`mcp-library-card-${entry!.slug}`)).toBeVisible();
			await page.getByTestId("mcp-library-table-view-toggle").click();
			await expect(row).toBeVisible();

			await row.hover();
			await page.getByTestId(`mcp-library-table-delete-${entry!.slug}`).click();
			await expect(page.getByRole("heading", { name: `Remove "${entryName}" from library?` })).toBeVisible();
			await page.getByTestId("mcp-library-table-delete-confirm").click();
			await expect(page.getByText(`"${entryName}" removed from the library.`, { exact: true })).toBeVisible();
			await expect(row).toBeHidden();
			entry = undefined;
		} finally {
			if (entry) {
				const deleteResponse = await request.delete(`/api/mcp/library/${entry.id}`);
				if (!deleteResponse.ok() && deleteResponse.status() !== 404) {
					throw new Error(`Failed to clean UI-created MCP Library fixture ${entry.id}: HTTP ${deleteResponse.status()} ${await deleteResponse.text()}`);
				}
			}
		}
	});
});
