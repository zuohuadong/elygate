import type { APIRequestContext, Locator, Page } from '@playwright/test'
import { expect, test } from '../../core/fixtures/base.fixture'

const CACHE_PLUGIN_PATH = '/api/plugins/semantic_cache'
const liveCacheE2E = process.env.BIFROST_E2E_LIVE_CACHE === '1'
const runId = `${Date.now()}-${process.pid}`

interface CachePluginConfig {
  ttl?: number
  threshold?: number
  provider?: string
  embedding_model?: string
  dimension?: number
  conversation_history_threshold?: number
  exclude_system_prompt?: boolean
  cache_by_model?: boolean
  cache_by_provider?: boolean
  vector_store_namespace?: string
  default_cache_key?: string
}

interface CachePlugin {
  name: string
  enabled: boolean
  config: CachePluginConfig
  status?: {
    status?: string
  }
}

async function getCachePlugin(request: APIRequestContext): Promise<CachePlugin> {
  const response = await request.get(CACHE_PLUGIN_PATH)
  if (!response.ok()) {
    throw new Error(`GET ${CACHE_PLUGIN_PATH} failed: ${response.status()} ${await response.text()}`)
  }
  return (await response.json()) as CachePlugin
}

async function restoreCachePlugin(request: APIRequestContext, plugin: CachePlugin): Promise<void> {
  const deleteResponse = await request.delete(CACHE_PLUGIN_PATH)
  expect(deleteResponse.ok(), `Failed to remove semantic_cache before restore: ${deleteResponse.status()}`).toBe(true)

  const createResponse = await request.post('/api/plugins', {
    data: {
      name: plugin.name,
      path: '',
      enabled: plugin.enabled,
      config: plugin.config,
    },
  })
  expect(createResponse.ok(), `Failed to recreate semantic_cache: ${createResponse.status()} ${await createResponse.text()}`).toBe(true)
}

async function gotoCaching(page: Page): Promise<void> {
  await page.goto('/workspace/config/caching')
  await expect(page.getByTestId('caching-enable-switch')).toBeVisible()
}

async function isSwitchChecked(switchLocator: Locator): Promise<boolean> {
  return await switchLocator.getAttribute('data-state') === 'checked'
}

async function setSwitch(switchLocator: Locator, checked: boolean): Promise<void> {
  if (await isSwitchChecked(switchLocator) !== checked) {
    await switchLocator.click()
  }
  await expect(switchLocator).toHaveAttribute('data-state', checked ? 'checked' : 'unchecked')
}

async function enableCaching(page: Page): Promise<void> {
  const enableSwitch = page.getByTestId('caching-enable-switch')
  if (await isSwitchChecked(enableSwitch)) return

  await enableSwitch.click()
  await expect(page.locator('[data-sonner-toast][data-type="success"]').filter({ hasText: 'Local cache enabled' })).toBeVisible()
  await expect(enableSwitch).toHaveAttribute('data-state', 'checked')
}

async function selectOpenAI(page: Page): Promise<void> {
  await page.getByTestId('caching-provider-select').click()
  await page.getByRole('option', { name: /^OpenAI$/i }).click()
}

async function selectEmbeddingModel(page: Page, model: string): Promise<void> {
  const input = page.locator('#embedding_model')
  await input.fill(model)
  const createOption = page.getByRole('option', { name: `Create "${model}"` })
  await expect(createOption).toBeVisible()
  await createOption.click()
  await expect(page.getByTestId('caching-embedding-model-select')).toContainText(model)
}

async function saveCacheConfig(page: Page): Promise<void> {
  const saveButton = page.getByTestId('caching-save-button')
  await expect(saveButton).toBeEnabled()
  await saveButton.click()
  await expect(page.locator('[data-sonner-toast][data-type="success"]').filter({ hasText: 'Cache configuration updated' })).toBeVisible()
  await expect(saveButton).toBeDisabled()
}

test.describe('Caching Settings (live vector store)', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!liveCacheE2E, 'Set BIFROST_E2E_LIVE_CACHE=1 to run stateful cache panel tests')
  test.setTimeout(90000)

  let originalPlugin: CachePlugin | undefined

  test.beforeAll(async ({ request }) => {
    originalPlugin = await getCachePlugin(request)
    expect(originalPlugin.name).toBe('semantic_cache')
  })

  test.afterAll(async ({ request }) => {
    if (!originalPlugin) return

    await restoreCachePlugin(request, originalPlugin)

    const restored = await getCachePlugin(request)
    expect(restored.enabled).toBe(originalPlugin.enabled)
    expect(restored.config).toEqual(originalPlugin.config)
  })

  test.beforeEach(async ({ page }) => {
    await gotoCaching(page)
  })

  test('shows the Caching heading and all direct-mode controls', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Caching', exact: true })).toBeVisible()
    await expect(page.getByTestId('caching-enable-switch')).toBeEnabled()
    await expect(page.getByTestId('caching-mode-direct-tab')).toBeVisible()
    await expect(page.getByTestId('caching-mode-semantic-tab')).toBeEnabled()
    await expect(page.getByTestId('caching-ttl-input')).toBeVisible()
    await expect(page.getByTestId('caching-vector-store-namespace-input')).toBeVisible()
    await expect(page.getByTestId('caching-default-cache-key-input')).toBeVisible()
    await expect(page.getByTestId('caching-conversation-history-threshold-input')).toBeVisible()
    await expect(page.getByTestId('caching-exclude-system-prompt-switch')).toBeVisible()
    await expect(page.getByTestId('caching-cache-by-model-switch')).toBeVisible()
    await expect(page.getByTestId('caching-cache-by-provider-switch')).toBeVisible()
    await expect(page.getByTestId('caching-save-button')).toBeVisible()
  })

  test('saves direct-only fields and persists them after reload', async ({ page, request }) => {
    const namespace = `elygate-e2e-direct-${runId}`
    const defaultCacheKey = `direct-${runId}`

    await enableCaching(page)
    await page.getByTestId('caching-mode-direct-tab').click()
    await expect(page.getByTestId('caching-mode-direct-tab')).toHaveAttribute('data-state', 'active')

    await page.getByTestId('caching-ttl-input').fill('347')
    await page.getByTestId('caching-vector-store-namespace-input').fill(namespace)
    await page.getByTestId('caching-default-cache-key-input').fill(defaultCacheKey)
    await page.getByTestId('caching-conversation-history-threshold-input').fill('7')
    await setSwitch(page.getByTestId('caching-exclude-system-prompt-switch'), true)
    await setSwitch(page.getByTestId('caching-cache-by-model-switch'), false)
    await setSwitch(page.getByTestId('caching-cache-by-provider-switch'), true)

    await saveCacheConfig(page)

    const plugin = await getCachePlugin(request)
    expect(plugin.enabled).toBe(true)
    expect(plugin.config).toMatchObject({
      ttl: 347,
      threshold: 0.8,
      dimension: 1,
      conversation_history_threshold: 7,
      exclude_system_prompt: true,
      cache_by_model: false,
      cache_by_provider: true,
      vector_store_namespace: namespace,
      default_cache_key: defaultCacheKey,
    })
    expect(plugin.config.provider ?? '').toBe('')
    expect(plugin.config.embedding_model ?? '').toBe('')

    await page.reload()
    await expect(page.getByTestId('caching-mode-direct-tab')).toHaveAttribute('data-state', 'active')
    await expect(page.getByTestId('caching-ttl-input')).toHaveValue('347')
    await expect(page.getByTestId('caching-vector-store-namespace-input')).toHaveValue(namespace)
    await expect(page.getByTestId('caching-default-cache-key-input')).toHaveValue(defaultCacheKey)
    await expect(page.getByTestId('caching-conversation-history-threshold-input')).toHaveValue('7')
    await expect(page.getByTestId('caching-exclude-system-prompt-switch')).toHaveAttribute('data-state', 'checked')
    await expect(page.getByTestId('caching-cache-by-model-switch')).toHaveAttribute('data-state', 'unchecked')
    await expect(page.getByTestId('caching-cache-by-provider-switch')).toHaveAttribute('data-state', 'checked')
  })

  test('disables and re-enables direct caching with matching API status', async ({ page, request }) => {
    await enableCaching(page)
    await page.getByTestId('caching-mode-direct-tab').click()

    const enableSwitch = page.getByTestId('caching-enable-switch')
    await enableSwitch.click()
    await expect(page.locator('[data-sonner-toast][data-type="success"]').filter({ hasText: 'Local cache disabled' })).toBeVisible()
    await expect(enableSwitch).toHaveAttribute('data-state', 'unchecked')
    await expect.poll(async () => (await getCachePlugin(request)).enabled).toBe(false)

    await enableSwitch.click()
    await expect(page.locator('[data-sonner-toast][data-type="success"]').filter({ hasText: 'Local cache enabled' })).toBeVisible()
    await expect(enableSwitch).toHaveAttribute('data-state', 'checked')
    await expect.poll(async () => (await getCachePlugin(request)).enabled).toBe(true)

    const plugin = await getCachePlugin(request)
    expect(plugin.config.dimension).toBe(1)
    expect(plugin.status?.status).toBe('active')
  })

  test('requires provider, model, and dimension in semantic mode', async ({ page }) => {
    await enableCaching(page)
    await page.getByTestId('caching-mode-semantic-tab').click()

    const saveButton = page.getByTestId('caching-save-button')
    await expect(page.getByText('Pick an embedding provider for semantic mode, or switch to Direct only.')).toBeVisible()
    await expect(saveButton).toBeDisabled()

    await selectOpenAI(page)
    await expect(page.getByText('Pick an embedding model for semantic mode.')).toBeVisible()
    await expect(saveButton).toBeDisabled()

    await selectEmbeddingModel(page, 'text-embedding-3-small')
    await expect(page.getByText("Semantic mode requires the embedding model's real dimension (must be > 1).")).toBeVisible()
    await expect(saveButton).toBeDisabled()
  })

  test('saves semantic configuration and persists it after reload', async ({ page, request }) => {
    const namespace = `elygate-e2e-semantic-${runId}`
    const freshDirectNamespace = `elygate-e2e-direct-after-semantic-${runId}`
    const model = 'text-embedding-3-small'

    await enableCaching(page)
    await page.getByTestId('caching-mode-semantic-tab').click()
    await selectOpenAI(page)
    await selectEmbeddingModel(page, model)
    await page.getByTestId('caching-dimension-input').fill('1536')
    await page.getByTestId('caching-threshold-input').fill('0.83')
    await page.getByTestId('caching-vector-store-namespace-input').fill(namespace)

    await saveCacheConfig(page)

    const plugin = await getCachePlugin(request)
    expect(plugin.enabled).toBe(true)
    expect(plugin.status?.status).toBe('active')
    expect(plugin.config).toMatchObject({
      provider: 'openai',
      embedding_model: model,
      dimension: 1536,
      threshold: 0.83,
      vector_store_namespace: namespace,
    })

    await page.reload()
    await expect(page.getByTestId('caching-mode-semantic-tab')).toHaveAttribute('data-state', 'active')
    await expect(page.getByTestId('caching-provider-select')).toContainText('OpenAI')
    await expect(page.getByTestId('caching-embedding-model-select')).toContainText(model)
    await expect(page.getByTestId('caching-dimension-input')).toHaveValue('1536')
    await expect(page.getByTestId('caching-threshold-input')).toHaveValue('0.83')
    await expect(page.getByTestId('caching-vector-store-namespace-input')).toHaveValue(namespace)

    await page.getByTestId('caching-mode-direct-tab').click()
    await expect(page.getByText('Changing cache mode, embedding provider, model, or dimension requires a fresh vector store namespace.')).toBeVisible()
    await expect(page.getByTestId('caching-save-button')).toBeDisabled()

    await page.getByTestId('caching-vector-store-namespace-input').fill(freshDirectNamespace)
    await saveCacheConfig(page)

    const directPlugin = await getCachePlugin(request)
    expect(directPlugin.config.dimension).toBe(1)
    expect(directPlugin.config.provider ?? '').toBe('')
    expect(directPlugin.config.embedding_model ?? '').toBe('')
    expect(directPlugin.config.vector_store_namespace).toBe(freshDirectNamespace)

    await page.reload()
    await expect(page.getByTestId('caching-mode-direct-tab')).toHaveAttribute('data-state', 'active')
    await expect(page.getByTestId('caching-vector-store-namespace-input')).toHaveValue(freshDirectNamespace)
  })
})
