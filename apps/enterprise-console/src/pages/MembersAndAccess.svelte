<script lang="ts">
  import { onMount } from 'svelte';
  import { Plus, RefreshCw, Save } from '@lucide/svelte';
  import { createEnterpriseApiState, enterpriseApiGet, enterpriseApiPost, enterpriseApiPut } from '../enterpriseApi';

  type Entitlements = {
    seat_limit: number;
    assigned_seats: number;
    available_seats: number;
    billing_mode: string;
    overage_enabled: boolean;
    budget_mode: string;
    default_no_training: boolean;
    data_retention_days: number;
    provider_compliance_mode: string;
    allowed_ip_policy?: string | null;
  };

  type Membership = {
    id: number;
    user_id?: string | null;
    email?: string | null;
    display_name?: string | null;
    role: string;
    seat_kind: string;
    seat_status: string;
  };

  type MembersAndAccessResponse = {
    entitlements: Entitlements;
    memberships: { data: Membership[]; total: number };
  };

  let membersState = $state(createEnterpriseApiState<MembersAndAccessResponse>());
  let actionError = $state<string | null>(null);
  let savingEntitlements = $state(false);
  let creatingMember = $state(false);
  let seatLimit = $state(5);
  let overageEnabled = $state(false);
  let budgetMode = $state('hard_limit');
  let allowedIpPolicy = $state('');
  let memberEmail = $state('');
  let memberUserId = $state('');
  let memberName = $state('');
  let memberRole = $state('developer');
  let memberSeatKind = $state('human');

  async function load() {
    membersState.loading = true;
    membersState.error = null;
    try {
      membersState.data = await enterpriseApiGet<MembersAndAccessResponse>('/members-and-access');
      seatLimit = membersState.data.entitlements.seat_limit;
      overageEnabled = membersState.data.entitlements.overage_enabled;
      budgetMode = membersState.data.entitlements.budget_mode;
      allowedIpPolicy = membersState.data.entitlements.allowed_ip_policy ?? '';
    } catch (error) {
      membersState.error = error instanceof Error ? error.message : String(error);
    } finally {
      membersState.loading = false;
    }
  }

  async function saveEntitlements() {
    actionError = null;
    savingEntitlements = true;
    try {
      await enterpriseApiPut('/org-entitlements', {
        seat_limit: seatLimit,
        overage_enabled: overageEnabled,
        budget_mode: budgetMode,
        allowed_ip_policy: allowedIpPolicy || null,
      });
      await load();
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error);
    } finally {
      savingEntitlements = false;
    }
  }

  async function createMember() {
    actionError = null;
    creatingMember = true;
    try {
      await enterpriseApiPost('/memberships', {
        email: memberEmail || null,
        user_id: memberUserId || null,
        display_name: memberName || null,
        role: memberRole,
        seat_kind: memberSeatKind,
        seat_status: memberUserId ? 'active' : 'invited',
      });
      memberEmail = '';
      memberUserId = '';
      memberName = '';
      await load();
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error);
    } finally {
      creatingMember = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="enterprise-page">
  <header>
    <div>
      <h1>成员与席位</h1>
      <p>{membersState.data?.entitlements.assigned_seats ?? 0} / {membersState.data?.entitlements.seat_limit ?? seatLimit} seats</p>
    </div>
    <button class="enterprise-button enterprise-button-secondary" type="button" onclick={() => void load()} disabled={membersState.loading}>
      <RefreshCw size={14} />
      刷新
    </button>
  </header>

  {#if membersState.error || actionError}
    <div class="enterprise-error">{membersState.error ?? actionError}</div>
  {:else if membersState.loading}
    <div class="enterprise-empty">加载成员与席位...</div>
  {:else if membersState.data}
    <div class="enterprise-grid">
      <article class="enterprise-card">
        <h3>已分配席位</h3>
        <div class="enterprise-stat">{membersState.data.entitlements.assigned_seats}</div>
      </article>
      <article class="enterprise-card">
        <h3>可用席位</h3>
        <div class="enterprise-stat">{membersState.data.entitlements.available_seats}</div>
      </article>
      <article class="enterprise-card">
        <h3>预算模式</h3>
        <p>{membersState.data.entitlements.budget_mode}</p>
      </article>
    </div>

    <form class="enterprise-form" onsubmit={(event) => { event.preventDefault(); void saveEntitlements(); }}>
      <label>
        席位上限
        <input type="number" min="0" bind:value={seatLimit} />
      </label>
      <label>
        预算模式
        <select bind:value={budgetMode}>
          <option value="hard_limit">hard_limit</option>
          <option value="warn">warn</option>
          <option value="overage">overage</option>
        </select>
      </label>
      <label>
        超额按量
        <select bind:value={overageEnabled}>
          <option value={false}>关闭</option>
          <option value={true}>开启</option>
        </select>
      </label>
      <label class="enterprise-form-wide">
        固定 IP / CIDR
        <textarea rows="2" bind:value={allowedIpPolicy} placeholder="203.0.113.7,10.0.0.0/8"></textarea>
      </label>
      <button class="enterprise-button" type="submit" disabled={savingEntitlements}>
        <Save size={14} />
        保存
      </button>
    </form>

    <form class="enterprise-form" onsubmit={(event) => { event.preventDefault(); void createMember(); }}>
      <label>
        Email
        <input bind:value={memberEmail} placeholder="dev@example.com" />
      </label>
      <label>
        User ID
        <input bind:value={memberUserId} placeholder="user_..." />
      </label>
      <label>
        姓名
        <input bind:value={memberName} placeholder="Name" />
      </label>
      <label>
        角色
        <select bind:value={memberRole}>
          <option value="owner">owner</option>
          <option value="admin">admin</option>
          <option value="developer">developer</option>
          <option value="billing">billing</option>
          <option value="auditor">auditor</option>
        </select>
      </label>
      <label>
        席位类型
        <select bind:value={memberSeatKind}>
          <option value="human">human</option>
          <option value="service_account">service_account</option>
        </select>
      </label>
      <button class="enterprise-button" type="submit" disabled={creatingMember}>
        <Plus size={14} />
        添加
      </button>
    </form>

    <div class="enterprise-table-wrap">
      <table class="enterprise-table">
        <thead>
          <tr>
            <th>成员</th>
            <th>角色</th>
            <th>席位</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          {#each membersState.data.memberships.data as member (member.id)}
            <tr>
              <td>{member.display_name ?? member.email ?? member.user_id ?? '-'}</td>
              <td>{member.role}</td>
              <td>{member.seat_kind}</td>
              <td>{member.seat_status}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
