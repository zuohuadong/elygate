import { Locator, Page, expect } from '@playwright/test'
import { BasePage } from '../../../core/pages/base.page'
import { waitForNetworkIdle } from '../../../core/utils/test-helpers'

/**
 * Routing rule configuration
 * Note: CEL expression is auto-generated from the visual Rule Builder in the UI
 */
export interface RoutingRuleConfig {
  name: string
  description?: string
  provider?: string
  model?: string
  priority?: number
  enabled?: boolean
  scope?: 'global' | 'team' | 'customer' | 'virtual_key'
  scopeId?: string
  // Fallback providers
  fallbacks?: string[]
}

/**
 * Filter conditions for the rule builder
 */
export interface RuleFilterCondition {
  field: 'model' | 'provider' | 'virtualKey' | 'customer' | 'metadata'
  operator: 'equals' | 'notEquals' | 'contains' | 'startsWith' | 'endsWith' | 'regex'
  value: string
}

interface RoutingRuleRecord {
  id: string
  name: string
  description: string
  scope: string
  scope_id?: string
  priority: number
}

interface RoutingRulesResponse {
  rules: RoutingRuleRecord[]
}

/**
 * Page object for the Routing Rules page
 */
export class RoutingRulesPage extends BasePage {
  // Main elements
  readonly table: Locator
  /** View-level empty state (no table is rendered when there are 0 rules) */
  readonly emptyState: Locator
  readonly createBtn: Locator
  readonly searchInput: Locator

  // Sheet elements
  readonly sheet: Locator
  readonly nameInput: Locator
  readonly descriptionInput: Locator
  readonly providerSelect: Locator
  readonly modelSelect: Locator
  readonly priorityInput: Locator
  readonly enabledToggle: Locator
  readonly scopeSelect: Locator
  readonly saveBtn: Locator
  readonly cancelBtn: Locator

  constructor(page: Page) {
    super(page)

    // Main elements: scope to the routing rules table (has Priority column); no data-testid in UI
    this.table = page.locator('table').filter({
      has: page.locator('th').filter({ hasText: /^Priority$/ })
    }).first()
    this.emptyState = page.getByTestId('routing-rules-empty-state')
    // Use .first() to handle both "New Rule" and "Create First Rule" buttons
    this.createBtn = page.locator('[data-testid="create-routing-rule-btn"]').or(
      page.getByRole('button', { name: /New Rule|Create First Rule/i }).first()
    )
    this.searchInput = page.getByTestId('routing-rules-search-input')

    // Sheet elements
    this.sheet = page.locator('[role="dialog"]').or(page.locator('[data-testid="routing-rule-sheet"]'))
    // Scope inputs to the sheet to avoid matching other elements on page
    this.nameInput = page.locator('[data-testid="rule-name-input"]').or(
      page.locator('[role="dialog"]').getByLabel(/Rule Name/i)
    )
    this.descriptionInput = page.locator('[data-testid="rule-description-input"]').or(
      page.locator('[role="dialog"]').getByLabel(/Description/i)
    )
    this.providerSelect = page.locator('[data-testid="rule-provider-select"]').or(
      page.locator('button').filter({ hasText: /Provider/i })
    )
    this.modelSelect = page.locator('[data-testid="rule-model-select"]').or(
      page.locator('button').filter({ hasText: /Model/i })
    )
    this.priorityInput = page.locator('[data-testid="rule-priority-input"]').or(
      page.getByLabel(/Priority/i)
    )
    this.enabledToggle = page.locator('[data-testid="rule-enabled-toggle"]').or(
      page.locator('[role="dialog"] button[role="switch"]').first()
    )
    // Note: CEL expression is auto-generated from the visual Rule Builder - no direct input
    this.scopeSelect = page.locator('[data-testid="rule-scope-select"]').or(
      page.locator('button').filter({ hasText: /Scope/i })
    )
    // Use exact button names to avoid matching wrong buttons
    // Match both "Save Rule" (create) and "Update Rule" (edit)
    this.saveBtn = page.locator('[data-testid="save-rule-btn"]').or(
      page.locator('[role="dialog"]').getByRole('button', { name: /Save Rule|Update Rule/i })
    )
    // Cancel button specifically (not the Close/X button in header)
    this.cancelBtn = page.locator('[data-testid="cancel-rule-btn"]').or(
      page.locator('[role="dialog"]').getByRole('button', { name: 'Cancel', exact: true })
    )
  }

  /**
   * Navigate to the routing rules page
   */
  async goto(): Promise<void> {
    await this.page.goto('/workspace/routing-rules')
    // Wait for page content (create button, empty state, or table); avoid networkidle (SPA often never idles)
    await Promise.race([
      this.createBtn.waitFor({ state: 'visible', timeout: 15000 }),
      this.emptyState.waitFor({ state: 'visible', timeout: 15000 }),
      this.table.waitFor({ state: 'visible', timeout: 15000 }),
    ])
  }

  /**
   * Get routing rule row locator (tbody data row containing the rule name).
   */
  getRuleRow(name: string): Locator {
    return this.table.locator('tbody tr').filter({ hasText: name }).first()
  }

  private async getRoutingRules(search?: string): Promise<RoutingRuleRecord[]> {
    const path = search
      ? `/api/governance/routing-rules?${new URLSearchParams({ search }).toString()}`
      : '/api/governance/routing-rules'
    const response = await this.page.request.get(path)
    if (!response.ok()) {
      throw new Error(`Failed to list routing rules: ${response.status()} ${await response.text()}`)
    }

    const payload = (await response.json()) as RoutingRulesResponse
    return payload.rules ?? []
  }

  private async getRoutingRuleByName(name: string): Promise<RoutingRuleRecord | undefined> {
    const rules = await this.getRoutingRules(name)
    return rules.find((rule) => rule.name === name)
  }

  private async getVisibleRuleRow(name: string): Promise<Locator> {
    await this.searchInput.waitFor({ state: 'visible', timeout: 10000 })
    await this.searchInput.fill(name)
    const row = this.getRuleRow(name)
    await expect(row).toBeVisible({ timeout: 10000 })
    return row
  }

  async getAvailablePriority(
    preferred: number = 0,
    scope: RoutingRuleConfig['scope'] = 'global',
    scopeId?: string,
    excludeRuleId?: string
  ): Promise<number> {
    const rules = await this.getRoutingRules()
    const normalizedScope = scope ?? 'global'
    const normalizedScopeId = scopeId ?? ''
    const used = new Set(
      rules
        .filter((rule) => rule.id !== excludeRuleId)
        .filter((rule) => rule.scope === normalizedScope && (rule.scope_id ?? '') === normalizedScopeId)
        .map((rule) => rule.priority)
    )
    const startingPriority = Math.min(1000, Math.max(0, Math.trunc(preferred)))

    for (let offset = 0; offset <= 1000; offset++) {
      const candidate = (startingPriority + offset) % 1001
      if (!used.has(candidate)) return candidate
    }

    throw new Error(`No available routing rule priority for scope ${normalizedScope}`)
  }

  async fillAvailablePriority(preferred: number = 0): Promise<number> {
    const priority = await this.getAvailablePriority(preferred)
    await this.priorityInput.waitFor({ state: 'visible' })
    await this.priorityInput.fill(String(priority))
    return priority
  }

  private async waitForToastAndAssertSuccess(action: string): Promise<void> {
    const toast = this.page.locator('[data-sonner-toast]:not([data-removed="true"])').first()
    await expect(toast).toBeVisible({ timeout: 10000 })
    const toastText = await toast.textContent()
    if (toastText?.toLowerCase().includes('error') || toastText?.toLowerCase().includes('failed')) {
      throw new Error(`Failed to ${action}: ${toastText}`)
    }
    await this.dismissToasts()
  }

  /**
   * Check if routing rule exists
   */
  async ruleExists(name: string): Promise<boolean> {
    return (await this.getRoutingRuleByName(name)) !== undefined
  }

  /**
   * Wait for a rule to appear in the table (e.g. after create)
   */
  async waitForRuleToAppear(name: string, timeoutMs: number = 10000): Promise<void> {
    await expect.poll(() => this.ruleExists(name), { timeout: timeoutMs }).toBe(true)
  }

  /**
   * Create a new routing rule
   */
  async createRoutingRule(config: RoutingRuleConfig): Promise<void> {
    await this.dismissToasts()
    await this.createBtn.click()
    await expect(this.sheet).toBeVisible({ timeout: 5000 })
    await this.waitForSheetAnimation()

    // Fill name (required) - scoped to sheet
    await this.nameInput.waitFor({ state: 'visible' })
    await this.nameInput.fill(config.name)

    // Fill description if provided
    if (config.description) {
      await this.descriptionInput.waitFor({ state: 'visible' })
      await this.descriptionInput.fill(config.description)
    }

    // Select provider if provided (in the Routing Target section)
    if (config.provider) {
      const providerCombo = this.sheet.getByRole('combobox').filter({ hasText: /Select provider/i }).first()
      if (await providerCombo.isVisible().catch(() => false)) {
        await providerCombo.click()
        await this.page.waitForSelector('[role="listbox"]', { timeout: 5000 })
        const option = this.page.getByRole('option', { name: new RegExp(config.provider, 'i') }).first()
        await option.scrollIntoViewIfNeeded()
        await option.click({ force: true })
        // Wait for dropdown to close
        await this.page.waitForSelector('[role="listbox"]', { state: 'hidden', timeout: 5000 }).catch(() => {})
      }
    }

    // Note: CEL expression is auto-generated from the Rule Builder (visual query builder)
    // The UI doesn't have a direct CEL input field - it shows a read-only preview
    // To add conditions, use the "Add Rule" button in the Rule Builder section
    // For basic tests, leaving the builder empty applies the rule to all requests

    // Priority is unique within a scope. Resolve against the live API so stale
    // rows from another run cannot make a generated value collide.
    const priority = await this.getAvailablePriority(config.priority ?? 0, config.scope ?? 'global', config.scopeId)
    config.priority = priority
    await this.priorityInput.waitFor({ state: 'visible' })
    await this.priorityInput.fill(String(priority))

    // Set enabled state if explicitly specified
    if (config.enabled !== undefined) {
      const isChecked = await this.enabledToggle.getAttribute('data-state') === 'checked'
      if (config.enabled && !isChecked) {
        await this.enabledToggle.click()
      } else if (!config.enabled && isChecked) {
        await this.enabledToggle.click()
      }
    }

    // Save
    await this.saveBtn.waitFor({ state: 'visible' })
    await this.saveBtn.click()

    await this.waitForToastAndAssertSuccess('create routing rule')
    await expect(this.sheet).not.toBeVisible({ timeout: 10000 })
    await waitForNetworkIdle(this.page)
    // Wait for the new rule to appear in the table (list may refresh async)
    await this.waitForRuleToAppear(config.name, 10000)
  }

  /**
   * Edit an existing routing rule
   */
  async editRoutingRule(name: string, updates: Partial<RoutingRuleConfig>): Promise<number | undefined> {
    await this.dismissToasts()
    const currentRule = await this.getRoutingRuleByName(name)
    if (!currentRule) throw new Error(`Routing rule not found: ${name}`)

    const row = await this.getVisibleRuleRow(name)
    await row.getByRole('button', { name: `Actions for routing rule ${name}`, exact: true }).click()
    const editBtn = this.page.getByRole('menuitem', { name: 'Edit', exact: true })
    await expect(editBtn).toBeVisible()
    await editBtn.click()

    await expect(this.sheet).toBeVisible({ timeout: 5000 })
    await this.waitForSheetAnimation()

    // Update fields
    if (updates.name) {
      await this.nameInput.waitFor({ state: 'visible' })
      await this.nameInput.clear()
      await this.nameInput.fill(updates.name)
    }

    if (updates.description !== undefined) {
      await this.descriptionInput.waitFor({ state: 'visible' })
      await this.descriptionInput.clear()
      if (updates.description) {
        await this.descriptionInput.fill(updates.description)
      }
    }

    let savedPriority: number | undefined
    if (updates.priority !== undefined) {
      savedPriority = await this.getAvailablePriority(
        updates.priority,
        currentRule.scope as RoutingRuleConfig['scope'],
        currentRule.scope_id,
        currentRule.id
      )
      updates.priority = savedPriority
      await this.priorityInput.waitFor({ state: 'visible' })
      await this.priorityInput.fill(String(savedPriority))
    }

    // Save
    await this.saveBtn.waitFor({ state: 'visible' })
    await this.saveBtn.click()

    await this.waitForToastAndAssertSuccess('edit routing rule')
    await expect(this.sheet).not.toBeVisible({ timeout: 10000 })
    await waitForNetworkIdle(this.page)
    await expect.poll(() => this.getRoutingRuleByName(updates.name ?? name), { timeout: 10000 }).not.toBeUndefined()
    return savedPriority
  }

  /**
   * Delete a routing rule
   */
  async deleteRoutingRule(name: string): Promise<void> {
    await this.dismissToasts()
    const row = await this.getVisibleRuleRow(name)
    await row.getByRole('button', { name: `Actions for routing rule ${name}`, exact: true }).click()
    const deleteBtn = this.page.getByRole('menuitem', { name: 'Delete', exact: true })
    await expect(deleteBtn).toBeVisible()
    await deleteBtn.click()

    // Wait for confirmation dialog (AlertDialog uses role="alertdialog")
    const alertDialog = this.page.getByRole('alertdialog').filter({ hasText: name })
    await expect(alertDialog).toBeVisible({ timeout: 5000 })

    // Click confirm delete button inside the dialog
    const confirmBtn = alertDialog.getByRole('button', { name: 'Delete', exact: true })
    await confirmBtn.waitFor({ state: 'visible' })
    await confirmBtn.click()

    await this.waitForToastAndAssertSuccess('delete routing rule')
    await waitForNetworkIdle(this.page)
    await expect.poll(() => this.ruleExists(name), { timeout: 10000 }).toBe(false)
  }

  async cleanupRoutingRules(names: readonly string[]): Promise<void> {
    const uniqueNames = new Set(names)
    if (uniqueNames.size === 0) return

    const rules = await this.getRoutingRules()
    const matches = rules.filter((rule) => uniqueNames.has(rule.name))
    const errors: string[] = []

    for (const rule of matches) {
      const response = await this.page.request.delete(`/api/governance/routing-rules/${rule.id}`)
      if (!response.ok() && response.status() !== 404) {
        errors.push(`${rule.name}: ${response.status()} ${await response.text()}`)
      }
    }

    const remaining = (await this.getRoutingRules()).filter((rule) => uniqueNames.has(rule.name))
    if (remaining.length > 0) {
      errors.push(`still present: ${remaining.map((rule) => rule.name).join(', ')}`)
    }
    if (errors.length > 0) {
      throw new Error(`Failed to clean up routing rules: ${errors.join('; ')}`)
    }
  }

  /**
   * Toggle rule enabled state
   */
  async toggleRuleEnabled(name: string): Promise<void> {
    await this.dismissToasts() // Dismiss any existing toasts
    const row = await this.getVisibleRuleRow(name)

    // Find toggle switch in the row
    const toggle = row.locator('button[role="switch"]')
    if (await toggle.count() > 0) {
      await toggle.waitFor({ state: 'visible' })
      await toggle.click()
      await this.waitForSuccessToast()
      await this.dismissToasts() // Wait for toasts to disappear
    }
  }

  /**
   * Cancel rule creation/edit
   */
  async cancelRule(): Promise<void> {
    if (await this.sheet.isVisible()) {
      await this.cancelBtn.click()
      await expect(this.sheet).not.toBeVisible({ timeout: 5000 })
    }
  }

  /**
   * Get routing rule count.
   * When there are 0 rules, the view shows an empty state (no table in DOM).
   */
  async getRuleCount(): Promise<number> {
    const emptyVisible = await this.emptyState.isVisible().catch(() => false)
    if (emptyVisible) {
      return 0
    }
    const tableVisible = await this.table.isVisible().catch(() => false)
    if (!tableVisible) {
      return 0
    }
    const rows = this.table.locator('tbody tr')
    const count = await rows.count()
    const firstRowText = await rows.first().textContent({ timeout: 5000 }).catch(() => '')
    if (firstRowText?.includes('No routing rules')) {
      return 0
    }
    return count
  }

  /**
   * Get the rule builder container (the Query builder generic element)
   */
  getRuleBuilder(): Locator {
    return this.sheet.locator('[aria-label="Query builder"]')
  }

  /**
   * Wait for the CEL rule builder to be fully loaded
   */
  async waitForRuleBuilder(): Promise<void> {
    // Wait for the Add Rule button to be visible (indicates builder is loaded)
    const addRuleBtn = this.sheet.getByRole('button', { name: 'Add Rule', exact: true })
    await addRuleBtn.waitFor({ state: 'visible', timeout: 10000 })
    // Give time for React to fully render
    await this.page.waitForTimeout(500)
  }

  /**
   * Click the "Add Rule" button in the rule builder
   */
  async clickAddRule(): Promise<void> {
    await this.waitForRuleBuilder()
    const addRuleBtn = this.sheet.getByRole('button', { name: 'Add Rule', exact: true })
    await addRuleBtn.click()
    await this.page.waitForTimeout(500) // Wait for new rule row to appear
  }

  /**
   * Click the "Add Rule Group" button in the rule builder
   */
  async clickAddRuleGroup(): Promise<void> {
    await this.waitForRuleBuilder()
    const addGroupBtn = this.sheet.getByRole('button', { name: 'Add Rule Group', exact: true })
    await addGroupBtn.click()
    await this.page.waitForTimeout(500) // Wait for new group to appear
  }

  /**
   * Get all comboboxes for a specific rule row
   * The rule builder has a specific structure where rule rows have remove buttons (⨯)
   */
  async getRuleRowComboboxes(ruleIndex: number): Promise<{ field: Locator; operator: Locator; value: Locator }> {
    const ruleBuilder = this.getRuleBuilder()
    // Find all rows that have the remove button (⨯) - these are rule rows
    const ruleRows = ruleBuilder.locator('> div').filter({
      has: this.page.locator('button').filter({ hasText: '⨯' })
    })
    const ruleRow = ruleRows.nth(ruleIndex)

    // Within the rule row, comboboxes are in order: field, (hidden), operator, (hidden), then value area
    // Get all visible comboboxes in this row
    const allComboboxes = ruleRow.locator('[role="combobox"]')

    return {
      field: allComboboxes.first(),
      operator: allComboboxes.nth(2), // Skip the hidden one at index 1
      value: ruleRow.locator('[role="combobox"]').last() // Value selector is in a nested structure
    }
  }

  /**
   * Select field for a rule (by rule index, 0-based)
   */
  async selectRuleField(ruleIndex: number, fieldName: string): Promise<void> {
    const { field: fieldSelector } = await this.getRuleRowComboboxes(ruleIndex)
    await fieldSelector.waitFor({ state: 'visible', timeout: 5000 })
    await fieldSelector.click()
    await this.page.waitForTimeout(300)
    await this.page.getByRole('option', { name: new RegExp(`^${fieldName}$`, 'i') }).first().click({ force: true })
    await this.page.waitForTimeout(300)
  }

  /**
   * Select operator for a rule (by rule index, 0-based)
   * Operator symbols: =, !=, >, <, >=, <=, contains, starts with, ends with, matches regex
   */
  async selectRuleOperator(ruleIndex: number, operatorName: string): Promise<void> {
    const { operator: operatorSelector } = await this.getRuleRowComboboxes(ruleIndex)
    await operatorSelector.waitFor({ state: 'visible', timeout: 5000 })
    await operatorSelector.click()
    await this.page.waitForTimeout(300)
    // Match operator by exact symbol or text
    const option = this.page.getByRole('option').filter({ hasText: new RegExp(`^${operatorName}$|^${operatorName} `, 'i') }).first()
    await option.click({ force: true })
    await this.page.waitForTimeout(300)
  }

  /**
   * Set value for a rule using the value combobox/input
   * For Model/Provider fields, this is a searchable dropdown
   */
  async setRuleValue(ruleIndex: number, value: string): Promise<void> {
    const ruleBuilder = this.getRuleBuilder()
    const ruleRows = ruleBuilder.locator('> div').filter({
      has: this.page.locator('button').filter({ hasText: '⨯' })
    })
    const ruleRow = ruleRows.nth(ruleIndex)

    // Value input can be either a text input or a searchable combobox
    // Try text input first
    const textInput = ruleRow.locator('input[type="text"]').first()
    if (await textInput.isVisible().catch(() => false)) {
      await textInput.fill(value)
      await this.page.waitForTimeout(200)
      return
    }

    // Otherwise use the value combobox (for Model/Provider fields)
    // It's in a nested structure, look for "Select a model..." or similar text
    const valueArea = ruleRow.locator('div').filter({ hasText: /Select a/ }).last()
    const valueSelector = valueArea.locator('[role="combobox"]').first()

    if (await valueSelector.isVisible().catch(() => false)) {
      await valueSelector.click()
      await this.page.waitForTimeout(300)

      // Type in the search input
      const searchInput = this.page.locator('[cmdk-input]').or(
        this.page.locator('input[placeholder*="Search"]')
      ).or(
        this.page.locator('[role="listbox"] input')
      )

      if (await searchInput.isVisible().catch(() => false)) {
        await searchInput.fill(value)
        await this.page.waitForTimeout(500)
      }

      // Try to select matching option
      const option = this.page.getByRole('option', { name: new RegExp(value, 'i') }).first()
      if (await option.isVisible({ timeout: 2000 }).catch(() => false)) {
        await option.click({ force: true })
      } else {
        // Press escape and type directly in input if no option found
        await this.page.keyboard.press('Escape')
      }
      await this.page.waitForTimeout(300)
    }
  }

  /**
   * Change the combinator (AND/OR) for a rule group
   */
  async setCombinator(combinator: 'and' | 'or'): Promise<void> {
    // AND/OR are toggle buttons - click the one we want to activate
    const targetBtn = this.sheet.getByRole('button', { name: combinator.toUpperCase(), exact: true })
    await targetBtn.click()
    await this.page.waitForTimeout(300)
  }

  /**
   * Get the CEL expression preview text
   */
  async getCelExpression(): Promise<string> {
    // The CEL preview is in a readonly textarea with label "CEL Expression Preview"
    const celPreview = this.sheet.locator('textarea').last()
    await celPreview.waitFor({ state: 'visible', timeout: 5000 })
    return await celPreview.inputValue()
  }

  /**
   * Add a complete rule condition (field + operator + value)
   */
  async addRuleCondition(condition: RuleFilterCondition): Promise<void> {
    await this.clickAddRule()

    // Get the index of the new rule (last one)
    const ruleBuilder = this.getRuleBuilder()
    const ruleRows = ruleBuilder.locator('> div').filter({
      has: this.page.locator('button').filter({ hasText: '⨯' })
    })
    const ruleCount = await ruleRows.count()
    const newRuleIndex = ruleCount - 1

    // Select field
    await this.selectRuleField(newRuleIndex, condition.field)

    // Select operator (map our operator names to UI labels)
    const operatorMap: Record<string, string> = {
      'equals': '=',
      'notEquals': '!=',
      'contains': 'contains',
      'startsWith': 'starts with',
      'endsWith': 'ends with',
      'regex': 'matches regex'
    }
    await this.selectRuleOperator(newRuleIndex, operatorMap[condition.operator] || condition.operator)

    // Set value
    await this.setRuleValue(newRuleIndex, condition.value)
  }

  /**
   * Add a fallback provider
   */
  async addFallbackProvider(provider: string, model?: string): Promise<void> {
    // Find the "Add Fallback" button
    const addFallbackBtn = this.sheet.getByRole('button', { name: /Add Fallback/i }).or(
      this.sheet.locator('button').filter({ hasText: /Fallback/i })
    )

    const isVisible = await addFallbackBtn.isVisible().catch(() => false)
    if (isVisible) {
      await addFallbackBtn.click()

      // Fill in provider/model - typically in format "provider/model"
      const fallbackInput = this.sheet.locator('input[placeholder*="fallback" i], input[placeholder*="provider" i]').first()
      const value = model ? `${provider}/${model}` : provider
      await fallbackInput.fill(value)
    }
  }

  /**
   * Duplicate an existing rule
   */
  async duplicateRule(name: string): Promise<string | null> {
    await this.dismissToasts()
    const row = this.getRuleRow(name)
    await row.scrollIntoViewIfNeeded()

    // Find duplicate button
    const duplicateBtn = row.locator('button').filter({
      has: this.page.locator('svg.lucide-copy')
    }).or(
      row.getByRole('button', { name: /Duplicate/i })
    )

    const isVisible = await duplicateBtn.isVisible().catch(() => false)
    if (!isVisible) {
      return null
    }

    await duplicateBtn.click()
    await this.waitForSuccessToast()

    // NOTE: Assumes UI appends " (copy)" to duplicated rule names.
    // If this convention changes, update this return value.
    return `${name} (copy)`
  }

  /**
   * Reorder rules by drag and drop (if supported)
   * Note: Many UIs use priority field instead of drag-drop
   */
  async reorderRuleByPriority(name: string, newPriority: number): Promise<void> {
    // Edit the rule and change its priority
    await this.editRoutingRule(name, { priority: newPriority })
  }

  /**
   * Get rule's description from the table (first column contains name + description)
   */
  async getRuleDescription(name: string): Promise<string> {
    return (await this.getRoutingRuleByName(name))?.description ?? ''
  }

  /**
   * Get rule's current priority
   */
  async getRulePriority(name: string): Promise<number | null> {
    return (await this.getRoutingRuleByName(name))?.priority ?? null
  }

  /**
   * Set scope for a rule in the form
   */
  async setRuleScope(scope: 'global' | 'team' | 'customer' | 'virtual_key', scopeId?: string): Promise<void> {
    // Find scope select
    const scopeSelect = this.sheet.locator('[role="combobox"]').filter({ hasText: /Scope|Global/i }).first()

    if (await scopeSelect.isVisible().catch(() => false)) {
      await scopeSelect.click()

      // Map scope values to display labels
      const labels: Record<string, string> = {
        'global': 'Global',
        'team': 'Team',
        'customer': 'Customer',
        'virtual_key': 'Virtual Key'
      }

      await this.page.getByRole('option', { name: labels[scope] }).click({ force: true })

      // If not global, fill in the scope ID
      if (scope !== 'global' && scopeId) {
        // Wait for scope ID select/input to appear
        const scopeIdInput = this.sheet.locator('[role="combobox"]').filter({ hasText: /Select/i }).last().or(
          this.sheet.locator('input[placeholder*="Select" i]').last()
        )

        if (await scopeIdInput.isVisible().catch(() => false)) {
          await scopeIdInput.click()
          await this.page.getByRole('option', { name: new RegExp(scopeId, 'i') }).first().click({ force: true })
        }
      }
    }
  }

  /**
   * Get all rule names from the table
   */
  async getAllRuleNames(): Promise<string[]> {
    const rows = this.table.locator('tbody tr')
    const count = await rows.count()
    const names: string[] = []

    for (let i = 0; i < count; i++) {
      const firstCell = rows.nth(i).locator('td').first()
      const name = await firstCell.textContent()
      if (name && !name.includes('No routing rules')) {
        names.push(name.trim())
      }
    }

    return names
  }
}
