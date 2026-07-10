import { readFile } from "node:fs/promises";
import type { APIRequestContext, APIResponse, Download, Page } from "@playwright/test";
import { expect, test } from "../../core/fixtures/base.fixture";

interface SkillFile {
	path: string;
	source_type: string;
	content?: string;
	mime_type: string;
}

interface SkillRecord {
	id: string;
	name: string;
	description: string;
	skill_md_body: string;
	latest_version: string;
	highest_version: string;
	files: SkillFile[];
}

interface SkillListItem {
	id: string;
	name: string;
	latest_version: string;
	highest_version: string;
}

interface SkillsResponse {
	skills: SkillListItem[];
	total: number;
}

interface SkillResponse {
	skill: SkillRecord;
}

interface SkillVersionSummary {
	id: string;
	version: string;
}

interface SkillVersionsResponse {
	versions: SkillVersionSummary[];
	total: number;
}

async function expectSuccessfulResponse(response: APIResponse, action: string): Promise<void> {
	expect(response.ok(), `${action} failed with HTTP ${response.status()}: ${await response.text()}`).toBe(true);
}

async function getJson<T>(request: APIRequestContext, url: string): Promise<T> {
	const response = await request.get(url);
	await expectSuccessfulResponse(response, `GET ${url}`);
	return (await response.json()) as T;
}

async function findSkill(request: APIRequestContext, name: string): Promise<SkillListItem | undefined> {
	const query = new URLSearchParams({ search: name, limit: "25", offset: "0" });
	const response = await getJson<SkillsResponse>(request, `/api/skills?${query.toString()}`);
	return response.skills.find((skill) => skill.name === name);
}

async function cleanupSkill(request: APIRequestContext, id: string | undefined): Promise<void> {
	if (!id) return;
	const response = await request.delete(`/api/skills/${encodeURIComponent(id)}`);
	if (!response.ok() && response.status() !== 404) {
		throw new Error(`Failed to clean skill ${id}: HTTP ${response.status()} ${await response.text()}`);
	}
}

async function replaceMonacoContents(page: Page, value: string): Promise<void> {
	const editor = page.locator(".monaco-editor").last();
	await expect(editor).toBeVisible();
	await editor.click();
	await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
	await page.keyboard.insertText(value);
}

async function addTextFile(page: Page, filename: string, content: string): Promise<void> {
	await page.getByRole("button", { name: "Actions for root" }).click();
	await page.getByRole("menuitem", { name: "Add file" }).hover();
	await page.getByRole("menuitem", { name: "From text" }).click();
	await page.getByTestId("skill-file-filename-input").fill(filename);
	await page.getByTestId("skill-file-confirm-btn").click();
	await expect(page.getByTestId("skill-file-content-textarea")).toBeVisible();
	await page.getByTestId("skill-file-content-textarea").fill(content);
}

async function readDownload(download: Download): Promise<Buffer> {
	expect(await download.failure(), `Download ${download.suggestedFilename()} should succeed`).toBeNull();
	const path = await download.path();
	expect(path, `Download ${download.suggestedFilename()} should have a local path`).not.toBeNull();
	return await readFile(path!);
}

test.describe.serial("Skills Repository core interactions", () => {
	test("creates a skill with files, saves and lists a new version, shifts serving, downloads, and deletes", async ({ page, request }) => {
		test.setTimeout(150_000);
		const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const skillName = `e2e-skill-${suffix}`;
		const initialDescription = `Initial skill description ${suffix}`;
		const updatedDescription = `Updated skill description ${suffix}`;
		const initialBody = `# Initial instructions\n\nUse the initial workflow ${suffix}.`;
		const updatedBody = `# Updated instructions\n\nUse the updated workflow ${suffix}.`;
		const updatedHeading = "Updated instructions";
		const filename = `workflow-${suffix}.txt`;
		const initialFileContent = `initial file content ${suffix}`;
		const updatedFileContent = `updated file content ${suffix}`;
		let skillId: string | undefined;

		try {
			await page.goto("/workspace/skills-repo", { waitUntil: "domcontentloaded" });
			await page.getByTestId("skill-create-btn").click();
			await expect(page.getByTestId("skill-name-input")).toBeVisible();
			await page.getByTestId("skill-name-input").fill(skillName);
			await page.getByTestId("skill-description-input").fill(initialDescription);
			await page.getByText("SKILL.md", { exact: true }).click();
			await replaceMonacoContents(page, initialBody);
			await addTextFile(page, filename, initialFileContent);

			await page.getByTestId("skill-create-save-btn").click();
			await expect(page.getByText("Create skill", { exact: true })).toBeVisible();
			await page.getByTestId("skill-version-input").fill("1.0.0");
			await page.getByTestId("skill-version-confirm-btn").click();
			await expect(page.getByText("Skill created successfully", { exact: true })).toBeVisible();

			await expect.poll(async () => await findSkill(request, skillName)).toBeDefined();
			skillId = (await findSkill(request, skillName))!.id;
			const created = (await getJson<SkillResponse>(request, `/api/skills/${skillId}`)).skill;
			expect(created).toMatchObject({
				name: skillName,
				description: initialDescription,
				skill_md_body: initialBody,
				latest_version: "1.0.0",
				highest_version: "1.0.0",
			});
			expect(created.files).toContainEqual(
				expect.objectContaining({ path: filename, source_type: "text", content: initialFileContent, mime_type: "text/plain" }),
			);
			const initialFileResponse = await request.get(`/api/skills/serve/${encodeURIComponent(skillName)}/files/${encodeURIComponent(filename)}`);
			await expectSuccessfulResponse(initialFileResponse, "download initial skill file");
			expect(await initialFileResponse.text()).toBe(initialFileContent);

			await page.getByTestId("skill-add-version-btn").click();
			await expect(page.getByTestId("skill-description-input")).toBeVisible();
			await page.getByTestId("skill-description-input").fill(updatedDescription);
			await page.getByText("SKILL.md", { exact: true }).click();
			await replaceMonacoContents(page, updatedBody);
			await page.getByText(filename, { exact: true }).click();
			await expect(page.getByTestId("skill-file-content-textarea")).toBeVisible();
			await page.getByTestId("skill-file-content-textarea").fill(updatedFileContent);

			await page.getByTestId("skill-save-btn").click();
			await expect(page.getByText("Save new version", { exact: true })).toBeVisible();
			await page.getByTestId("skill-version-input").fill("1.1.0");
			await page.getByTestId("skill-version-confirm-btn").click();
			await expect(page.getByText("Version saved successfully", { exact: true })).toBeVisible();

			const currentBeforeShift = (await getJson<SkillResponse>(request, `/api/skills/${skillId}`)).skill;
			expect(currentBeforeShift.latest_version).toBe("1.0.0");
			expect(currentBeforeShift.highest_version).toBe("1.1.0");
			const versions = await getJson<SkillVersionsResponse>(request, `/api/skills/${skillId}/versions?limit=25&offset=0`);
			expect(versions.total).toBe(2);
			expect(versions.versions.map((version) => version.version)).toEqual(expect.arrayContaining(["1.0.0", "1.1.0"]));

			const stagedVersion = (await getJson<SkillResponse>(request, `/api/skills/${skillId}?version=1.1.0`)).skill;
			expect(stagedVersion).toMatchObject({
				description: updatedDescription,
				skill_md_body: updatedBody,
				latest_version: "1.1.0",
			});
			expect(stagedVersion.files).toContainEqual(expect.objectContaining({ path: filename, content: updatedFileContent }));

			await page.getByTestId("skill-versions-popover-trigger").click();
			await page.getByTestId("skill-versions-search-input").fill("1.1.0");
			const stagedOption = page.getByTestId("skill-version-option").filter({ hasText: "1.1.0" });
			await expect(stagedOption).toHaveCount(1);
			await stagedOption.click();
			await expect(page.getByRole("heading", { name: "Version 1.1.0" })).toBeVisible();
			await expect(page.getByText(updatedDescription, { exact: true })).toBeVisible();
			await expect(page.getByText(updatedHeading, { exact: true })).toBeVisible();
			await page.getByTestId("skill-version-shift-btn").click();
			await expect(page.getByText("Shifted to version 1.1.0", { exact: true })).toBeVisible();
			await expect.poll(async () => (await getJson<SkillResponse>(request, `/api/skills/${skillId}`)).skill.latest_version).toBe("1.1.0");

			const servedFileResponse = await request.get(`/api/skills/serve/${encodeURIComponent(skillName)}/files/${encodeURIComponent(filename)}`);
			await expectSuccessfulResponse(servedFileResponse, "download shifted skill file");
			expect(await servedFileResponse.text()).toBe(updatedFileContent);

			await page.getByRole("button", { name: `Actions for ${skillName}` }).click();
			const downloadPromise = page.waitForEvent("download");
			await page.getByRole("menuitem", { name: "Download ZIP" }).click();
			const zip = await readDownload(await downloadPromise);
			expect(zip.length).toBeGreaterThan(100);

			await page.getByRole("button", { name: `Actions for ${skillName}` }).click();
			await page.getByRole("menuitem", { name: "Delete" }).click();
			await expect(page.getByRole("heading", { name: `Delete ${skillName}?` })).toBeVisible();
			await page.getByRole("button", { name: "Delete skill" }).click();
			await expect(page.getByText("Skill deleted", { exact: true })).toBeVisible();
			await expect.poll(async () => (await request.get(`/api/skills/${skillId}`)).status()).toBe(404);
			skillId = undefined;
		} finally {
			await cleanupSkill(request, skillId);
		}
	});
});
