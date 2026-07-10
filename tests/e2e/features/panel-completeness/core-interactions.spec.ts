import { readFile } from "node:fs/promises";
import type { APIRequestContext, APIResponse, Download, Page } from "@playwright/test";
import { expect, test } from "../../core/fixtures/base.fixture";

interface ModelCatalogEntry {
	name: string;
	provider: string;
	additional_attributes?: Record<string, string>;
}

interface ModelDetailsResponse {
	models: ModelCatalogEntry[];
	total: number;
}

interface PricingOverrideEntry {
	id: string;
	name: string;
	scope_kind: string;
	provider_id?: string;
	provider_key_id?: string;
	virtual_key_id?: string;
	match_type: "exact" | "wildcard";
	pattern: string;
	request_types: string[];
	pricing_patch: string;
}

interface PricingOverridesResponse {
	pricing_overrides: PricingOverrideEntry[];
	count: number;
	total_count: number;
}

interface FeatureFlagEntry {
	id: string;
	registered: boolean;
	locked: boolean;
	enabled: boolean;
}

interface FeatureFlagsResponse {
	flags: FeatureFlagEntry[];
}

interface LLMLogEntry {
	id: string;
	content_summary?: string;
	cache_debug?: {
		cache_hit?: boolean;
		hit_type?: string;
	};
}

interface LLMLogsResponse {
	logs: LLMLogEntry[];
}

interface MCPLogEntry {
	id: string;
	tool_name: string;
	server_label: string;
	arguments?: string | Record<string, unknown>;
	status: string;
}

interface MCPLogsResponse {
	logs: MCPLogEntry[];
}

interface MCPClientEntry {
	config: {
		name: string;
		client_id: string;
	};
	state: string;
}

interface MCPClientsResponse {
	clients: MCPClientEntry[];
}

async function expectSuccessfulResponse(response: APIResponse, action: string): Promise<void> {
	expect(response.ok(), `${action} failed with HTTP ${response.status()}: ${await response.text()}`).toBe(true);
}

async function getJson<T>(request: APIRequestContext, url: string): Promise<T> {
	const response = await request.get(url);
	await expectSuccessfulResponse(response, `GET ${url}`);
	return (await response.json()) as T;
}

async function putJson(request: APIRequestContext, url: string, data: object): Promise<void> {
	const response = await request.put(url, { data });
	await expectSuccessfulResponse(response, `PUT ${url}`);
}

async function readDownload(download: Download): Promise<Buffer> {
	expect(await download.failure(), `Download ${download.suggestedFilename()} should succeed`).toBeNull();
	const path = await download.path();
	expect(path, `Download ${download.suggestedFilename()} should have a local path`).not.toBeNull();
	return await readFile(path!);
}

async function waitForResource(request: APIRequestContext, url: string): Promise<void> {
	await expect.poll(async () => (await request.get(url)).status(), { timeout: 15_000 }).toBe(200);
}

async function expectResourceDeleted(request: APIRequestContext, url: string): Promise<void> {
	await expect.poll(async () => (await request.get(url)).status(), { timeout: 15_000 }).toBe(404);
}

async function findLLMLogByContent(request: APIRequestContext, marker: string): Promise<LLMLogEntry | undefined> {
	const params = new URLSearchParams({ content_search: marker, limit: "10", offset: "0" });
	const response = await getJson<LLMLogsResponse>(request, `/api/logs?${params.toString()}`);
	return response.logs.find((entry) => entry.content_summary?.includes(marker));
}

async function findMCPLogByContent(request: APIRequestContext, marker: string): Promise<MCPLogEntry | undefined> {
	const params = new URLSearchParams({ content_search: marker, limit: "10", offset: "0" });
	const response = await getJson<MCPLogsResponse>(request, `/api/mcp-logs?${params.toString()}`);
	return response.logs.find((entry) => {
		const args = typeof entry.arguments === "string" ? entry.arguments : JSON.stringify(entry.arguments ?? {});
		return args.includes(marker);
	});
}

async function findLatestConnectedRunScopedMCPClient(request: APIRequestContext): Promise<MCPClientEntry> {
	const clientNamePrefix = "TestClient001_";
	const params = new URLSearchParams({ search: clientNamePrefix, state: "connected", limit: "100", offset: "0" });
	const response = await getJson<MCPClientsResponse>(request, `/api/mcp/clients?${params.toString()}`);
	const matches = response.clients
		.filter((client) => client.state === "connected" && client.config.name.startsWith(clientNamePrefix))
		.sort((left, right) => right.config.name.localeCompare(left.config.name));
	if (matches.length === 0) {
		throw new Error(
			`No connected run-scoped MCP client with prefix "${clientNamePrefix}" was found; global setup must create one before MCP Logs tests`,
		);
	}
	return matches[0];
}

async function getModelEntry(request: APIRequestContext, model: string, provider: string): Promise<ModelCatalogEntry> {
	const params = new URLSearchParams({ query: model, provider, limit: "10", unfiltered: "true" });
	const response = await getJson<ModelDetailsResponse>(request, `/api/models/details?${params.toString()}`);
	const entry = response.models.find((candidate) => candidate.name === model && candidate.provider === provider);
	expect(entry, `Expected ${provider}/${model} in model catalog response`).toBeDefined();
	return entry!;
}

async function findPricingOverride(request: APIRequestContext, name: string): Promise<PricingOverrideEntry | undefined> {
	const params = new URLSearchParams({ search: name, limit: "25", offset: "0" });
	const response = await getJson<PricingOverridesResponse>(request, `/api/governance/pricing-overrides?${params.toString()}`);
	return response.pricing_overrides.find((entry) => entry.name === name);
}

async function openModelAttributes(page: Page, model: string, providerLabel: string): Promise<void> {
	await page.getByTestId("model-catalog-tab-attributes").click();
	const searchInput = page.getByTestId("model-catalog-search-input");
	await expect(searchInput).toBeVisible();
	await searchInput.fill(model);
	await page.locator('[data-testid="model-catalog-provider-filter"]:visible').click();
	await page.getByRole("option", { name: providerLabel, exact: true }).click();
}

test.describe("panel core interactions", () => {
	test("Model Catalog overview, filters, search, and attribute edit persist through the API", async ({ page, request }) => {
		const model = "gpt-4o-mini";
		const provider = "openai";
		const providerLabel = "OpenAI";
		const rowKey = "gpt-4o-mini-openai";
		const marker = `panel-e2e-${Date.now()}`;
		const original = await getModelEntry(request, model, provider);
		const originalAttributes = original.additional_attributes;

		try {
			await page.goto("/workspace/model-catalog", { waitUntil: "domcontentloaded" });
			await expect(page.getByTestId("model-catalog-tab-overview")).toHaveAttribute("data-state", "active");
			for (const summary of ["Total Providers", "Total Models", "Total Requests (24h)", "Total Cost (24h)"]) {
				await expect(page.locator("p").filter({ hasText: summary })).toBeVisible();
			}

			await page.getByTestId("model-catalog-provider-trigger").click();
			await page.getByRole("option", { name: providerLabel, exact: true }).click();
			const overviewRows = page.locator("tbody tr");
			await expect(overviewRows).toHaveCount(1);
			await expect(overviewRows.first()).toContainText(providerLabel);

			await openModelAttributes(page, model, providerLabel);
			const modelRow = page.getByTestId(`model-catalog-row-${rowKey}`);
			await expect(modelRow).toBeVisible();
			await expect(modelRow).toContainText(model);
			await expect(page.getByTestId("model-catalog-attributes-table").locator("tbody tr")).toHaveCount(1);

			await page.getByTestId(`model-catalog-edit-${rowKey}`).click();
			const sheet = page.getByTestId("model-catalog-attribute-sheet");
			await expect(sheet).toBeVisible();
			await sheet.getByTestId("model-catalog-description-textarea").fill(`E2E catalog description ${marker}`);
			const newRowIndex = await sheet.locator('[data-testid^="model-catalog-attribute-key-"]').count();
			await sheet.getByTestId("model-catalog-add-attribute-row").click();
			await sheet.getByTestId(`model-catalog-attribute-key-${newRowIndex}`).fill("e2e_marker");
			await sheet.getByTestId(`model-catalog-attribute-value-${newRowIndex}`).fill(marker);
			await sheet.getByTestId("model-catalog-attribute-submit").click();
			await expect(page.getByText("Attributes saved", { exact: true })).toBeVisible();
			await expect(sheet).not.toBeVisible();

			await expect
				.poll(async () => (await getModelEntry(request, model, provider)).additional_attributes)
				.toMatchObject({ description: `E2E catalog description ${marker}`, e2e_marker: marker });

			await page.reload({ waitUntil: "domcontentloaded" });
			await openModelAttributes(page, model, providerLabel);
			await page.getByTestId(`model-catalog-edit-${rowKey}`).click();
			await expect(page.getByTestId("model-catalog-description-textarea")).toHaveValue(`E2E catalog description ${marker}`);
			const attributeKeys = page.locator('[data-testid^="model-catalog-attribute-key-"]');
			const inputValues = async () => await attributeKeys.evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
			await expect.poll(inputValues).toContain("e2e_marker");
			const markerIndex = (await inputValues()).indexOf("e2e_marker");
			await expect(page.getByTestId(`model-catalog-attribute-value-${markerIndex}`)).toHaveValue(marker);
		} finally {
			await putJson(request, "/api/models/catalog", [
				{
					model,
					provider,
					additional_attributes: originalAttributes,
				},
			]);
			const restored = await getModelEntry(request, model, provider);
			expect(restored.additional_attributes ?? {}).toEqual(originalAttributes ?? {});
		}
	});

	test("Pricing Overrides supports provider-scoped create, search, edit, pricing readback, and delete", async ({ page, request }) => {
		const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const name = `Panel E2E pricing ${suffix}`;
		const updatedName = `${name} updated`;
		let createdId: string | undefined;

		try {
			await page.goto("/workspace/custom-pricing/overrides", { waitUntil: "domcontentloaded" });
			await page.getByTestId("pricing-override-create-btn").click();
			await expect(page.getByRole("heading", { name: "Create Pricing Override" })).toBeVisible();
			await page.getByTestId("pricing-override-name-input").fill(name);

			await page.getByTestId("pricing-override-provider-select").click();
			await page.getByRole("option", { name: "OpenAI", exact: true }).click();
			await page.getByTestId("pricing-override-pattern-input").fill("gpt-4o-mini-e2e");

			await page.getByTestId("pricing-override-request-types-btn").click();
			await page.getByTestId("pricing-override-request-type-checkbox-chat_completion").click();
			await page.keyboard.press("Escape");

			await page.getByTestId("pricing-field-search").fill("input_cost_per_token");
			await page.getByTestId("pricing-field-activate-input_cost_per_token").click();
			await page.getByTestId("pricing-override-field-input-input_cost_per_token").fill("0.00000123");
			await page.getByTestId("pricing-override-save-btn").click();
			await expect(page.getByText("Pricing override created", { exact: true })).toBeVisible();

			await expect
				.poll(async () => await findPricingOverride(request, name))
				.toMatchObject({
					name,
					scope_kind: "provider",
					provider_id: "openai",
					match_type: "exact",
					pattern: "gpt-4o-mini-e2e",
					request_types: ["chat_completion"],
				});
			const created = await findPricingOverride(request, name);
			expect(created).toBeDefined();
			createdId = created!.id;
			expect(JSON.parse(created!.pricing_patch) as Record<string, number>).toEqual({ input_cost_per_token: 0.00000123 });

			const search = page.getByTestId("pricing-overrides-search-input");
			await search.fill(name);
			const createdRow = page.locator("tbody tr").filter({ hasText: name });
			await expect(createdRow).toHaveCount(1);
			await expect(createdRow).toContainText("Global");
			await expect(createdRow).toContainText("OpenAI");
			await expect(createdRow).toContainText("gpt-4o-mini-e2e");

			await page.getByTestId(`pricing-override-actions-btn-${createdId}`).click();
			await page.getByTestId(`pricing-override-edit-btn-${createdId}`).click();
			await expect(page.getByRole("heading", { name: "Edit Pricing Override" })).toBeVisible();
			await page.getByTestId("pricing-override-name-input").fill(updatedName);
			await page.getByTestId("pricing-override-pattern-input").fill("gpt-4o-mini-e2e-updated");
			await page.getByTestId("pricing-override-field-input-input_cost_per_token").fill("0.00000456");
			await page.getByTestId("pricing-override-save-btn").click();
			await expect(page.getByText("Pricing override updated", { exact: true })).toBeVisible();

			await expect
				.poll(async () => await findPricingOverride(request, updatedName))
				.toMatchObject({
					id: createdId,
					name: updatedName,
					scope_kind: "provider",
					provider_id: "openai",
					pattern: "gpt-4o-mini-e2e-updated",
				});
			const updated = await findPricingOverride(request, updatedName);
			expect(JSON.parse(updated!.pricing_patch) as Record<string, number>).toEqual({ input_cost_per_token: 0.00000456 });

			await search.fill(updatedName);
			await expect(page.locator("tbody tr").filter({ hasText: updatedName })).toHaveCount(1);
			await page.getByTestId(`pricing-override-actions-btn-${createdId}`).click();
			await page.getByTestId(`pricing-override-delete-btn-${createdId}`).click();
			await expect(page.getByText(`Are you sure you want to delete "${updatedName}"? This action cannot be undone.`, { exact: true })).toBeVisible();
			await page.getByTestId("pricing-override-delete-confirm-btn").click();
			await expect(page.getByText("Pricing override deleted", { exact: true })).toBeVisible();
			await expect.poll(async () => await findPricingOverride(request, updatedName)).toBeUndefined();
			createdId = undefined;
		} finally {
			if (createdId) {
				const response = await request.delete(`/api/governance/pricing-overrides/${encodeURIComponent(createdId)}`);
				if (!response.ok() && response.status() !== 404) {
					throw new Error(`Failed to clean pricing override ${createdId}: HTTP ${response.status()} ${await response.text()}`);
				}
			}
		}
	});

	test("Feature Flags exposes the authoritative empty-state when no runtime flags are registered", async ({ page, request }) => {
		const apiState = await getJson<FeatureFlagsResponse>(request, "/api/feature-flags");
		expect(apiState.flags).toEqual([]);

		await page.goto("/workspace/config/feature-flags", { waitUntil: "domcontentloaded" });
		await expect(page.getByTestId("feature-flags-table")).toBeVisible();
		await expect(page.getByTestId("feature-flags-table-empty-state")).toContainText("No feature flags found");
		await expect(page.locator('[data-testid^="feature-flag-toggle-"]')).toHaveCount(0);
	});

	test("Dashboard switches every analytics tab and exports complete CSV and PDF files", async ({ page }) => {
		test.setTimeout(150_000);
		await page.goto("/workspace/dashboard", { waitUntil: "domcontentloaded" });
		await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

		const tabs = [
			{ testId: "dashboard-tab-provider-usage", value: "provider-usage", content: "dashboard-provider-cost-chart-toggle" },
			{ testId: "dashboard-tab-rankings", value: "rankings", content: "dashboard-model-rankings-table" },
			{ testId: "dashboard-tab-mcp", value: "mcp", content: "dashboard-mcp-volume-chart-toggle" },
			{ testId: "dashboard-tab-team-rankings", value: "team-rankings", content: "dashboard-team-rankings-top-chart" },
			{ testId: "dashboard-tab-user-rankings", value: "user-rankings", content: "dashboard-user-rankings-top-chart" },
			{
				testId: "dashboard-tab-virtual-key-rankings",
				value: "virtual-key-rankings",
				content: "dashboard-virtual-key-rankings-top-chart",
			},
			{ testId: "dashboard-tab-customer-rankings", value: "customer-rankings", content: "dashboard-customer-rankings-top-chart" },
			{ testId: "dashboard-tab-bu-rankings", value: "bu-rankings", content: "dashboard-bu-rankings-top-chart" },
		] as const;

		for (const tab of tabs) {
			const trigger = page.getByTestId(tab.testId);
			await trigger.click();
			await expect(trigger).toHaveAttribute("data-state", "active");
			await expect(page).toHaveURL((url) => url.pathname === "/workspace/dashboard" && url.searchParams.get("tab") === tab.value);
			await expect(page.getByTestId(tab.content)).toBeVisible();
		}

		await page.getByTestId("dashboard-tab-overview").click();
		await expect(page.getByTestId("dashboard-volume-chart-toggle")).toBeVisible();

		await page.getByTestId("dashboard-export-trigger").click();
		const csvDownloadPromise = page.waitForEvent("download", { timeout: 60_000 });
		await page.getByTestId("export-csv-item").click();
		const csvDownload = await csvDownloadPromise;
		expect(csvDownload.suggestedFilename()).toMatch(/^dashboard-export.*\.csv$/);
		const csv = (await readDownload(csvDownload)).toString("utf8");
		expect(csv).toContain("# overview-volume");
		const csvHasProviderUsage = csv.includes("# provider-cost");
		const csvHasModelRankings = csv.includes("# model-rankings");

		await expect(page.getByTestId("dashboard-export-trigger")).toBeEnabled({ timeout: 30_000 });
		await page.getByTestId("dashboard-export-trigger").click();
		const pdfDownloadPromise = page.waitForEvent("download", { timeout: 90_000 });
		await page.getByTestId("export-pdf-item").click();
		const pdfDownload = await pdfDownloadPromise;
		expect(pdfDownload.suggestedFilename()).toMatch(/^dashboard-export.*\.pdf$/);
		const pdf = await readDownload(pdfDownload);
		expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
		expect(pdf.byteLength).toBeGreaterThan(1_000);
		expect(csvHasProviderUsage, "CSV export should include Provider Usage data").toBe(true);
		expect(csvHasModelRankings, "CSV export should include Model Rankings data").toBe(true);
	});

	test("LLM Logs filters direct-cache hits, exports JSON details, and deletes an owned log", async ({ page, request }) => {
		const marker = `panel-core-llm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		let logId: string | undefined;

		try {
			const createResponse = await request.post("/v1/chat/completions", {
				data: {
					model: "openai/gpt-4o-mini",
					messages: [{ role: "user", content: marker }],
				},
			});
			await expectSuccessfulResponse(createResponse, "create owned LLM log");
			await expect.poll(async () => await findLLMLogByContent(request, marker), { timeout: 15_000 }).toBeDefined();
			logId = (await findLLMLogByContent(request, marker))?.id;
			expect(logId, "Created inference should produce an owned LLM log").toBeTruthy();
			await waitForResource(request, `/api/logs/${encodeURIComponent(logId!)}`);

			await page.goto("/workspace/logs?period=1h&polling=false", { waitUntil: "domcontentloaded" });
			const cacheSection = page.getByTestId("local-caching-filter-toggle");
			await cacheSection.click();
			const directFilter = page.getByTestId("local-caching-filter-checkbox-direct").getByRole("checkbox");
			await directFilter.click();
			await expect(directFilter).toHaveAttribute("data-state", "checked");
			await expect(page).toHaveURL((url) => (url.searchParams.get("cache_hit_types") ?? "").includes("direct"));
			const directRows = page.getByTestId("logs-table").locator("tbody tr").filter({ hasNotText: /Listening|No results/i });
			await expect(directRows.first()).toBeVisible();
			await directRows.first().locator("td").first().click();
			const directSheet = page.locator('[data-slot="sheet-content"][data-state="open"]');
			await expect(directSheet.getByText("Direct Cache", { exact: true })).toBeVisible();
			await expect(directSheet.getByText("Caching Details (Hit)", { exact: true })).toBeVisible();

			await page.goto(`/workspace/logs?period=1h&polling=false&selected_log=${encodeURIComponent(logId!)}`, {
				waitUntil: "domcontentloaded",
			});
			const sheet = page.locator('[data-slot="sheet-content"][data-state="open"]');
			await expect(sheet).toContainText(marker);
			await sheet.getByTestId("logdetails-actions-button").click();
			const jsonDownloadPromise = page.waitForEvent("download");
			await page.getByTestId("logdetails-export-log-button").click();
			const jsonDownload = await jsonDownloadPromise;
			expect(jsonDownload.suggestedFilename()).toBe(`log-${logId}.json`);
			const exported = JSON.parse((await readDownload(jsonDownload)).toString("utf8")) as LLMLogEntry;
			expect(exported.id).toBe(logId);
			expect(exported.content_summary).toContain(marker);

			await sheet.getByTestId("logdetails-actions-button").click();
			await page.getByTestId("logdetails-delete-item").click();
			await expect(page.getByText("Are you sure you want to delete this log?", { exact: true })).toBeVisible();
			await page.getByTestId("logdetails-delete-confirm-button").click();
			await expectResourceDeleted(request, `/api/logs/${encodeURIComponent(logId!)}`);
			logId = undefined;
		} finally {
			if (logId) {
				const response = await request.delete("/api/logs", { data: { ids: [logId] } });
				if (!response.ok() && response.status() !== 404) {
					throw new Error(`Failed to clean LLM log ${logId}: HTTP ${response.status()} ${await response.text()}`);
				}
			}
		}
	});

	test("MCP Logs hydrates owned tool details, exports JSON, and deletes the log", async ({ page, request }) => {
		const marker = `panel-core-mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		let logId: string | undefined;

		try {
			const mcpClient = await findLatestConnectedRunScopedMCPClient(request);
			const clientName = mcpClient.config.name;
			const executeResponse = await request.post("/v1/mcp/tool/execute", {
				data: {
					id: marker,
					type: "function",
					index: 0,
					function: {
						name: `${clientName}-echo`,
						arguments: JSON.stringify({ message: marker }),
					},
				},
			});
			await expectSuccessfulResponse(executeResponse, "execute owned MCP tool call");
			await expect.poll(async () => await findMCPLogByContent(request, marker), { timeout: 15_000 }).toBeDefined();
			logId = (await findMCPLogByContent(request, marker))?.id;
			expect(logId, "Executed MCP tool should produce an owned MCP log").toBeTruthy();
			await waitForResource(request, `/api/mcp-logs/${encodeURIComponent(logId!)}`);

			await page.goto(`/workspace/mcp-logs?period=1h&polling=false&selected_log=${encodeURIComponent(logId!)}`, {
				waitUntil: "domcontentloaded",
			});
			const sheet = page.locator('[data-slot="sheet-content"][data-state="open"]');
			await expect(sheet).toContainText(`Request ID: ${logId}`);
			await expect(sheet.getByText("Arguments", { exact: true })).toBeVisible();
			await expect(sheet.getByText(marker, { exact: true })).toBeVisible();

			const actionsButton = sheet
				.getByRole("button")
				.filter({ has: sheet.locator("svg.lucide-more-vertical, svg.lucide-ellipsis-vertical") });
			await actionsButton.click();
			const jsonDownloadPromise = page.waitForEvent("download");
			await page.getByTestId("export-log-json").click();
			const jsonDownload = await jsonDownloadPromise;
			expect(jsonDownload.suggestedFilename()).toBe(`mcp-log-${logId}.json`);
			const exported = JSON.parse((await readDownload(jsonDownload)).toString("utf8")) as MCPLogEntry;
			expect(exported).toMatchObject({ id: logId, tool_name: "echo", server_label: clientName, status: "success" });

			await actionsButton.click();
			await page.getByRole("menuitem", { name: "Delete log", exact: true }).click();
			await expect(page.getByText("Are you sure you want to delete this log?", { exact: true })).toBeVisible();
			await page.getByRole("button", { name: "Delete", exact: true }).click();
			await expectResourceDeleted(request, `/api/mcp-logs/${encodeURIComponent(logId!)}`);
			logId = undefined;
		} finally {
			if (logId) {
				const response = await request.delete("/api/mcp-logs", { data: { ids: [logId] } });
				if (!response.ok() && response.status() !== 404) {
					throw new Error(`Failed to clean MCP log ${logId}: HTTP ${response.status()} ${await response.text()}`);
				}
			}
		}
	});
});
