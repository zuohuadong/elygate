import { Locator, Page } from '@playwright/test'
import { expect } from '../../../core/fixtures/base.fixture'
import { BasePage } from '../../../core/pages/base.page'
import { waitForNetworkIdle } from '../../../core/utils/test-helpers'

const resetDurationLabels: Record<string, string> = {
  '1m': 'Every Minute',
  '5m': 'Every 5 Minutes',
  '15m': 'Every 15 Minutes',
  '30m': 'Every 30 Minutes',
  '1h': 'Hourly',
  '6h': 'Every 6 Hours',
  '1d': 'Daily',
  '1w': 'Weekly',
  '1M': 'Monthly',
}

export interface TeamConfig {
  name: string
  /** Assign by customer id (from API). Prefer customerName for UI-only flow. */
  customerId?: string
  /** Assign by customer name in the create-team dropdown (UI-only, no API). */
  customerName?: string
  budget?: { maxLimit: number; resetDuration?: string }
  rateLimit?: {
    tokenMaxLimit?: number
    tokenResetDuration?: string
    requestMaxLimit?: number
    requestResetDuration?: string
  }
}

export interface CustomerConfig {
  name: string
  budget?: { maxLimit: number; resetDuration?: string }
  rateLimit?: {
    tokenMaxLimit?: number
    tokenResetDuration?: string
    requestMaxLimit?: number
    requestResetDuration?: string
  }
}

export class GovernancePage extends BasePage {
  // Teams
  readonly teamsCreateBtn: Locator
  readonly teamsTable: Locator
  readonly teamSheet: Locator
  readonly teamNameInput: Locator

  // Customers
  readonly customersCreateBtn: Locator
  readonly customersTable: Locator
  readonly customerSheet: Locator
  readonly customerNameInput: Locator

  constructor(page: Page) {
    super(page)

    this.teamsCreateBtn = page.getByTestId('create-team-btn').or(page.getByTestId('team-button-add'))
    this.teamsTable = page.getByTestId('teams-table')
    this.teamSheet = page.getByTestId('team-sheet-content')
    this.teamNameInput = page.getByTestId('team-name-input')

    this.customersCreateBtn = page.getByTestId('customer-button-create')
    this.customersTable = page.getByTestId('customer-table-container')
    this.customerSheet = page.getByTestId('customer-dialog-content')
    this.customerNameInput = page.getByTestId('customer-name-input')
  }

  async gotoTeams(): Promise<void> {
    await this.page.goto('/workspace/governance/teams')
    await waitForNetworkIdle(this.page)
  }

  async gotoCustomers(): Promise<void> {
    await this.page.goto('/workspace/governance/customers')
    await waitForNetworkIdle(this.page)
  }

  getTeamRow(name: string): Locator {
    return this.page.getByTestId(`team-row-${name}`)
  }

  /** Customer cell for a team row (use for asserting assigned customer in UI). */
  getTeamRowCustomerCell(teamName: string): Locator {
    return this.page.getByTestId(`team-row-${teamName}-customer`)
  }

  async teamExists(name: string): Promise<boolean> {
    const row = this.getTeamRow(name)
    return (await row.count()) > 0
  }

  async createTeam(config: TeamConfig): Promise<void> {
    await this.teamsCreateBtn.click()
    await expect(this.teamSheet).toBeVisible({ timeout: 5000 })
    await this.waitForSheetAnimation()

    await this.teamNameInput.fill(config.name)

    if (config.customerId !== undefined || config.customerName !== undefined) {
      const trigger = this.page.getByTestId('team-customer-select-trigger')
      await trigger.click()
      if (config.customerId === '') {
        await this.page.getByTestId('team-customer-option-none').click()
      } else if (config.customerName !== undefined) {
        const customerOption = this.page
          .locator('[data-testid^="team-customer-option-"]')
          .filter({ hasText: config.customerName })
        await customerOption.waitFor({ state: 'visible', timeout: 5000 })
        await customerOption.click()
      } else if (config.customerId !== undefined && config.customerId !== '') {
        const customerOption = this.page.getByTestId(`team-customer-option-${config.customerId}`)
        await customerOption.waitFor({ state: 'visible', timeout: 5000 })
        await customerOption.click()
      }
    }

    if (config.budget?.maxLimit !== undefined) {
      await this.page.getByTestId('team-add-budget-btn').click()
      const budgetRow = this.page.getByTestId('team-budget-row-0')
      await expect(budgetRow).toBeVisible()
      await budgetRow.getByTestId('budget-max-limit-input-0').fill(String(config.budget.maxLimit))
      if (config.budget.resetDuration) {
        await this.selectResetDuration(budgetRow, config.budget.resetDuration)
      }
    }

    const saveBtn = this.teamSheet.getByRole('button', { name: /Create Team/i })
    await expect(saveBtn).toBeEnabled()
    await saveBtn.click()
    await this.waitForSuccessToast('Team created successfully')
    await expect(this.teamSheet).not.toBeVisible({ timeout: 10000 })
    await expect(this.getTeamRow(config.name)).toBeVisible({ timeout: 10000 })
  }

  async deleteTeam(name: string): Promise<void> {
    await this.page.getByTestId(`team-actions-btn-${name}`).click()
    const deleteBtn = this.page.getByTestId(`team-delete-btn-${name}`)
    await deleteBtn.click()

    const confirmDialog = this.page.locator('[role="alertdialog"]')
    await confirmDialog.getByRole('button', { name: /Delete/i }).click()
    await this.waitForSuccessToast()
    await expect.poll(() => this.teamExists(name), { timeout: 10000 }).toBe(false)
  }

  async closeTeamDialog(): Promise<void> {
    if (await this.teamSheet.isVisible().catch(() => false)) {
      await this.teamSheet.getByRole('button', { name: /Cancel/i }).click()
      await expect(this.teamSheet).not.toBeVisible({ timeout: 10000 })
    }
  }

  getCustomerRow(name: string): Locator {
    return this.customersTable.getByTestId(`customer-row-${name}`)
  }

  async customerExists(name: string): Promise<boolean> {
    const row = this.getCustomerRow(name)
    return (await row.count()) > 0
  }

  async createCustomer(config: CustomerConfig): Promise<void> {
    await this.customersCreateBtn.click()
    await expect(this.customerSheet).toBeVisible({ timeout: 5000 })
    await this.waitForSheetAnimation()

    await this.customerNameInput.fill(config.name)

    if (config.budget?.maxLimit !== undefined) {
      await this.page.getByTestId('customer-budgets-add-btn').click()
      const budgetRow = this.page.getByTestId('customer-budgets-line-0')
      await expect(budgetRow).toBeVisible()
      await budgetRow.getByTestId('customer-budgets-amount-0').fill(String(config.budget.maxLimit))
      if (config.budget.resetDuration) {
        await this.selectResetDuration(budgetRow, config.budget.resetDuration)
      }
    }

    const saveBtn = this.customerSheet.getByRole('button', { name: /Create Customer/i })
    await expect(saveBtn).toBeEnabled()
    await saveBtn.click()
    await this.waitForSuccessToast('Customer created successfully')
    await expect(this.customerSheet).not.toBeVisible({ timeout: 10000 })
    await expect(this.getCustomerRow(config.name)).toBeVisible({ timeout: 10000 })
  }

  async deleteCustomer(name: string): Promise<void> {
    const row = this.getCustomerRow(name)
    await row.locator('[data-testid^="customer-actions-btn-"]').click()
    const deleteBtn = this.page.locator('[data-testid^="customer-button-delete-"]')
    await deleteBtn.click()

    const confirmBtn = this.page.getByTestId('customer-button-delete-confirm')
    await confirmBtn.waitFor({ state: 'visible', timeout: 5000 })
    await confirmBtn.click()
    await this.waitForSuccessToast()
    await expect.poll(() => this.customerExists(name), { timeout: 10000 }).toBe(false)
  }

  async closeCustomerDialog(): Promise<void> {
    if (await this.customerSheet.isVisible().catch(() => false)) {
      await this.customerSheet.getByRole('button', { name: /Cancel/i }).click()
      await expect(this.customerSheet).not.toBeVisible({ timeout: 10000 })
    }
  }

  async editTeam(name: string, updates: Partial<TeamConfig>): Promise<void> {
    await this.page.getByTestId(`team-actions-btn-${name}`).click()
    const editBtn = this.page.getByTestId(`team-edit-btn-${name}`)
    await editBtn.click()
    await expect(this.teamSheet).toBeVisible({ timeout: 5000 })
    await this.waitForSheetAnimation()

    if (updates.name) {
      await this.teamNameInput.clear()
      await this.teamNameInput.fill(updates.name)
    }

    if (updates.customerId !== undefined) {
      const trigger = this.page.getByTestId('team-customer-select-trigger')
      await trigger.click()
      if (updates.customerId === '') {
        await this.page.getByTestId('team-customer-option-none').click()
      } else {
        await this.page.getByTestId(`team-customer-option-${updates.customerId}`).click()
      }
    }

    if (updates.budget?.maxLimit !== undefined) {
      if ((await this.page.locator('[data-testid^="team-budget-row-"]').count()) === 0) {
        await this.page.getByTestId('team-add-budget-btn').click()
      }
      const budgetRow = this.page.getByTestId('team-budget-row-0')
      const budgetInput = budgetRow.getByTestId('budget-max-limit-input-0')
      await budgetInput.clear()
      await budgetInput.fill(String(updates.budget.maxLimit))
      if (updates.budget.resetDuration) {
        await this.selectResetDuration(budgetRow, updates.budget.resetDuration)
      }
    }

    const saveBtn = this.teamSheet.getByRole('button', { name: /Update Team/i })
    await expect(saveBtn).toBeEnabled()
    await saveBtn.click()
    await this.waitForSuccessToast('Team updated successfully')
    await expect(this.teamSheet).not.toBeVisible({ timeout: 10000 })
  }

  async editCustomer(name: string, updates: Partial<CustomerConfig>): Promise<void> {
    const row = this.getCustomerRow(name)
    await row.locator('[data-testid^="customer-actions-btn-"]').click()
    const editBtn = this.page.locator('[data-testid^="customer-button-edit-"]')
    await editBtn.click()
    await expect(this.customerSheet).toBeVisible({ timeout: 5000 })
    await this.waitForSheetAnimation()

    if (updates.name) {
      await this.customerNameInput.clear()
      await this.customerNameInput.fill(updates.name)
    }

    if (updates.budget?.maxLimit !== undefined) {
      if ((await this.page.locator('[data-testid^="customer-budgets-line-"]').count()) === 0) {
        await this.page.getByTestId('customer-budgets-add-btn').click()
      }
      const budgetRow = this.page.getByTestId('customer-budgets-line-0')
      const budgetInput = budgetRow.getByTestId('customer-budgets-amount-0')
      await budgetInput.clear()
      await budgetInput.fill(String(updates.budget.maxLimit))
      if (updates.budget.resetDuration) {
        await this.selectResetDuration(budgetRow, updates.budget.resetDuration)
      }
    }

    const saveBtn = this.customerSheet.getByRole('button', { name: /Update Customer/i })
    await expect(saveBtn).toBeEnabled()
    await saveBtn.click()
    await this.waitForSuccessToast('Customer updated successfully')
    await expect(this.customerSheet).not.toBeVisible({ timeout: 10000 })
  }

  private async selectResetDuration(container: Locator, resetDuration: string): Promise<void> {
    const label = resetDurationLabels[resetDuration]
    if (!label) {
      throw new Error(`unsupported resetDuration: ${resetDuration}`)
    }
    await container.getByRole('combobox').click()
    await this.page.getByRole('option', { name: label, exact: true }).click()
  }
}
