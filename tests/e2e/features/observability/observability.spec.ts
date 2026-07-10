import { expect, test } from '../../core/fixtures/base.fixture'

test.describe('Observability', () => {
  test.beforeEach(async ({ observabilityPage }) => {
    await observabilityPage.goto()
  })

  test.describe('Navigation', () => {
    test('should display observability page', async ({ observabilityPage }) => {
      // Check for the sidebar section header "Providers" (exact match to avoid strict mode)
      const providersHeader = observabilityPage.page.locator('.text-muted-foreground').filter({ hasText: 'Providers' }).first()
      await expect(providersHeader).toBeVisible()
    })

    test('should display OTel connector tab', async ({ observabilityPage }) => {
      await expect(observabilityPage.getConnectorTab('otel')).toBeVisible()
    })

    test('should display Maxim connector tab', async ({ observabilityPage }) => {
      await expect(observabilityPage.getConnectorTab('maxim')).toBeVisible()
    })

    test('should display Datadog connector tab', async ({ observabilityPage }) => {
      await expect(observabilityPage.getConnectorTab('datadog')).toBeVisible()
    })
  })

  test.describe('OTel Connector', () => {
    test('should select OTel connector', async ({ observabilityPage }) => {
      await observabilityPage.selectConnector('otel')

      // Should see OTel-specific content - check for metrics label or input
      const metricsVisible = await observabilityPage.isMetricsEndpointVisible()
      expect(metricsVisible).toBe(true)
    })

    test('should display metrics endpoint', async ({ observabilityPage }) => {
      await observabilityPage.selectConnector('otel')

      // The metrics endpoint is in an input field with value containing /metrics
      await observabilityPage.enableMetricsExport()
      const metricsValue = await observabilityPage.getMetricsEndpointValue()
      const metricsInput = observabilityPage.page.getByPlaceholder(/v1\/metrics|otel-collector.*metrics/i)
      const placeholder = await metricsInput.getAttribute('placeholder').catch(() => null)
      const hasMetrics =
        (metricsValue != null && metricsValue.includes('/metrics')) ||
        (placeholder != null && placeholder.includes('/metrics'))
      expect(hasMetrics).toBe(true)
    })

    test('should toggle OTel connector', async ({ observabilityPage }) => {
      await observabilityPage.selectConnector('otel')

      // Check if toggle is enabled (not disabled)
      const isToggleEnabled = await observabilityPage.isToggleEnabled('otel')

      if (!isToggleEnabled) {
        test.skip(true, 'OTel toggle is disabled (requires configuration)')
        return
      }

      const initialState = await observabilityPage.isConnectorEnabled('otel')

      const toggled = await observabilityPage.toggleConnector('otel')
      expect(toggled).toBe(true)

      // Verify toggle state flipped; poll briefly in case UI updates async (form can reset from refetch)
      await expect
        .poll(async () => observabilityPage.isConnectorEnabled('otel'), { timeout: 3000 })
        .toBe(!initialState)

      // Keep this stateful form test isolated: return the unsaved toggle to its original value.
      await observabilityPage.toggleConnector('otel')
      await expect.poll(async () => observabilityPage.isConnectorEnabled('otel')).toBe(initialState)
    })

    test('should display OTel delete button when connector is configured', async ({ observabilityPage }) => {
      await observabilityPage.selectConnector('otel')

      const deleteBtn = observabilityPage.getConnectorDeleteBtn('otel')
      const isVisible = await deleteBtn.isVisible().catch(() => false)

      if (!isVisible) {
        test.skip(true, 'OTel delete button not visible (connector may not be configured)')
        return
      }

      await expect(deleteBtn).toBeVisible()
    })

    test('should configure OTel endpoint', async ({ observabilityPage }) => {
      await observabilityPage.selectConnector('otel')

      const endpointInput = observabilityPage.page.getByPlaceholder(/otel-collector/i)

      const isVisible = await endpointInput.isVisible().catch(() => false)

      if (!isVisible) {
        // Skip if endpoint input not available
        test.skip(true, 'OTel endpoint input not available')
        return
      }

      const testEndpoint = 'http://test-otel-collector:4317'
      await endpointInput.clear()
      await endpointInput.fill(testEndpoint)

      const value = await endpointInput.inputValue()
      expect(value).toBe(testEndpoint)
    })
  })

  test.describe('Maxim Connector', () => {
    test('should select Maxim connector', async ({ observabilityPage }) => {
      await observabilityPage.selectConnector('maxim')

      // Verify Maxim is selected by checking aria-current
      const selected = await observabilityPage.getSelectedConnector()
      expect(selected).toContain('Maxim')
    })

    test('should toggle Maxim connector', async ({ observabilityPage }) => {
      await observabilityPage.selectConnector('maxim')

      // Check if toggle is enabled
      const isToggleEnabled = await observabilityPage.isToggleEnabled('maxim')

      if (!isToggleEnabled) {
        test.skip(true, 'Maxim toggle is disabled (requires configuration)')
        return
      }

      const initialState = await observabilityPage.isConnectorEnabled('maxim')

      const toggled = await observabilityPage.toggleConnector('maxim')
      expect(toggled).toBe(true)

      const newState = await observabilityPage.isConnectorEnabled('maxim')
      expect(newState).toBe(!initialState)

      await observabilityPage.toggleConnector('maxim')
      await expect.poll(async () => observabilityPage.isConnectorEnabled('maxim')).toBe(initialState)
    })

    test('should display Maxim configuration form', async ({ observabilityPage }) => {
      await observabilityPage.selectConnector('maxim')

      // Should see a form with configuration elements
      const form = observabilityPage.page.locator('form')
      const formVisible = await form.isVisible().catch(() => false)
      if (formVisible) {
        const hasInputs = await form.locator('input').first().isVisible().catch(() => false)
        const hasSwitches = await form.locator('button[role="switch"]').first().isVisible().catch(() => false)
        expect(hasInputs || hasSwitches).toBe(true)
      } else {
        // Fallback: at minimum expect some configuration inputs
        const inputsVisible = await observabilityPage.page.locator('input').first().isVisible().catch(() => false)
        expect(inputsVisible).toBe(true)
      }
    })
  })

  test.describe('Prometheus Connector', () => {
    test('should select Prometheus connector', async ({ observabilityPage }) => {
      const isAvailable = await observabilityPage.isConnectorAvailable('prometheus')

      if (!isAvailable) {
        test.skip(true, 'Prometheus connector not available')
        return
      }

      await observabilityPage.selectConnector('prometheus')

      const selected = await observabilityPage.getSelectedConnector()
      expect(selected).toContain('Prometheus')
    })

    test('should display Prometheus configuration when available', async ({ observabilityPage }) => {
      await observabilityPage.selectConnector('prometheus')

      await expect(observabilityPage.getPrometheusTab('pull')).toBeVisible()
      await expect(observabilityPage.getPrometheusTab('push')).toBeVisible()
      await expect(observabilityPage.getPrometheusMetricsToggle()).toBeVisible()
      await expect(observabilityPage.page.getByText('Metrics Endpoint', { exact: true })).toBeVisible()
    })

    test('should toggle Prometheus pull metrics and restore the form state', async ({ observabilityPage }) => {
      await observabilityPage.selectConnector('prometheus')

      const toggle = observabilityPage.getPrometheusMetricsToggle()
      await expect(toggle).toBeEnabled()
      const initialState = await observabilityPage.isPrometheusMetricsEnabled()

      await observabilityPage.togglePrometheusMetrics()
      await expect.poll(async () => observabilityPage.isPrometheusMetricsEnabled()).toBe(!initialState)

      await observabilityPage.togglePrometheusMetrics()
      await expect.poll(async () => observabilityPage.isPrometheusMetricsEnabled()).toBe(initialState)
    })

    test('should identify Prometheus as built-in telemetry rather than a deletable connector', async ({ observabilityPage }) => {
      await observabilityPage.selectConnector('prometheus')

      await expect(observabilityPage.getPrometheusMetricsToggle()).toBeVisible()
      await expect(observabilityPage.getConnectorDeleteBtn('prometheus')).toHaveCount(0)
    })
  })

  test.describe('BigQuery Connector', () => {
    test('should show the OSS enterprise boundary for BigQuery', async ({ observabilityPage }) => {
      await observabilityPage.selectConnector('bigquery')

      const selected = await observabilityPage.getSelectedConnector()
      expect(selected).toContain('BigQuery')
      await expect(observabilityPage.page.getByRole('heading', { name: 'Unlock native BigQuery data ingestion for analytics' })).toBeVisible()
      await expect(observabilityPage.page.getByText('This capability requires the Elygate Enterprise source package and is not included in this OSS build.')).toBeVisible()
    })
  })

  test.describe('Datadog Connector', () => {
    test('should show the OSS enterprise boundary for Datadog', async ({ observabilityPage }) => {
      await observabilityPage.selectConnector('datadog')

      const selected = await observabilityPage.getSelectedConnector()
      expect(selected).toContain('Datadog')
      await expect(observabilityPage.page.getByRole('heading', { name: 'Unlock native Datadog data ingestion for better observability' })).toBeVisible()
      await expect(observabilityPage.page.getByText('This capability requires the Elygate Enterprise source package and is not included in this OSS build.')).toBeVisible()
    })
  })

  test.describe('Multiple Connectors', () => {
    test('should switch between connectors', async ({ observabilityPage }) => {
      // Start with OTel
      await observabilityPage.selectConnector('otel')
      let selected = await observabilityPage.getSelectedConnector()
      expect(selected).toContain('Open Telemetry')

      // Switch to Maxim
      await observabilityPage.selectConnector('maxim')
      selected = await observabilityPage.getSelectedConnector()
      expect(selected).toContain('Maxim')

      // Switch back to OTel
      await observabilityPage.selectConnector('otel')
      selected = await observabilityPage.getSelectedConnector()
      expect(selected).toContain('Open Telemetry')
    })

    test('should persist connector selection via URL', async ({ observabilityPage }) => {
      // Select Maxim (URL update via nuqs is async)
      await observabilityPage.selectConnector('maxim')
      // Wait for URL to reflect selection before asserting
      await expect(observabilityPage.page).toHaveURL(/plugin=maxim/, { timeout: 5000 })
    })
  })
})
