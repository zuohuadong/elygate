import { readFile } from 'fs/promises'
import { expect, test } from '../../core/fixtures/base.fixture'
import { waitForNetworkIdle } from '../../core/utils/test-helpers'

const MOCK_BUNDLE_SOURCES = {
  models: { models: [{ provider: 'openai', name: 'openai/gpt-4o' }] },
  mcpClients: {
    clients: [{
      config: {
        name: 'github',
        connection_type: 'stdio',
        stdio_config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], envs: ['GITHUB_TOKEN=ghp_e2e_secret'] },
      },
    }],
    total_count: 1,
  },
  skills: { skills: [{ id: 'skill-1', name: 'docs' }], total: 1 },
  prompts: { prompts: [{ id: 'prompt-1', name: 'Code Review' }] },
  agents: { agents: [{ name: 'researcher', display_name: 'Researcher' }] },
}

test.describe('AgentConfig bundle export', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/models?*', (route) => route.fulfill({ json: MOCK_BUNDLE_SOURCES.models }))
    await page.route('**/api/mcp/clients?*', (route) => route.fulfill({ json: MOCK_BUNDLE_SOURCES.mcpClients }))
    await page.route('**/api/skills?*', (route) => route.fulfill({ json: MOCK_BUNDLE_SOURCES.skills }))
    await page.route('**/api/prompt-repo/prompts', (route) => route.fulfill({ json: MOCK_BUNDLE_SOURCES.prompts }))
    await page.route('**/api/agents', (route) => route.fulfill({ json: MOCK_BUNDLE_SOURCES.agents }))

    await page.goto('/#/agent-config')
    await waitForNetworkIdle(page)
  })

  test('shows the public export preview', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /AgentConfig bundle|Agent 配置包/ })).toBeVisible()
    await expect(page.getByText('ACB v1 · shared')).toBeVisible()
    const preview = page.getByTestId('agentconfig-public-preview')
    await expect(preview).toContainText('gpt-4o')
    await expect(preview).toContainText('GITHUB_TOKEN')
  })

  test('downloads an ACB v1 file without secret values', async ({ page }) => {
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: /Download \.acfg|下载 \.acfg/ }).click()
    const download = await downloadPromise
    const filePath = await download.path()
    expect(filePath).not.toBeNull()
    const text = await readFile(filePath as string, 'utf8')
    const bundle = JSON.parse(text)

    expect(bundle.schema).toBe('agentconfig-bundle')
    expect(bundle.v).toBe(1)
    expect(bundle.trust).toBe('shared')
    expect(bundle.payload.alg).toBe('none')
    expect(bundle.pub.models).toEqual([{ provider: 'openai', id: 'gpt-4o' }])
    expect(bundle.pub.mcp[0].envKeys).toEqual(['GITHUB_TOKEN'])
    expect(bundle.pub.skills).toEqual([{ id: 'docs', enabled: true, order: 1 }])
    expect(text).not.toContain('ghp_e2e_secret')
  })
})