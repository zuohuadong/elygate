<script lang="ts">
  import { onMount } from 'svelte';
  import { Plus, RefreshCw, Save } from '@lucide/svelte';
  import { createEnterpriseApiState, enterpriseApiGet, enterpriseApiPost } from '../enterpriseApi';

  type BillingAccount = {
    billing_name: string;
    billing_email?: string | null;
    tax_id?: string | null;
    currency: string;
    payment_terms: string;
    status: string;
  };

  type Invoice = {
    id: number;
    invoice_number: string;
    period_start?: string;
    period_end?: string;
    currency: string;
    subtotal_cents: number;
    tax_cents: number;
    total_cents: number;
    status: string;
  };

  type BillingResponse = {
    billing_account: BillingAccount | null;
    invoices: { data: Invoice[]; total: number };
    unbilled_usage: { quantity: number; amount_cents: number };
  };

  let billingState = $state(createEnterpriseApiState<BillingResponse>());
  let actionError = $state<string | null>(null);
  let savingAccount = $state(false);
  let creatingInvoice = $state(false);
  let billingName = $state('');
  let billingEmail = $state('');
  let taxId = $state('');
  let currency = $state('USD');
  let paymentTerms = $state('net_30');
  let invoiceDescription = $state('Enterprise service');
  let invoiceAmountCents = $state(0);

  function money(cents: number | undefined, code = currency): string {
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: code || 'USD' }).format((cents ?? 0) / 100);
  }

  function formatDate(value?: string): string {
    return value ? new Date(value).toLocaleDateString('zh-CN') : '-';
  }

  async function load() {
    billingState.loading = true;
    billingState.error = null;
    try {
      billingState.data = await enterpriseApiGet<BillingResponse>('/billing-and-invoices');
      billingName = billingState.data.billing_account?.billing_name ?? '';
      billingEmail = billingState.data.billing_account?.billing_email ?? '';
      taxId = billingState.data.billing_account?.tax_id ?? '';
      currency = billingState.data.billing_account?.currency ?? 'USD';
      paymentTerms = billingState.data.billing_account?.payment_terms ?? 'net_30';
    } catch (error) {
      billingState.error = error instanceof Error ? error.message : String(error);
    } finally {
      billingState.loading = false;
    }
  }

  async function saveBillingAccount() {
    actionError = null;
    savingAccount = true;
    try {
      await enterpriseApiPost('/billing-account', {
        billing_name: billingName || 'Enterprise Account',
        billing_email: billingEmail || null,
        tax_id: taxId || null,
        currency,
        payment_terms: paymentTerms,
      });
      await load();
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error);
    } finally {
      savingAccount = false;
    }
  }

  async function createInvoice() {
    actionError = null;
    creatingInvoice = true;
    try {
      await enterpriseApiPost('/invoices', {
        currency,
        items: [
          {
            item_type: 'manual',
            description: invoiceDescription,
            quantity: 1,
            amount_cents: invoiceAmountCents,
          },
        ],
      });
      invoiceDescription = 'Enterprise service';
      invoiceAmountCents = 0;
      await load();
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error);
    } finally {
      creatingInvoice = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="enterprise-page">
  <header>
    <div>
      <h1>账单发票</h1>
      <p>{billingState.data?.invoices.total ?? 0} invoices</p>
    </div>
    <button class="enterprise-button enterprise-button-secondary" type="button" onclick={() => void load()} disabled={billingState.loading}>
      <RefreshCw size={14} />
      刷新
    </button>
  </header>

  {#if billingState.error || actionError}
    <div class="enterprise-error">{billingState.error ?? actionError}</div>
  {:else if billingState.loading}
    <div class="enterprise-empty">加载账单...</div>
  {:else if billingState.data}
    <div class="enterprise-grid">
      <article class="enterprise-card">
        <h3>未出账用量</h3>
        <div class="enterprise-stat">{billingState.data.unbilled_usage.quantity}</div>
      </article>
      <article class="enterprise-card">
        <h3>未出账金额</h3>
        <div class="enterprise-stat">{money(billingState.data.unbilled_usage.amount_cents)}</div>
      </article>
    </div>

    <form class="enterprise-form" onsubmit={(event) => { event.preventDefault(); void saveBillingAccount(); }}>
      <label>
        账单主体
        <input bind:value={billingName} placeholder="Company Inc." />
      </label>
      <label>
        账单邮箱
        <input bind:value={billingEmail} placeholder="billing@example.com" />
      </label>
      <label>
        税号
        <input bind:value={taxId} placeholder="Tax ID" />
      </label>
      <label>
        币种
        <input bind:value={currency} placeholder="USD" />
      </label>
      <label>
        账期
        <select bind:value={paymentTerms}>
          <option value="due_on_receipt">due_on_receipt</option>
          <option value="net_15">net_15</option>
          <option value="net_30">net_30</option>
          <option value="net_60">net_60</option>
        </select>
      </label>
      <button class="enterprise-button" type="submit" disabled={savingAccount}>
        <Save size={14} />
        保存
      </button>
    </form>

    <form class="enterprise-form" onsubmit={(event) => { event.preventDefault(); void createInvoice(); }}>
      <label>
        明细
        <input bind:value={invoiceDescription} />
      </label>
      <label>
        金额 cents
        <input type="number" min="0" bind:value={invoiceAmountCents} />
      </label>
      <button class="enterprise-button" type="submit" disabled={creatingInvoice}>
        <Plus size={14} />
        创建发票草稿
      </button>
    </form>

    <div class="enterprise-table-wrap">
      <table class="enterprise-table">
        <thead>
          <tr>
            <th>发票号</th>
            <th>周期</th>
            <th>金额</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          {#each billingState.data.invoices.data as invoice (invoice.id)}
            <tr>
              <td>{invoice.invoice_number}</td>
              <td>{formatDate(invoice.period_start)} - {formatDate(invoice.period_end)}</td>
              <td>{money(invoice.total_cents, invoice.currency)}</td>
              <td>{invoice.status}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
