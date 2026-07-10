import { Locator, Page, expect } from '@playwright/test'
import { BasePage } from '../../../core/pages/base.page'
import { waitForNetworkIdle } from '../../../core/utils/test-helpers'

/**
 * Page object for the MCP Logs page
 */
export class MCPLogsPage extends BasePage {
  // Main elements
  readonly logsTable: Locator
  readonly filtersSection: Locator
  readonly filtersButton: Locator
  readonly statsCards: Locator

  // Filter elements
  readonly toolNameFilter: Locator
  readonly serverLabelFilter: Locator
  readonly statusFilter: Locator
  readonly searchInput: Locator
  readonly dateRangePicker: Locator
  readonly liveToggle: Locator

  // Table elements
  readonly tableRows: Locator
  readonly paginationControls: Locator
  readonly nextPageBtn: Locator
  readonly prevPageBtn: Locator

  // Log detail sheet
  readonly logDetailSheet: Locator
  readonly closeDetailSheetBtn: Locator

  constructor(page: Page) {
    super(page)

    // Main elements
    this.logsTable = page.locator('[data-testid="mcp-logs-table"]').or(page.locator('table'))
    // The filters section is the container with search input and filters button
    this.filtersSection = page.locator('input[placeholder="Search MCP logs"]').locator('..')
    this.filtersButton = page.getByRole('button', { name: /Hide filters|Show filters/i })
    this.statsCards = page.locator('[data-testid="mcp-stats-cards"]').or(
      page.locator('text=Total Executions').locator('..').locator('..')
    )

    // Filters live in the persistent collapsible sidebar.
    this.toolNameFilter = page.getByRole('button', { name: 'Tool Names', exact: true })
    this.serverLabelFilter = page.getByRole('button', { name: 'Servers', exact: true })
    this.statusFilter = page.getByRole('button', { name: 'Status', exact: true })
    this.searchInput = page.locator('[data-testid="filter-search"]').or(
      page.getByPlaceholder('Search MCP logs')
    )
    this.dateRangePicker = page.locator('[data-testid="filter-date-range"]').or(
      page.locator('button').filter({ hasText: /Last/i })
    )
    this.liveToggle = page.locator('[data-testid="live-toggle"]').or(
      page.getByRole('button', { name: /Live updates/i })
    )

    // Table elements - exclude status message rows
    this.tableRows = this.logsTable
      .locator('tbody tr')
      .filter({ hasNot: page.getByText(/Listening for|Waiting for new MCP logs/i) })
      .filter({ hasNot: page.getByText('Live updates paused') })
      .filter({ hasNot: page.getByText('Not connected') })
      .filter({ hasNot: page.getByText('No results found') })
    // Scope pagination to the MCP logs view (avoid matching other pages when navigating)
    const paginationContainer = page.getByTestId('pagination').filter({ has: page.locator('[data-testid="next-page"]') }).first()
    this.paginationControls = paginationContainer
    this.nextPageBtn = paginationContainer.getByRole('button', { name: 'Next page' }).or(
      paginationContainer.locator('[data-testid="next-page"]')
    )
    this.prevPageBtn = paginationContainer.getByRole('button', { name: 'Previous page' }).or(
      paginationContainer.locator('[data-testid="prev-page"]')
    )

    this.logDetailSheet = page.locator('[data-slot="sheet-content"][data-state="open"]')
    this.closeDetailSheetBtn = this.logDetailSheet.getByRole('button', { name: 'Close', exact: true })
  }

  /**
   * Navigate to the MCP logs page
   */
  async goto(): Promise<void> {
    await this.page.goto('/workspace/mcp-logs')
    await waitForNetworkIdle(this.page)
    // Wait for table to be visible
    await this.logsTable.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
  }

  private async ensureFilterSidebarExpanded(): Promise<void> {
    const showFilters = this.page.getByRole('button', { name: 'Show filters', exact: true })
    if (await showFilters.isVisible().catch(() => false)) {
      await showFilters.click()
    }
    await expect(this.page.getByRole('button', { name: 'Hide filters', exact: true })).toBeVisible()
  }

  private async ensureFilterSectionOpen(trigger: Locator): Promise<Locator> {
    await this.ensureFilterSidebarExpanded()
    await trigger.waitFor({ state: 'visible' })
    if ((await trigger.getAttribute('data-state')) !== 'open') {
      await trigger.click()
    }
    await expect(trigger).toHaveAttribute('data-state', 'open')
    return trigger.locator('xpath=ancestor::*[@data-slot="collapsible"][1]')
  }

  private async selectFirstCheckbox(trigger: Locator): Promise<boolean> {
    const section = await this.ensureFilterSectionOpen(trigger)
    const checkbox = section.getByRole('checkbox').first()
    const didLoad = await checkbox.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false)
    if (!didLoad) return false

    await checkbox.click()
    await expect(checkbox).toHaveAttribute('data-state', 'checked')
    await waitForNetworkIdle(this.page)
    return true
  }

  /**
   * Filter by tool name using the first available sidebar checkbox.
   * @returns true if at least one tool name option was found and selected
   */
  async filterByToolName(): Promise<boolean> {
    return this.selectFirstCheckbox(this.toolNameFilter)
  }

  /**
   * Filter by server label using the first available sidebar checkbox.
   * @returns true if at least one server label option was found and selected
   */
  async filterByServerLabel(): Promise<boolean> {
    return this.selectFirstCheckbox(this.serverLabelFilter)
  }

  /**
   * Filter by status using the matching sidebar checkbox.
   * @returns true if the option was found and clicked
   */
  async filterByStatus(status: 'success' | 'error' | 'pending'): Promise<boolean> {
    const section = await this.ensureFilterSectionOpen(this.statusFilter)
    const checkbox = section.getByRole('checkbox', { name: new RegExp(`^${status}$`, 'i') })
    const didLoad = await checkbox.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)
    if (!didLoad) return false

    await checkbox.click()
    await expect(checkbox).toHaveAttribute('data-state', 'checked')
    await waitForNetworkIdle(this.page)
    return true
  }

  /**
   * Search logs by content
   */
  async searchLogs(query: string): Promise<void> {
    await this.searchInput.fill(query)
    // Wait for debounced search to trigger network request
    await waitForNetworkIdle(this.page)
  }

  /**
   * Clear search
   */
  async clearSearch(): Promise<void> {
    await this.searchInput.clear()
    await waitForNetworkIdle(this.page)
  }

  /**
   * Select time period
   */
  async selectTimePeriod(period: '1h' | '6h' | '24h' | '7d' | '30d'): Promise<void> {
    await this.dateRangePicker.first().click()
    await this.page.waitForSelector('[role="listbox"], [role="menu"]', { timeout: 5000 }).catch(() => {})

    const periodLabels: Record<string, string> = {
      '1h': 'Last hour',
      '6h': 'Last 6 hours',
      '24h': 'Last 24 hours',
      '7d': 'Last 7 days',
      '30d': 'Last 30 days',
    }

    const periodButton = this.page.getByRole('button', { name: periodLabels[period] })
    if (await periodButton.count() > 0) {
      await periodButton.click()
    } else {
      await this.page.keyboard.press('Escape')
    }

    await waitForNetworkIdle(this.page)
  }

  /**
   * Toggle live updates
   */
  async toggleLiveUpdates(): Promise<void> {
    await this.liveToggle.first().waitFor({ state: 'visible' })
    await this.liveToggle.first().click()
  }

  /**
   * Click on a log row to view details
   */
  async viewLogDetails(rowIndex: number = 0): Promise<void> {
    const rows = this.tableRows
    const count = await rows.count()

    if (count <= rowIndex) {
      throw new Error(`Row index ${rowIndex} out of bounds (${count} rows available)`)
    }
    const row = rows.nth(rowIndex)
    const dataCell = row.locator('td').filter({ hasNot: this.page.getByTestId('log-actions-btn') }).first()
    await dataCell.click()
    await this.page.waitForURL(/selected_log=/, { timeout: 5000 })
    await expect(this.logDetailSheet).toBeVisible({ timeout: 5000 })
  }

  /**
   * Close log detail sheet
   */
  async closeLogDetails(): Promise<void> {
    if (await this.logDetailSheet.isVisible()) {
      await this.closeDetailSheetBtn.click().catch(async () => {
        await this.page.keyboard.press('Escape')
      })
      await expect(this.logDetailSheet).not.toBeVisible({ timeout: 5000 })
    }
  }

  /**
   * Get log count from table
   */
  async getLogCount(): Promise<number> {
    return await this.tableRows.count()
  }

  /**
   * Check if log exists in table
   */
  async logExists(searchText: string): Promise<boolean> {
    const row = this.tableRows.filter({ hasText: searchText })
    return await row.count() > 0
  }

  /**
   * Get current 1-based page number from URL (offset/limit).
   */
  getCurrentPageNumber(): number {
    const url = this.page.url()
    const params = new URL(url).searchParams
    const offset = Number.parseInt(params.get('offset') ?? '0', 10)
    const limit = Number.parseInt(params.get('limit') ?? '50', 10) || 50
    return Math.floor(offset / limit) + 1
  }

  /**
   * Navigate to next page (waits for URL to update)
   */
  async goToNextPage(): Promise<void> {
    const btn = this.nextPageBtn.first()
    const isEnabled = await btn.isEnabled().catch(() => false)
    if (!isEnabled) return
    await btn.scrollIntoViewIfNeeded()
    await btn.waitFor({ state: 'visible' })
    const limit = Number.parseInt(new URL(this.page.url()).searchParams.get('limit') ?? '50', 10) || 50
    const currentOffset = Number.parseInt(new URL(this.page.url()).searchParams.get('offset') ?? '0', 10)
    const expectedOffset = currentOffset + limit
    await btn.click()
    await this.page.waitForURL((url) => {
      const params = new URL(url).searchParams
      const offset = params.get('offset')
      return offset === String(expectedOffset)
    }, { timeout: 10000 })
    await waitForNetworkIdle(this.page)
  }

  /**
   * Navigate to previous page (waits for URL to update)
   */
  async goToPreviousPage(): Promise<void> {
    const btn = this.prevPageBtn.first()
    const isEnabled = await btn.isEnabled().catch(() => false)
    if (!isEnabled) return
    await btn.scrollIntoViewIfNeeded()
    await btn.waitFor({ state: 'visible' })
    const limit = Number.parseInt(new URL(this.page.url()).searchParams.get('limit') ?? '50', 10) || 50
    const currentOffset = Number.parseInt(new URL(this.page.url()).searchParams.get('offset') ?? '0', 10)
    const expectedOffset = Math.max(0, currentOffset - limit)
    await btn.click()
    await this.page.waitForURL((url) => {
      const params = new URL(url).searchParams
      const offset = params.get('offset')
      // When going back to page 1, offset param may be removed (null) or set to "0"
      if (expectedOffset === 0) return offset === null || offset === '0'
      return offset === String(expectedOffset)
    }, { timeout: 10000 })
    await waitForNetworkIdle(this.page)
  }

  /**
   * Sort table by column - clicks the sort button in the column header
   */
  async sortBy(column: 'timestamp' | 'latency'): Promise<void> {
    await this.dismissToasts()

    // Map column names to header button text
    const columnLabels: Record<string, string> = {
      'timestamp': 'Time',
      'latency': 'Latency'
    }

    const label = columnLabels[column] || column
    // The sortable column headers have a button with the column name
    const sortButton = this.logsTable.getByRole('button', { name: new RegExp(label, 'i') })

    if (await sortButton.count() > 0) {
      await sortButton.first().waitFor({ state: 'visible' })
      await sortButton.first().click()
      await waitForNetworkIdle(this.page)
    }
  }

  /**
   * Check if stats cards are visible
   */
  async areStatsVisible(): Promise<boolean> {
    // MCP logs page shows "Total Executions" not "Total Requests"
    const statsText = this.page.locator('text=Total Executions')
    return await statsText.isVisible().catch(() => false)
  }

  /**
   * Check if empty state is shown
   */
  async isEmptyStateVisible(): Promise<boolean> {
    const emptyState = this.page.locator('text=/No logs found/i').or(
      this.page.locator('text=/No data/i')
    )
    return await emptyState.isVisible().catch(() => false)
  }

  /**
   * Get sort state for a column from URL parameters
   * Returns 'asc', 'desc', or null if column is not the current sort column
   */
  async getSortState(column: 'timestamp' | 'latency'): Promise<string | null> {
    const url = this.page.url()
    const urlParams = new URL(url).searchParams
    const sortBy = urlParams.get('sort_by')
    const order = urlParams.get('order')

    // Check if this column is the currently sorted column
    if (sortBy === column) {
      return order || 'desc' // default is desc
    }
    return null
  }
}
