import type { Locator, Page } from '@playwright/test'
import { BasePage } from '../../../core/pages/base.page'
import { waitForNetworkIdle } from '../../../core/utils/test-helpers'

export type ObservabilityConnector = 'otel' | 'prometheus' | 'maxim' | 'datadog' | 'bigquery' | 'newrelic'

export class ObservabilityPage extends BasePage {
  // Save button (within the active view)
  readonly saveBtn: Locator

  constructor(page: Page) {
    super(page)

    // Save button
    this.saveBtn = page.getByRole('button', { name: /Save/i })
  }

  /** Map of connector -> data-testid for the connector-level enable toggle. */
  private static readonly CONNECTOR_TOGGLE_TESTIDS: Partial<Record<ObservabilityConnector, string>> = {
    otel: 'otel-connector-enable-toggle',
  }

  /** Map of connector -> data-testid for delete button (otel/prometheus have specific testids) */
  private static readonly CONNECTOR_DELETE_TESTIDS: Partial<Record<ObservabilityConnector, string>> = {
    otel: 'otel-connector-delete-btn',
    prometheus: 'prometheus-connector-delete-btn',
  }

  /**
   * Get connector tab locator by data-testid
   */
  getConnectorTab(connector: ObservabilityConnector): Locator {
    return this.page.getByTestId(`observability-provider-btn-${connector}`)
  }

  /**
   * Get connector enable toggle locator. Uses specific data-testid for otel/prometheus.
   */
  getConnectorToggle(connector: ObservabilityConnector): Locator {
    const testId = ObservabilityPage.CONNECTOR_TOGGLE_TESTIDS[connector]
    return testId ? this.page.getByTestId(testId) : this.page.locator('button[role="switch"]').first()
  }

  /** Prometheus is the built-in telemetry plugin and exposes capability toggles, not a connector-level toggle. */
  getPrometheusMetricsToggle(): Locator {
    return this.page.getByTestId('prometheus-metrics-enable-toggle')
  }

  getPrometheusTab(mode: 'pull' | 'push'): Locator {
    return this.page.getByTestId(`prometheus-tab-${mode}`)
  }

  /**
   * Get connector delete button locator. Returns locator for otel/prometheus; for others returns a no-match locator.
   */
  getConnectorDeleteBtn(connector: ObservabilityConnector): Locator {
    const testId = ObservabilityPage.CONNECTOR_DELETE_TESTIDS[connector]
    return testId ? this.page.getByTestId(testId) : this.page.locator('[data-testid="connector-delete-unused"]')
  }

  async goto(): Promise<void> {
    await this.page.goto('/workspace/observability')
    await waitForNetworkIdle(this.page)
  }

  /**
   * Select a connector tab
   */
  async selectConnector(connector: ObservabilityConnector): Promise<void> {
    const tab = this.getConnectorTab(connector)

    // Wait for tab to be visible first
    await tab.waitFor({ state: 'visible', timeout: 10000 })

    const isDisabled = (await tab.getAttribute('aria-disabled')) === 'true' || (await tab.isDisabled())

    if (!isDisabled) {
      await tab.click()
      await waitForNetworkIdle(this.page)
    }
  }

  /**
   * Check if a connector tab is available (not disabled)
   */
  async isConnectorAvailable(connector: ObservabilityConnector): Promise<boolean> {
    const tab = this.getConnectorTab(connector)
    const isVisible = await tab.isVisible().catch(() => false)
    if (!isVisible) return false

    const isDisabled = (await tab.getAttribute('aria-disabled')) === 'true' || (await tab.isDisabled())
    return !isDisabled
  }

  /**
   * Get the currently selected connector (display name)
   */
  async getSelectedConnector(): Promise<string | null> {
    // Observability view uses plain buttons with aria-current="page" for the selected tab
    const selected = this.page.locator('[data-testid^="observability-provider-btn-"][aria-current="page"]')
    const isVisible = await selected.isVisible().catch(() => false)
    if (!isVisible) return null
    return await selected.textContent()
  }

  /**
   * Check if a connector is enabled (toggle is checked)
   */
  async isConnectorEnabled(connector: ObservabilityConnector): Promise<boolean> {
    const toggle = this.getConnectorToggle(connector)
    const isVisible = await toggle.isVisible().catch(() => false)
    if (!isVisible) return false
    const state = await toggle.getAttribute('data-state')
    return state === 'checked'
  }

  async isPrometheusMetricsEnabled(): Promise<boolean> {
    const toggle = this.getPrometheusMetricsToggle()
    await toggle.waitFor({ state: 'visible', timeout: 5000 })
    return (await toggle.getAttribute('data-state')) === 'checked'
  }

  async togglePrometheusMetrics(): Promise<void> {
    const toggle = this.getPrometheusMetricsToggle()
    await toggle.waitFor({ state: 'visible', timeout: 5000 })
    const previousState = await toggle.getAttribute('data-state')
    await toggle.click()
    const expectedState = previousState === 'checked' ? 'unchecked' : 'checked'
    await this.waitForStateChange(toggle, 'data-state', expectedState, 5000)
  }

  /**
   * Check if the toggle is clickable (not disabled)
   */
  async isToggleEnabled(connector: ObservabilityConnector): Promise<boolean> {
    const toggle = this.getConnectorToggle(connector)
    const isVisible = await toggle.isVisible().catch(() => false)
    if (!isVisible) return false
    const isDisabled = await toggle.isDisabled()
    return !isDisabled
  }

  /**
   * Toggle the current connector enabled state (only if toggle is enabled).
   * Waits for data-state to transition after click to avoid race with subsequent assertions.
   */
  async toggleConnector(connector: ObservabilityConnector): Promise<boolean> {
    const toggle = this.getConnectorToggle(connector)
    const isVisible = await toggle.isVisible().catch(() => false)
    if (!isVisible) return false

    const isDisabled = await toggle.isDisabled()
    if (isDisabled) return false

    const previousState = await toggle.getAttribute('data-state')
    await toggle.click()
    const expectedState = previousState === 'checked' ? 'unchecked' : 'checked'
    await this.waitForStateChange(toggle, 'data-state', expectedState, 5000)
    return true
  }

  /**
   * Enable a connector
   */
  async enableConnector(toggle: Locator): Promise<void> {
    const isChecked = await toggle.getAttribute('data-state') === 'checked'
    if (!isChecked) {
      const isDisabled = await toggle.isDisabled()
      if (!isDisabled) {
        await toggle.click()
      }
    }
  }

  /**
   * Disable a connector
   */
  async disableConnector(toggle: Locator): Promise<void> {
    const isChecked = await toggle.getAttribute('data-state') === 'checked'
    if (isChecked) {
      const isDisabled = await toggle.isDisabled()
      if (!isDisabled) {
        await toggle.click()
      }
    }
  }

  /**
   * Enable Metrics Export
   */
  async enableMetricsExport(): Promise<void> {
    await this.selectConnector('otel')
    const switch_ = this.page.getByTestId('otel-metrics-export-toggle')
    await switch_.waitFor({ state: 'visible', timeout: 5000 })
    const checked = await switch_.getAttribute('data-state') === 'checked'
    if (!checked) {
      await switch_.click()
      await this.page.waitForTimeout(400)
    }
  }

  /**
   * Configure OTel endpoint
   */
  async configureOtelEndpoint(endpoint: string): Promise<void> {
    await this.selectConnector('otel')
    const endpointInput = this.page.getByPlaceholder(/otel-collector/i)
    
    const isVisible = await endpointInput.isVisible().catch(() => false)
    if (isVisible) {
      await endpointInput.clear()
      await endpointInput.fill(endpoint)
    }
  }

  /**
   * Configure Maxim API key
   */
  async configureMaximApiKey(apiKey: string): Promise<void> {
    await this.selectConnector('maxim')
    const apiKeyInput = this.page.getByPlaceholder(/api-key/i)
    
    const isVisible = await apiKeyInput.isVisible().catch(() => false)
    if (isVisible) {
      await apiKeyInput.clear()
      await apiKeyInput.fill(apiKey)
    }
  }

  /**
   * Save the current connector configuration
   */
  async saveConfiguration(): Promise<void> {
    await this.saveBtn.click()
    await this.waitForSuccessToast()
  }

  /**
   * Check if OTel-specific content is visible (confirms we're on the OTel panel).
   * The metrics endpoint input is only in the DOM when "Enable Metrics Export" is on,
   * so we also treat the "Enable Metrics Export" section as OTel content.
   */
  async isMetricsEndpointVisible(): Promise<boolean> {
    // Metrics endpoint input (only visible when Enable Metrics Export is on)
    const metricsInputByValue = this.page.locator('input[value*="/metrics"]')
    const valueVisible = await metricsInputByValue.isVisible().catch(() => false)
    if (valueVisible) return true

    // "Enable Metrics Export" section is always visible on OTel tab (metrics subsection)
    const enableMetricsVisible = await this.page.getByText(/Enable Metrics Export/i).isVisible().catch(() => false)
    if (enableMetricsVisible) return true

    // Label "Metrics Endpoint" (when metrics export is enabled)
    const labelVisible = await this.page.getByText(/Metrics Endpoint/i).isVisible().catch(() => false)
    return labelVisible
  }

  /**
   * Get the metrics endpoint URL value
   */
  async getMetricsEndpointValue(): Promise<string | null> {
    const metricsInput = this.page.locator('input[value*="/metrics"]').first()
    const isVisible = await metricsInput.isVisible().catch(() => false)
    if (!isVisible) return null
    return await metricsInput.inputValue()
  }
}
