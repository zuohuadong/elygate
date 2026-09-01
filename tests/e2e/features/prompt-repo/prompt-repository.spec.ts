import type { APIRequestContext, APIResponse, Page } from "@playwright/test";
import { expect, test } from "../../core/fixtures/base.fixture";

interface PromptFolder {
	id: string;
	name: string;
	description?: string;
}

interface PromptRecord {
	id: string;
	name: string;
	folder_id?: string;
}

interface PromptMessageRecord {
	message: {
		payload?: {
			role?: string;
			content?: string | PromptMessageContentBlock[] | null;
		};
	};
}

interface PromptMessageContentBlock {
	type?: string;
	text?: unknown;
}

interface PromptSession {
	id: number;
	prompt_id: string;
	name: string;
	messages: PromptMessageRecord[];
}

interface PromptVersion {
	id: number;
	prompt_id: string;
	version_number: number;
	commit_message: string;
	messages: PromptMessageRecord[];
	is_latest: boolean;
}

interface FoldersResponse {
	folders: PromptFolder[];
}

interface PromptsResponse {
	prompts: PromptRecord[];
}

interface SessionsResponse {
	sessions: PromptSession[];
}

interface VersionsResponse {
	versions: PromptVersion[];
}

async function expectSuccessfulResponse(response: APIResponse, action: string): Promise<void> {
	expect(response.ok(), `${action} failed with HTTP ${response.status()}: ${await response.text()}`).toBe(true);
}

async function getJson<T>(request: APIRequestContext, url: string): Promise<T> {
	const response = await request.get(url);
	await expectSuccessfulResponse(response, `GET ${url}`);
	return (await response.json()) as T;
}

async function findFolder(request: APIRequestContext, name: string): Promise<PromptFolder | undefined> {
	const response = await getJson<FoldersResponse>(request, "/api/prompt-repo/folders");
	return response.folders.find((folder) => folder.name === name);
}

async function findPrompt(request: APIRequestContext, name: string): Promise<PromptRecord | undefined> {
	const response = await getJson<PromptsResponse>(request, "/api/prompt-repo/prompts");
	return response.prompts.find((prompt) => prompt.name === name);
}

function getUserMessageText(entry: PromptMessageRecord): string | undefined {
	const payload = entry.message.payload;
	if (payload?.role !== "user") return undefined;
	if (typeof payload.content === "string") return payload.content;
	if (!Array.isArray(payload.content)) return undefined;

	const textBlocks = payload.content.filter((block) => block.type === "text");
	if (textBlocks.length === 0 || textBlocks.some((block) => typeof block.text !== "string")) return undefined;
	return textBlocks.map((block) => block.text as string).join("");
}

async function cleanupPrompt(request: APIRequestContext, id: string | undefined): Promise<void> {
	if (!id) return;
	const response = await request.delete(`/api/prompt-repo/prompts/${encodeURIComponent(id)}`);
	if (!response.ok() && response.status() !== 404) {
		throw new Error(`Failed to clean prompt ${id}: HTTP ${response.status()} ${await response.text()}`);
	}
}

async function cleanupFolder(request: APIRequestContext, id: string | undefined): Promise<void> {
	if (!id) return;
	const response = await request.delete(`/api/prompt-repo/folders/${encodeURIComponent(id)}`);
	if (!response.ok() && response.status() !== 404) {
		throw new Error(`Failed to clean folder ${id}: HTTP ${response.status()} ${await response.text()}`);
	}
}

async function consumeToast(page: Page, message: string): Promise<void> {
	const toast = page.getByRole("listitem").filter({ has: page.getByText(message, { exact: true }) }).last();
	await expect(toast).toBeVisible();
	await toast.getByRole("button", { name: "Close toast" }).click();
	await expect(toast).toBeHidden();
}

async function openCreatePromptSheet(page: Page): Promise<void> {
	const firstPromptButton = page.getByTestId("empty-state-create-prompt");
	const sidebarCreateMenu = page.getByTestId("sidebar-create-menu");
	await expect(firstPromptButton.or(sidebarCreateMenu)).toBeVisible();
	if (await firstPromptButton.isVisible()) {
		await firstPromptButton.click();
		return;
	}
	await sidebarCreateMenu.click();
	await page.getByTestId("sidebar-create-prompt").click();
}

async function createPromptFromOpenSheet(page: Page, name: string): Promise<void> {
	await expect(page.getByRole("heading", { name: "Create Prompt" })).toBeVisible();
	await page.getByTestId("prompt-name-input").fill(name);
	await page.getByTestId("prompt-submit").click();
	await consumeToast(page, "Prompt created");
}

function splitButtonDropdown(page: Page, mainButtonTestId: string) {
	return page.getByTestId(mainButtonTestId).locator("xpath=following-sibling::button");
}

test.describe.serial("Prompt Repository core interactions", () => {
	test("creates, updates, versions, renames sessions, and deletes prompt repository resources", async ({ page, request }) => {
		test.setTimeout(120_000);
		const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const rootPromptName = `e2e-root-prompt-${suffix}`;
		const renamedRootPromptName = `${rootPromptName}-renamed`;
		const folderName = `e2e-folder-${suffix}`;
		const renamedFolderName = `${folderName}-renamed`;
		const nestedPromptName = `e2e-nested-prompt-${suffix}`;
		const renamedNestedPromptName = `${nestedPromptName}-renamed`;
		const sessionName = `e2e-session-${suffix}`;
		const userMessage = `Prompt repository message ${suffix}`;
		const commitMessage = `Commit prompt repository flow ${suffix}`;
		let rootPromptId: string | undefined;
		let folderId: string | undefined;
		let nestedPromptId: string | undefined;

		try {
			await page.goto("/workspace/prompt-repo", { waitUntil: "domcontentloaded" });

			await openCreatePromptSheet(page);
			await createPromptFromOpenSheet(page, rootPromptName);
			await expect.poll(async () => await findPrompt(request, rootPromptName)).toBeDefined();
			rootPromptId = (await findPrompt(request, rootPromptName))!.id;
			await expect(page.getByTestId(`sidebar-prompt-${rootPromptId}`)).toBeVisible();

			await page.getByTestId("new-message-textarea").fill(userMessage);
			await page.getByTestId("new-message-add").click();
			await expect(page.getByText(userMessage, { exact: true })).toBeVisible();
			await page.getByTestId("header-save-session").click();
			await expect(page.getByText("Session saved", { exact: true })).toBeVisible();

			await expect
				.poll(async () => (await getJson<SessionsResponse>(request, `/api/prompt-repo/prompts/${rootPromptId}/sessions`)).sessions)
				.toHaveLength(1);
			const session = (await getJson<SessionsResponse>(request, `/api/prompt-repo/prompts/${rootPromptId}/sessions`)).sessions[0];
			expect(session.messages.some((entry) => getUserMessageText(entry) === userMessage)).toBe(true);

			await splitButtonDropdown(page, "header-save-session").click();
			await page.getByTestId("session-rename").click();
			await page.getByTestId("session-rename-input").fill(sessionName);
			await page.getByTestId("session-rename-input").press("Enter");
			await expect
				.poll(async () => (await getJson<SessionsResponse>(request, `/api/prompt-repo/prompts/${rootPromptId}/sessions`)).sessions[0]?.name)
				.toBe(sessionName);
			await page.keyboard.press("Escape");

			await page.getByTestId("header-commit-version").click();
			await expect(page.getByRole("heading", { name: "Commit as Version" })).toBeVisible();
			await page.getByRole("button", { name: "Select all" }).click();
			await page.getByTestId("commit-version-message").fill(commitMessage);
			await page.getByTestId("commit-version-submit").click();
			await expect(page.getByText("Version committed", { exact: true })).toBeVisible();

			await expect
				.poll(async () => (await getJson<VersionsResponse>(request, `/api/prompt-repo/prompts/${rootPromptId}/versions`)).versions)
				.toHaveLength(1);
			const version = (await getJson<VersionsResponse>(request, `/api/prompt-repo/prompts/${rootPromptId}/versions`)).versions[0];
			expect(version).toMatchObject({ prompt_id: rootPromptId, version_number: 1, commit_message: commitMessage, is_latest: true });
			expect(version.messages.some((entry) => getUserMessageText(entry) === userMessage)).toBe(true);

			await page.getByTestId(`sidebar-prompt-actions-${rootPromptId}`).click();
			await page.getByTestId("prompt-action-rename").click();
			await page.getByTestId("prompt-name-input").fill(renamedRootPromptName);
			await page.getByTestId("prompt-submit").click();
			await expect(page.getByText("Prompt updated", { exact: true })).toBeVisible();
			await expect.poll(async () => (await findPrompt(request, renamedRootPromptName))?.id).toBe(rootPromptId);

			await page.getByTestId("sidebar-create-menu").click();
			await page.getByTestId("sidebar-create-folder").click();
			await expect(page.getByRole("heading", { name: "Create Folder" })).toBeVisible();
			await page.getByTestId("folder-name-input").fill(folderName);
			await page.getByTestId("folder-description-input").fill(`Folder description ${suffix}`);
			await page.getByTestId("folder-submit").click();
			await expect(page.getByText("Folder created", { exact: true })).toBeVisible();
			await expect.poll(async () => await findFolder(request, folderName)).toBeDefined();
			folderId = (await findFolder(request, folderName))!.id;

			await page.getByTestId(`sidebar-folder-actions-${folderId}`).click();
			await page.getByTestId("folder-action-edit").click();
			await page.getByTestId("folder-name-input").fill(renamedFolderName);
			await page.getByTestId("folder-description-input").fill(`Updated folder description ${suffix}`);
			await page.getByTestId("folder-submit").click();
			await expect(page.getByText("Folder updated", { exact: true })).toBeVisible();
			await expect.poll(async () => await findFolder(request, renamedFolderName)).toMatchObject({
				id: folderId,
				description: `Updated folder description ${suffix}`,
			});

			await page.getByTestId(`sidebar-folder-actions-${folderId}`).click();
			await page.getByTestId("folder-create-prompt").click();
			await createPromptFromOpenSheet(page, nestedPromptName);
			await expect.poll(async () => await findPrompt(request, nestedPromptName)).toBeDefined();
			nestedPromptId = (await findPrompt(request, nestedPromptName))!.id;
			expect((await findPrompt(request, nestedPromptName))!.folder_id).toBe(folderId);

			await page.getByTestId(`sidebar-prompt-actions-${nestedPromptId}`).click();
			await page.getByTestId("prompt-action-rename").click();
			await page.getByTestId("prompt-name-input").fill(renamedNestedPromptName);
			await page.getByTestId("prompt-submit").click();
			await expect(page.getByText("Prompt updated", { exact: true })).toBeVisible();
			await expect.poll(async () => (await findPrompt(request, renamedNestedPromptName))?.id).toBe(nestedPromptId);

			await page.getByTestId(`sidebar-prompt-actions-${nestedPromptId}`).click();
			await page.getByTestId("prompt-action-delete").click();
			await page.getByTestId("delete-prompt-confirm").click();
			await consumeToast(page, "Prompt deleted");
			await expect.poll(async () => (await request.get(`/api/prompt-repo/prompts/${nestedPromptId}`)).status()).toBe(404);
			nestedPromptId = undefined;

			await page.getByTestId(`sidebar-folder-actions-${folderId}`).click();
			await page.getByTestId("folder-action-delete").click();
			await page.getByTestId("delete-folder-confirm").click();
			await expect(page.getByText("Folder deleted", { exact: true })).toBeVisible();
			await expect.poll(async () => (await request.get(`/api/prompt-repo/folders/${folderId}`)).status()).toBe(404);
			folderId = undefined;

			await page.getByTestId(`sidebar-prompt-actions-${rootPromptId}`).click();
			await page.getByTestId("prompt-action-delete").click();
			await page.getByTestId("delete-prompt-confirm").click();
			await consumeToast(page, "Prompt deleted");
			await expect.poll(async () => (await request.get(`/api/prompt-repo/prompts/${rootPromptId}`)).status()).toBe(404);
			await expect.poll(async () => (await request.get(`/api/prompt-repo/sessions/${session.id}`)).status()).toBe(404);
			await expect.poll(async () => (await request.get(`/api/prompt-repo/versions/${version.id}`)).status()).toBe(404);
			rootPromptId = undefined;
		} finally {
			await cleanupPrompt(request, nestedPromptId);
			await cleanupFolder(request, folderId);
			await cleanupPrompt(request, rootPromptId);
		}
	});
});
