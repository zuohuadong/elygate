import type { Page } from '@playwright/test'
import { expect, test } from '../../core/fixtures/base.fixture'

const OSS_ENTERPRISE_MESSAGE = 'This capability requires the Elygate Enterprise source package and is not included in this OSS build.'

async function expectOssEnterpriseFallback(
  page: Page,
  options: {
    path: string
    expectedPath: RegExp
    heading: string
    sourceUnavailableTestId?: string
  },
): Promise<void> {
  await page.goto(options.path)
  await page.waitForLoadState('networkidle')
  await expect(page).toHaveURL(options.expectedPath)

  const main = page.getByRole('main')
  await expect(main.getByRole('heading', { name: options.heading, exact: true })).toBeVisible()
  if (options.sourceUnavailableTestId) {
    await expect(page.getByTestId(options.sourceUnavailableTestId)).toHaveText(OSS_ENTERPRISE_MESSAGE)
  } else {
    await expect(main.getByText(OSS_ENTERPRISE_MESSAGE, { exact: true })).toBeVisible()
  }

  // The OSS fallback currently exposes no docs CTA. Assert that boundary explicitly
  // so a URL-only check cannot pass while the page renders an unrelated shell.
  await expect(main.getByRole('button', { name: /Read more/i })).toHaveCount(0)
  await expect(main.getByRole('link', { name: /Read more/i })).toHaveCount(0)
}

test.describe('Placeholder and Enterprise Pages', () => {
  test('should load the functional prompt repository', async ({ page }) => {
    await page.goto('/workspace/prompt-repo')
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/workspace\/prompt-repo(?:\?.*)?$/)
    await expect(page.getByText(/Prompt repository is coming soon/i)).toHaveCount(0)
    await expect(page.getByText('Failed to load prompt repository', { exact: true })).toHaveCount(0)

    const emptyRepository = page.getByRole('heading', { name: 'Build, test, and version your prompts', exact: true })
    const populatedRepository = page.getByTestId('sidebar-search')
    await expect(emptyRepository.or(populatedRepository)).toBeVisible({ timeout: 10000 })

    if (await emptyRepository.isVisible()) {
      await expect(page.getByText(/Create prompts, test them with different models and parameters/i)).toBeVisible()
      await expect(page.getByTestId('empty-state-read-more')).toBeVisible()
      await expect(page.getByTestId('empty-state-create-prompt')).toBeVisible()
    }
  })

  test('should load alerting page', async ({ page }) => {
    await expectOssEnterpriseFallback(page, {
      path: '/workspace/alerting',
      expectedPath: /\/workspace\/alerting\/rules(?:\?.*)?$/,
      heading: 'Unlock alerting rules for proactive monitoring',
      sourceUnavailableTestId: 'alert-rules-source-unavailable',
    })
  })

  test('should load guardrails page', async ({ page }) => {
    await expectOssEnterpriseFallback(page, {
      path: '/workspace/guardrails',
      expectedPath: /\/workspace\/guardrails(?:\?.*)?$/,
      heading: 'Unlock guardrails for better security',
    })
  })

  test('should load audit-logs page', async ({ page }) => {
    await expectOssEnterpriseFallback(page, {
      path: '/workspace/audit-logs',
      expectedPath: /\/workspace\/audit-logs(?:\?.*)?$/,
      heading: 'Unlock audit logs for better compliance',
    })
  })

  test('should load cluster page', async ({ page }) => {
    await expectOssEnterpriseFallback(page, {
      path: '/workspace/cluster',
      expectedPath: /\/workspace\/cluster(?:\?.*)?$/,
      heading: 'Unlock cluster mode to scale reliably',
    })
  })

  test('should load custom-pricing page', async ({ page }) => {
    await page.goto('/workspace/custom-pricing')
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/workspace\/custom-pricing(?:\?.*)?$/)
    await expect(page.getByTestId('model-settings-view')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Model Settings', exact: true })).toBeVisible()
    await expect(page.getByTestId('pricing-datasheet-url-input')).toBeVisible()
  })

  test('should load rbac page', async ({ page }) => {
    await expectOssEnterpriseFallback(page, {
      path: '/workspace/rbac',
      expectedPath: /\/workspace\/governance\/rbac(?:\?.*)?$/,
      heading: 'Unlock roles and permissions for better security',
    })
  })

  test('should load scim page', async ({ page }) => {
    await expectOssEnterpriseFallback(page, {
      path: '/workspace/scim',
      expectedPath: /\/workspace\/scim(?:\?.*)?$/,
      heading: 'Unlock SCIM based access management for user provisioning',
    })
  })

  test('should load adaptive-routing page', async ({ page }) => {
    await expectOssEnterpriseFallback(page, {
      path: '/workspace/adaptive-routing',
      expectedPath: /\/workspace\/adaptive-routing(?:\?.*)?$/,
      heading: 'Unlock adaptive routing for better performance',
    })
  })

  test('should load guardrails configuration page', async ({ page }) => {
    await expectOssEnterpriseFallback(page, {
      path: '/workspace/guardrails/configuration',
      expectedPath: /\/workspace\/guardrails\/configuration(?:\?.*)?$/,
      heading: 'Unlock guardrails for better security',
    })
  })

  test('should load guardrails providers page', async ({ page }) => {
    await expectOssEnterpriseFallback(page, {
      path: '/workspace/guardrails/providers',
      expectedPath: /\/workspace\/guardrails\/providers(?:\?.*)?$/,
      heading: 'Unlock guardrails for better security',
    })
  })
})
