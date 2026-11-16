import { expect, test } from '../../core/fixtures/base.fixture'
import { expect as expectPoll } from '@playwright/test'

// An employee owns one dedicated virtual key. The copy action must hand out a bundle
// narrowed to that key's grants, so the import cannot advertise models, MCP servers or
// agents the key cannot reach.
const MOCK_EMPLOYEE = {
  id: 'emp-1',
  name: 'Alice Zhang',
  username: 'alice.zhang',
  department: 'Platform',
  job_title: 'Engineer',
  applications: 'trae',
  account_type: 'service',
  is_active: true,
  virtual_keys: [{ id: 'vk-1', name: 'alice-key' }],
}

const MOCK_VIRTUAL_KEY = {
  id: 'vk-1',
  name: 'alice-key',
  allow_all_providers: false,
  provider_configs: [{ provider: 'openai', allowed_models: ['gpt-4o'], blacklisted_models: [] }],
  mcp_configs: [{ mcp_client_name: 'github' }],
  agent_grants: [{ agent_name: 'researcher' }],
}

const MOCK_SOURCES = {
  models: {
    models: [
      { provider: 'openai', name: 'openai/gpt-4o' },
      { provider: 'openai', name: 'openai/gpt-4o-mini' },
      { provider: 'anthropic', name: 'anthropic/claude-sonnet-4' },
    ],
  },
  mcpClients: {
    clients: [
      { config: { name: 'github', connection_type: 'stdio', stdio_config: { command: 'npx', envs: ['GITHUB_TOKEN=ghp_e2e_secret'] } } },
      { config: { name: 'unassigned-docs', connection_type: 'stdio', stdio_config: { command: 'npx' } } },
    ],
    total_count: 2,
  },
  skills: { skills: [{ id: 'skill-1', name: 'docs' }], total: 1 },
  prompts: { prompts: [{ id: 'prompt-1', name: 'Code Review' }] },
  agents: { agents: [{ name: 'researcher', display_name: 'Researcher' }, { name: 'unassigned-writer', display_name: 'Writer' }] },
}

test.describe('AgentConfig deep link per employee', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

  test.beforeEach(async ({ page }) => {
    await page.route('**/api/employees**', (route) => route.fulfill({ json: { employees: [MOCK_EMPLOYEE] } }))
    await page.route('**/api/governance/virtual-keys/vk-1', (route) => route.fulfill({ json: MOCK_VIRTUAL_KEY }))
    await page.route('**/api/governance/virtual-keys', (route) => route.fulfill({ json: { virtual_keys: [{ id: 'vk-1', name: 'alice-key' }] } }))
    await page.route('**/api/models?*', (route) => route.fulfill({ json: MOCK_SOURCES.models }))
    await page.route('**/api/mcp/clients?*', (route) => route.fulfill({ json: MOCK_SOURCES.mcpClients }))
    await page.route('**/api/skills?*', (route) => route.fulfill({ json: MOCK_SOURCES.skills }))
    await page.route('**/api/prompt-repo/prompts', (route) => route.fulfill({ json: MOCK_SOURCES.prompts }))
    await page.route('**/api/agents', (route) => route.fulfill({ json: MOCK_SOURCES.agents }))

    await page.goto('/#/employees')
    // The panel keeps polling its dashboards, so networkidle never settles; wait for
    // the row the test drives instead.
    await expectPoll(page.getByTestId('employee-agent-config-emp-1')).toBeVisible()
  })

  test('copies a deep link limited to the key grants', async ({ page }) => {
    await page.getByTestId('employee-agent-config-emp-1').click()
    await expect(page.getByRole('status').filter({ hasText: /AgentConfig/ }).first()).toBeVisible()

    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboard.startsWith('agentconfig://import?v=1&bundle=')).toBe(true)
    // The bundle travels base64url-encoded, so the grants are only visible once decoded.
    const encoded = clipboard.slice('agentconfig://import?v=1&bundle='.length)
    const bundle = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    expect(bundle.trust).toBe('shared')
    expect(bundle.pub.models).toEqual([{ provider: 'openai', id: 'gpt-4o' }])
    expect(bundle.pub.mcp.map((entry: { name: string }) => entry.name)).toEqual(['github'])
    expect(bundle.pub.mcp[0].envKeys).toEqual(['GITHUB_TOKEN'])
    expect(bundle.pub.agents.map((entry: { id: string }) => entry.id)).toEqual(['researcher'])
    expect(JSON.stringify(bundle)).not.toContain('gpt-4o-mini')
    expect(JSON.stringify(bundle)).not.toContain('claude-sonnet-4')
    expect(clipboard).not.toContain('ghp_e2e_secret')
    expect(JSON.stringify(bundle)).not.toContain('ghp_e2e_secret')
  })

  test('refuses to copy when the bound key grants nothing reachable', async ({ page }) => {
    await page.route('**/api/governance/virtual-keys/vk-1', (route) =>
      route.fulfill({ json: { id: 'vk-1', name: 'alice-key', allow_all_providers: false, provider_configs: [], mcp_configs: [], agent_grants: [] } }),
    )
    await page.getByTestId('employee-agent-config-emp-1').click()
    await expect(page.getByText(/grants no models|没有可用的模型/)).toBeVisible()
  })
})