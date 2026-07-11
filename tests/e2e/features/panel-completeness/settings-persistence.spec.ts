import type { APIRequestContext, APIResponse, Page } from "@playwright/test";
import { expect, test } from "../../core/fixtures/base.fixture";

interface CompatConfigSnapshot {
	convert_text_to_chat: boolean;
	convert_chat_to_responses: boolean;
	should_drop_params: boolean;
	should_convert_params: boolean;
}

interface ClientConfigSnapshot extends Record<string, unknown> {
	compat: CompatConfigSnapshot;
	mcp_tool_sync_interval: number;
	required_headers?: string[];
}

interface CoreConfigSnapshot extends Record<string, unknown> {
	client_config: ClientConfigSnapshot;
}

interface ComplexityConfigSnapshot {
	tier_boundaries: {
		simple_medium: number;
		medium_complex: number;
		complex_reasoning: number;
	};
	keywords: {
		simple_keywords: string[];
		code_keywords: string[];
		technical_keywords: string[];
		reasoning_keywords: string[];
	};
}

async function expectSuccessfulApiResponse(response: APIResponse, action: string): Promise<void> {
	expect(response.ok(), `${action} failed with HTTP ${response.status()}: ${await response.text()}`).toBe(true);
}

async function getJson<T>(request: APIRequestContext, url: string, headers?: Record<string, string>): Promise<T> {
	const response = await request.get(url, headers ? { headers } : undefined);
	await expectSuccessfulApiResponse(response, `GET ${url}`);
	return (await response.json()) as T;
}

async function putJson(request: APIRequestContext, url: string, data: object, headers?: Record<string, string>): Promise<void> {
	const response = await request.put(url, { data, headers });
	await expectSuccessfulApiResponse(response, `PUT ${url}`);
}

async function expectCheckedState(page: Page, testId: string, checked: boolean): Promise<void> {
	const control = page.getByTestId(testId);
	if (checked) {
		await expect(control).toBeChecked();
	} else {
		await expect(control).not.toBeChecked();
	}
}

function changedSimpleBoundary(original: ComplexityConfigSnapshot["tier_boundaries"]): number {
	const lowered = Number((original.simple_medium - 0.01).toFixed(2));
	if (lowered > 0) return lowered;
	return Number(((original.simple_medium + original.medium_complex) / 2).toFixed(3));
}

test.describe.serial("panel configuration save, reload, and restore", () => {
	test("Complexity Router persists a safe tier-boundary change", async ({ page, request }) => {
		const endpoint = "/api/governance/complexity-analyzer-config";
		const original = await getJson<ComplexityConfigSnapshot>(request, endpoint);
		const nextValue = changedSimpleBoundary(original.tier_boundaries);

		try {
			await page.goto("/workspace/complexity-router", { waitUntil: "domcontentloaded" });
			const input = page.getByTestId("complexity-router-boundary-simple-medium-input");
			await expect(input).toHaveValue(String(original.tier_boundaries.simple_medium));
			await input.fill(String(nextValue));

			const saveButton = page.getByTestId("complexity-router-save-changes-button");
			await expect(saveButton).toBeEnabled();
			await saveButton.click();
			await expect(page.getByText("Configuration saved", { exact: true })).toBeVisible();

			await page.reload({ waitUntil: "domcontentloaded" });
			await expect(page.getByTestId("complexity-router-boundary-simple-medium-input")).toHaveValue(String(nextValue));
		} finally {
			await putJson(request, endpoint, original);
			const restored = await getJson<ComplexityConfigSnapshot>(request, endpoint);
			// The backend canonicalizes and additively merges file-backed keyword
			// defaults on write. The test only changes tier boundaries, so prove the
			// edited state is restored without treating canonical keyword ordering as
			// an unrelated failure.
			expect(restored.tier_boundaries).toEqual(original.tier_boundaries);
		}
	});

	test("MCP Settings persists and restores the tool sync interval", async ({ page, request }) => {
		const endpoint = "/api/config?from_db=true";
		const updateEndpoint = "/api/config";
		const original = await getJson<CoreConfigSnapshot>(request, endpoint);
		const originalValue = original.client_config.mcp_tool_sync_interval;
		const nextValue = originalValue === 0 ? 1 : 0;

		try {
			await page.goto("/workspace/mcp-settings", { waitUntil: "domcontentloaded" });
			const input = page.getByTestId("mcp-tool-sync-interval-input");
			await expect(input).toHaveValue(String(originalValue));
			await input.fill(String(nextValue));

			const saveButton = page.getByTestId("mcp-settings-save-btn");
			await expect(saveButton).toBeEnabled();
			await saveButton.click();
			await expect(page.getByText("MCP settings updated successfully.", { exact: true })).toBeVisible();

			await page.reload({ waitUntil: "domcontentloaded" });
			await expect(page.getByTestId("mcp-tool-sync-interval-input")).toHaveValue(String(nextValue));
		} finally {
			await putJson(request, updateEndpoint, original);
			const restored = await getJson<CoreConfigSnapshot>(request, endpoint);
			expect(restored.client_config.mcp_tool_sync_interval).toBe(originalValue);
		}
	});

	test("Compatibility persists all four switches through refresh and restores the original state", async ({ page, request }) => {
		const endpoint = "/api/config?from_db=true";
		const updateEndpoint = "/api/config";
		const original = await getJson<CoreConfigSnapshot>(request, endpoint);
		const originalCompat = original.client_config.compat;
		const nextCompat: CompatConfigSnapshot = {
			convert_text_to_chat: !originalCompat.convert_text_to_chat,
			convert_chat_to_responses: !originalCompat.convert_chat_to_responses,
			should_drop_params: !originalCompat.should_drop_params,
			should_convert_params: !originalCompat.should_convert_params,
		};
		const controls = [
			["compat-convert-text-to-chat", "convert_text_to_chat"],
			["compat-convert-chat-to-responses", "convert_chat_to_responses"],
			["compat-should-drop-params", "should_drop_params"],
			["compat-should-convert-params", "should_convert_params"],
		] as const;

		try {
			await page.goto("/workspace/config/compatibility", { waitUntil: "domcontentloaded" });
			for (const [testId, field] of controls) {
				await expectCheckedState(page, testId, originalCompat[field]);
				await page.getByTestId(testId).click();
				await expectCheckedState(page, testId, nextCompat[field]);
			}

			const saveButton = page.getByTestId("compat-save-button");
			await expect(saveButton).toBeEnabled();
			await saveButton.click();
			await expect(page.getByText("Compatibility settings updated successfully.", { exact: true })).toBeVisible();

			await page.reload({ waitUntil: "domcontentloaded" });
			for (const [testId, field] of controls) {
				await expectCheckedState(page, testId, nextCompat[field]);
			}
			const persisted = await getJson<CoreConfigSnapshot>(request, endpoint);
			expect(persisted.client_config.compat).toEqual(nextCompat);
		} finally {
			await putJson(request, updateEndpoint, original);
			const restored = await getJson<CoreConfigSnapshot>(request, endpoint);
			expect(restored.client_config.compat).toEqual(originalCompat);
		}
	});

	test("Security persists required headers through refresh and API readback", async ({ page, request }) => {
		const endpoint = "/api/config?from_db=true";
		const updateEndpoint = "/api/config";
		const requiredHeaderName = `x-elygate-e2e-${Date.now()}`;
		const requiredHeaders = { [requiredHeaderName]: "present" };
		const original = await getJson<CoreConfigSnapshot>(request, endpoint);
		const originalRequiredHeaders = original.client_config.required_headers ?? [];

		try {
			await page.setExtraHTTPHeaders(requiredHeaders);
			await page.goto("/workspace/config/security", { waitUntil: "domcontentloaded" });
			const input = page.getByTestId("required-headers-textarea");
			await expect(input).toBeVisible();
			await input.fill(requiredHeaderName);

			const saveButton = page.getByTestId("security-save-button");
			await expect(saveButton).toBeEnabled();
			await saveButton.click();
			await expect(page.getByText("Security settings updated successfully.", { exact: true })).toBeVisible();

			await page.reload({ waitUntil: "domcontentloaded" });
			await expect(page.getByTestId("required-headers-textarea")).toHaveValue(requiredHeaderName);
			const persisted = await getJson<CoreConfigSnapshot>(request, endpoint, requiredHeaders);
			expect(persisted.client_config.required_headers).toEqual([requiredHeaderName]);
		} finally {
			await putJson(request, updateEndpoint, original, requiredHeaders);
			const restored = await getJson<CoreConfigSnapshot>(request, endpoint);
			expect(restored.client_config.required_headers ?? []).toEqual(originalRequiredHeaders);
		}
	});
});
