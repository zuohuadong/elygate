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

// The detail endpoint wraps the key and nests each MCP client under mcp_client, which
// is the shape the panel actually receives.
const MOCK_VIRTUAL_KEY = {
  virtual_key: {
    id: 'vk-1',
    name: 'alice-key',
    is_active: true,
    allow_all_providers: false,
    provider_configs: [{ provider: 'openai', allow_all_keys: true, allowed_models: ['gpt-4o'], blacklisted_models: ['regex:^gpt-4o-mini$'] }],
    mcp_configs: [
      { mcp_client: { name: 'github' }, tools_to_execute: ['*'] },
      { mcp_client: { name: 'partially-granted' }, tools_to_execute: ['read_file'] },
    ],
    agent_grants: [{ agent_name: 'researcher' }],
  },
  virtual_mcp_ids: [],
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
      { config: { client_id: 'client-github', name: 'github', connection_type: 'stdio', tools_to_execute: ['*'], stdio_config: { command: 'npx', args: ['--api-key', 'sk-e2e-secret-value'], envs: ['GITHUB_TOKEN=ghp_e2e_secret'] } } },
      { config: { client_id: 'client-partial', name: 'partially-granted', connection_type: 'stdio', tools_to_execute: ['*'], stdio_config: { command: 'npx' } } },
      { config: { client_id: 'client-docs', name: 'unassigned-docs', connection_type: 'stdio', tools_to_execute: ['*'], stdio_config: { command: 'npx' } } },
    ],
    total_count: 3,
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
    expect(bundle.pub.mcp[0].args).toEqual([])
    expect(bundle.pub.agents.map((entry: { id: string }) => entry.id)).toEqual(['researcher'])
    const serialized = JSON.stringify(bundle)
    expect(serialized).not.toContain('gpt-4o-mini')
    expect(serialized).not.toContain('claude-sonnet-4')
    expect(serialized).not.toContain('partially-granted')
    expect(serialized).not.toContain('unassigned-docs')
    expect(serialized).not.toContain('unassigned-writer')
    expect(serialized).not.toContain('ghp_e2e_secret')
    expect(serialized).not.toContain('sk-e2e-secret-value')
  })

  test('refuses to copy when the bound key grants nothing reachable', async ({ page }) => {
    await page.route('**/api/governance/virtual-keys/vk-1', (route) =>
      route.fulfill({ json: { virtual_key: { id: 'vk-1', name: 'alice-key', is_active: true, allow_all_providers: false, provider_configs: [], mcp_configs: [], agent_grants: [] } } }),
    )
    await page.getByTestId('employee-agent-config-emp-1').click()
    await expect(page.getByText(/grants no models|没有可用的模型/)).toBeVisible()
  })

  test('refuses to copy for a disabled key', async ({ page }) => {
    await page.route('**/api/governance/virtual-keys/vk-1', (route) =>
      route.fulfill({ json: { virtual_key: { ...MOCK_VIRTUAL_KEY.virtual_key, is_active: false } } }),
    )
    await page.getByTestId('employee-agent-config-emp-1').click()
    await expect(page.getByText(/virtual key is disabled|虚拟密钥已停用/)).toBeVisible()
  })

  test('downloads the bundle when the clipboard write is refused', async ({ page }) => {
    // The clipboard object exists and still rejects the write (permission, insecure
    // context, policy), so the fallback has to hang off the write, not its presence.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('denied')) },
      })
    })
    await page.reload()
    await expectPoll(page.getByTestId('employee-agent-config-emp-1')).toBeVisible()

    const downloadPromise = page.waitForEvent('download')
    await page.getByTestId('employee-agent-config-emp-1').click()
    const download = await downloadPromise
    expect(download.suggestedFilename().endsWith('.acfg')).toBe(true)
    await expect(page.getByRole('status').filter({ hasText: /Downloaded|已改为下载/ })).toBeVisible()
  })

  test('still delivers for a key whose only grant is an assigned virtual MCP', async ({ page }) => {
    await page.route('**/api/governance/virtual-keys/vk-1', (route) =>
      route.fulfill({ json: { virtual_key: { id: 'vk-1', name: 'alice-key', is_active: true, allow_all_providers: false, provider_configs: [], mcp_configs: [], agent_grants: [] }, virtual_mcp_ids: [12] } }),
    )
    await page.route('**/api/mcp/virtual-mcps/12', (route) =>
      route.fulfill({ json: { virtual_mcp: { id: 12, name: 'team-tools', enabled: true, tools: [{ mcp_client_id: 'client-github', tool_names: ['github-read'] }] } } }),
    )
    await page.getByTestId('employee-agent-config-emp-1').click()
    await expect(page.getByText(/no models, MCP servers or agents|没有可用的模型/)).toHaveCount(0)
    await expect(page.getByRole('status').filter({ hasText: /AgentConfig/ })).toBeVisible()
    // The delivered bundle really is this key's: global skills/prompts, no MCP client,
    // because the access comes from the virtual MCP rather than the key's own config.
    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboard.startsWith('agentconfig://import?v=1&bundle=')).toBe(true)
    const bundle = JSON.parse(Buffer.from(clipboard.slice('agentconfig://import?v=1&bundle='.length), 'base64url').toString('utf8'))
    expect(bundle.pub.mcp).toEqual([])
    expect(bundle.pub.skills.map((entry: { id: string }) => entry.id)).toEqual(['docs'])
    expect(bundle.pub.models).toEqual([])
  })

  test('an assigned virtual MCP whose source client is unusable grants nothing', async ({ page }) => {
    await page.route('**/api/governance/virtual-keys/vk-1', (route) =>
      route.fulfill({ json: { virtual_key: { id: 'vk-1', name: 'alice-key', is_active: true, allow_all_providers: false, provider_configs: [], mcp_configs: [], agent_grants: [] }, virtual_mcp_ids: [12] } }),
    )
    await page.route('**/api/mcp/virtual-mcps/12', (route) =>
      route.fulfill({ json: { virtual_mcp: { id: 12, name: 'team-tools', enabled: true, tools: [{ mcp_client_id: 'client-disabled', tool_names: ['github-read'] }] } } }),
    )
    // The source client is disabled, so nothing in that virtual MCP resolves.
    await page.route('**/api/mcp/clients?*', (route) => route.fulfill({ json: {
      clients: [{ config: { client_id: 'client-disabled', name: 'client-disabled', connection_type: 'stdio', disabled: true, tools_to_execute: ['*'] } }],
      total_count: 1,
    } }))
    await page.route('**/api/agents', (route) => route.fulfill({ json: { agents: [] } }))
    await page.route('**/api/models?*', (route) => route.fulfill({ json: { models: [] } }))
    await page.getByTestId('employee-agent-config-emp-1').click()
    await expect(page.getByText(/grants no models|没有可用的模型/)).toBeVisible()
  })

  test('an assigned virtual MCP whose source client has no tool grant grants nothing', async ({ page }) => {
    await page.route('**/api/governance/virtual-keys/vk-1', (route) =>
      route.fulfill({ json: { virtual_key: { id: 'vk-1', name: 'alice-key', is_active: true, allow_all_providers: false, provider_configs: [], mcp_configs: [], agent_grants: [] }, virtual_mcp_ids: [12] } }),
    )
    await page.route('**/api/mcp/virtual-mcps/12', (route) =>
      route.fulfill({ json: { virtual_mcp: { id: 12, name: 'team-tools', enabled: true, tools: [{ mcp_client_id: 'client-empty', tool_names: ['github-read'] }] } } }),
    )
    // No tools_to_execute at all: callers reach nothing from this client.
    await page.route('**/api/mcp/clients?*', (route) => route.fulfill({ json: {
      clients: [{ config: { client_id: 'client-empty', name: 'client-empty', connection_type: 'stdio', stdio_config: { command: 'npx' } } }],
      total_count: 1,
    } }))
    await page.route('**/api/agents', (route) => route.fulfill({ json: { agents: [] } }))
    await page.route('**/api/models?*', (route) => route.fulfill({ json: { models: [] } }))
    await page.getByTestId('employee-agent-config-emp-1').click()
    await expect(page.getByText(/grants no models|没有可用的模型/)).toBeVisible()
  })

  test('says the virtual MCP could not be read instead of claiming no grant', async ({ page }) => {
    await page.route('**/api/governance/virtual-keys/vk-1', (route) =>
      route.fulfill({ json: { virtual_key: { id: 'vk-1', name: 'alice-key', is_active: true, allow_all_providers: false, provider_configs: [], mcp_configs: [], agent_grants: [] }, virtual_mcp_ids: [12] } }),
    )
    await page.route('**/api/mcp/virtual-mcps/12', (route) => route.fulfill({ status: 500, json: { error: 'boom' } }))
    await page.getByTestId('employee-agent-config-emp-1').click()
    await expect(page.getByText(/virtual MCPs assigned to this key could not be read|无法读取该密钥分配的虚拟 MCP/)).toBeVisible()
    await expect(page.getByText(/grants no models|没有可用的模型/)).toHaveCount(0)
  })

  test('names the failed source instead of claiming the key grants nothing', async ({ page }) => {
    // The key's only real grant is a model, and the model source is the one that fails:
    // reporting "no grants" here would be wrong, the panel cannot know.
    await page.route('**/api/models?*', (route) => route.fulfill({ status: 503, json: { error: 'unavailable' } }))
    await page.route('**/api/mcp/clients?*', (route) => route.fulfill({ json: { clients: [], total_count: 0 } }))
    await page.route('**/api/agents', (route) => route.fulfill({ json: { agents: [] } }))
    await page.getByTestId('employee-agent-config-emp-1').click()
    await expect(page.getByText(/failed to load|读取失败/)).toBeVisible()
    await expect(page.getByText(/grants no models|没有可用的模型/)).toHaveCount(0)
  })
})