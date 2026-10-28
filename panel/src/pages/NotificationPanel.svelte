<script lang="ts">
	import { onMount } from 'svelte';
	import { ArrowUpRight, Bell, Mail, MailOpen, RefreshCw, X } from '@lucide/svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { displayError } from '../lib/forms';
	import { encodePathSegment, requestJson } from '../lib/api';
	import { appendNotificationPage, notificationActionHref, parseNotificationFeed, parseNotificationReadState, parseNotificationReadStates, type NotificationReadState, type PanelNotification } from '../lib/notifications';

	const i18n = useTranslation();
	const popoverId = $props.id();
	let open = $state(false);
	let loading = $state(false);
	let error = $state('');
	let receiptError = $state('');
	let mutationError = $state('');
	let receipts = $state<Partial<Record<string, NotificationReadState>>>({});
	let savingID = $state('');
	let notifications = $state<PanelNotification[]>([]);
	const unreadCount = $derived(notifications.filter((notification) => receipts[notification.id]?.read === false).length);
	const unknownCount = $derived(notifications.filter((notification) => !receipts[notification.id]).length);
	let nextCursor = $state('');
	let historyLoaded = $state(false);
	let popoverTop = $state(72);
	let popoverRight = $state(16);
	let loadSequence = 0;
	let activeRequest: AbortController | undefined;
	let mutationRequest: AbortController | undefined;
	let triggerButton: HTMLButtonElement | undefined;
	let closeButton: HTMLButtonElement | undefined;
	let popover: HTMLDivElement | undefined;

	function text(zh: string, en: string): string {
		return i18n.locale === 'zh-CN' ? zh : en;
	}

	function severityLabel(severity: PanelNotification['severity']): string {
		return {
			info: text('提示', 'Info'),
			success: text('成功', 'Success'),
			warning: text('预警', 'Warning'),
			error: text('错误', 'Error'),
		}[severity];
	}

	function date(timestamp: string): string {
		return new Intl.DateTimeFormat(i18n.locale, {
			dateStyle: 'medium',
			timeStyle: 'short',
			timeZone: 'UTC',
		}).format(new Date(timestamp));
	}

	async function load(cursor = ''): Promise<void> {
		if (savingID) return;
		const sequence = ++loadSequence;
		activeRequest?.abort();
		const request = new AbortController();
		activeRequest = request;
		loading = true;
		error = '';
		try {
			const query = new URLSearchParams({ limit: '50' });
			if (cursor) query.set('cursor', cursor);
			const feed = parseNotificationFeed(await requestJson<unknown>(`/api/notifications?${query}`, { signal: request.signal }));
			if (sequence !== loadSequence) return;
			if (cursor) {
				notifications = appendNotificationPage(notifications, feed.notifications);
			} else {
				notifications = appendNotificationPage([], feed.notifications);
			}
			historyLoaded = cursor !== '';
			nextCursor = feed.next_cursor ?? '';
			receipts = cursor ? Object.fromEntries(Object.entries(receipts).filter(([id]) => !feed.notifications.some((notification) => notification.id === id))) : {};
			receiptError = '';
			mutationError = '';
			await loadReadStates(feed.notifications, request.signal, sequence);
		} catch (cause) {
			if (sequence === loadSequence) error = displayError(cause, text('通知加载失败', 'Failed to load notifications'));
		} finally {
			if (sequence === loadSequence) loading = false;
		}
	}

	async function loadReadStates(page: PanelNotification[], signal: AbortSignal, sequence: number): Promise<void> {
		if (page.length === 0) return;
		try {
			const ids = page.map((notification) => notification.id);
			const query = new URLSearchParams(ids.map((id) => ['notification_id', id]));
			const states = parseNotificationReadStates(await requestJson<unknown>(`/api/control-plane/notification-receipts?${query}`, { signal }), ids);
			if (sequence === loadSequence) receipts = { ...receipts, ...states };
		} catch (cause) {
			if (sequence === loadSequence) receiptError = displayError(cause, text('已读状态加载失败', 'Failed to load read states'));
		}
	}

	async function toggleRead(notification: PanelNotification): Promise<void> {
		const current = receipts[notification.id];
		if (!current || loading || savingID) return;
		const request = new AbortController();
		mutationRequest = request;
		savingID = notification.id;
		mutationError = '';
		try {
			const state = parseNotificationReadState(await requestJson<unknown>(`/api/control-plane/notification-receipts/${encodePathSegment(notification.id)}`, {
				method: 'PUT', body: JSON.stringify({ read: !current.read }), signal: request.signal,
			}), notification.id);
			if (!request.signal.aborted) receipts = { ...receipts, [notification.id]: state };
		} catch (cause) {
			if (!request.signal.aborted) {
				// A lost response does not prove the transaction failed.
				delete receipts[notification.id];
				mutationError = displayError(cause, text('已读状态保存失败', 'Failed to save read state'));
			}
		} finally {
			if (!request.signal.aborted) savingID = '';
		}
	}

	function positionPopover(): void {
		if (!open || !triggerButton || !popover) return;
		const triggerBounds = triggerButton.getBoundingClientRect();
		const maxRight = Math.max(16, window.innerWidth - popover.getBoundingClientRect().width - 16);
		popoverTop = Math.max(16, Math.min(triggerBounds.bottom + 8, window.innerHeight - 96));
		popoverRight = Math.min(maxRight, Math.max(16, window.innerWidth - triggerBounds.right));
	}

	function syncOpen(event: ToggleEvent): void {
		open = event.newState === 'open';
		if (!open) return;
		positionPopover();
		closeButton?.focus();
		if (notifications.length === 0 && !loading) void load();
	}

	function closePanel(): void {
		popover?.hidePopover();
		open = false;
		triggerButton?.focus();
	}

	function closeOnEscape(event: KeyboardEvent): void {
		if (!open || event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		closePanel();
	}

	onMount(() => {
		void load();
		window.addEventListener('resize', positionPopover);
		const headerObserver = new ResizeObserver(positionPopover);
		const header = triggerButton?.closest('header');
		if (header) headerObserver.observe(header);
		const pollTimer = setInterval(() => {
			if (!loading && !(open && historyLoaded) && document.visibilityState !== 'hidden') void load();
		}, 60_000);
		return () => {
			loadSequence += 1;
			activeRequest?.abort();
			mutationRequest?.abort();
			window.removeEventListener('resize', positionPopover);
			headerObserver.disconnect();
			clearInterval(pollTimer);
		};
	});
</script>

<svelte:window onkeydown={closeOnEscape} />

<div class="notification-anchor">
	<button
		class="notification-trigger"
		bind:this={triggerButton}
		type="button"
		aria-label={text('打开通知', 'Open notifications')}
		aria-expanded={open}
		aria-controls={popoverId}
		aria-haspopup="dialog"
		popovertarget={popoverId}
		title={text('通知', 'Notifications')}
	>
		<Bell size={17} aria-hidden="true" />
		{#if unreadCount > 0 || unknownCount > 0}<span class="notification-count" title={text(`已加载未读 ${unreadCount} 条，${unknownCount} 条状态未知`, `${unreadCount} loaded unread, ${unknownCount} unknown`)}>{unknownCount > 0 ? '?' : unreadCount > 99 ? '99+' : unreadCount}</span>{/if}
	</button>

		<div
			id={popoverId}
			bind:this={popover}
			class="notification-popover"
			popover="auto"
			role="dialog"
			tabindex="-1"
			aria-label={text('通知中心', 'Notification center')}
			style={`--notification-top: ${popoverTop}px; right: ${popoverRight}px`}
			ontoggle={syncOpen}
		>
			<header>
				<div>
					<strong>{text('通知', 'Notifications')}</strong>
					<span role="status" aria-atomic="true">{text(`已加载未读 ${unreadCount} 条`, `${unreadCount} loaded unread`)}{unknownCount > 0 ? text(` · ${unknownCount} 条状态未知`, ` · ${unknownCount} unknown`) : ''}</span>
				</div>
				<div class="header-actions">
					<button type="button" class="icon-button" aria-label={text('刷新通知', 'Refresh notifications')} title={text('刷新通知', 'Refresh notifications')} onclick={() => void load()} disabled={loading || !!savingID}><RefreshCw size={15} aria-hidden="true" /></button>
					<button bind:this={closeButton} type="button" class="icon-button" aria-label={text('关闭通知', 'Close notifications')} title={text('关闭通知', 'Close notifications')} onclick={closePanel}><X size={15} aria-hidden="true" /></button>
				</div>
			</header>
			{#if error}
				<p class="notice error" role="alert">{error}</p>
			{/if}
			{#if receiptError}<p class="notice error" role="alert">{text('已读状态不可用', 'Read states unavailable')}: {receiptError}</p>{/if}
			{#if mutationError}<p class="notice error" role="alert">{mutationError}</p>{/if}
			{#if loading && notifications.length === 0}
				<p class="notice" role="status">{text('正在加载通知…', 'Loading notifications…')}</p>
			{:else if notifications.length === 0}
				{#if !error}<p class="notice">{text('暂无通知', 'No notifications')}</p>{/if}
			{:else}
				<ul aria-busy={loading}>
					{#each notifications as notification (notification.id)}
						{@const actionHref = notificationActionHref(notification.action_path)}
						{@const receipt = receipts[notification.id]}
						<li class={`notification-row ${notification.severity}`} class:is-read={receipt?.read === true}>
							<div class="notification-copy">
								<div class="notification-title"><span class="severity-dot" aria-hidden="true"></span><strong>{notification.title}</strong><span class="severity-label">{severityLabel(notification.severity)}</span></div>
								<p>{notification.message}</p>
								<time datetime={notification.created_at}>{date(notification.created_at)} UTC</time>
							</div>
							<div class="notification-footer">
								<div class="read-state">
									<span>{savingID === notification.id ? text('正在保存…', 'Saving…') : !receipt ? text('状态未知', 'Status unknown') : receipt.read ? text('已读', 'Read') : text('未读', 'Unread')}</span>
									<button type="button" class="icon-button" aria-label={receipt?.read ? text('标为未读', 'Mark unread') : text('标为已读', 'Mark read')} title={receipt?.read ? text('标为未读', 'Mark unread') : text('标为已读', 'Mark read')} onclick={() => void toggleRead(notification)} aria-disabled={!receipt || loading || !!savingID} aria-busy={savingID === notification.id}>
										{#if receipt?.read}<Mail size={16} aria-hidden="true" />{:else}<MailOpen size={16} aria-hidden="true" />{/if}
									</button>
								</div>
								{#if notification.action_label && actionHref}
									<a class="action-link" href={actionHref} onclick={closePanel}><span>{notification.action_label}</span><ArrowUpRight size={14} aria-hidden="true" /></a>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
			{#if nextCursor}<button class="load-more" type="button" onclick={() => void load(nextCursor)} disabled={loading || !!savingID}>{text('加载更早通知', 'Load older notifications')}</button>{/if}
		</div>
</div>

<style>
	.notification-anchor { position: relative; }
	.notification-trigger, .icon-button { align-items: center; background: transparent; border: 1px solid var(--border); border-radius: .45rem; color: inherit; cursor: pointer; display: inline-flex; justify-content: center; min-height: 2.5rem; min-width: 2.5rem; padding: .45rem; position: relative; }
	.notification-trigger:hover, .icon-button:hover { background: var(--muted); }
	.notification-count { align-items: center; background: var(--muted); border: 2px solid var(--background); border-radius: 999px; color: var(--foreground); display: flex; font-size: .65rem; font-weight: 700; height: 1.15rem; justify-content: center; min-width: 1.15rem; padding: 0 .2rem; position: absolute; right: -.35rem; top: -.35rem; }
	.notification-popover { background: var(--background); border: 1px solid var(--border); border-radius: .5rem; box-shadow: 0 16px 42px rgb(0 0 0 / .16); color: var(--foreground); gap: .75rem; inset: auto; margin: 0; max-height: min(34rem, calc(100dvh - var(--notification-top) - 1rem)); overflow: auto; padding: .9rem; position: fixed; top: var(--notification-top); width: min(27rem, calc(100vw - 2rem)); }
	.notification-popover:popover-open { display: grid; }
	.notification-popover header, .header-actions, .notification-title, .action-link { align-items: center; display: flex; gap: .45rem; }
	.notification-popover header { justify-content: space-between; }
	.notification-popover header div:first-child { display: grid; gap: .15rem; }
	.notification-popover header span, .notification-copy time, .severity-label { color: var(--muted-foreground); font-size: .75rem; }
	.header-actions { gap: .3rem; }
	.icon-button { border: 0; min-height: 2rem; min-width: 2rem; }
	ul { display: grid; gap: .55rem; list-style: none; margin: 0; padding: 0; }
	.notification-row { border: 1px solid var(--border); border-left: .2rem solid var(--primary); border-radius: .45rem; display: grid; gap: .55rem; padding: .7rem; }
	.notification-row.warning { border-left-color: #b7791f; }
	.notification-row.error { border-left-color: var(--destructive); }
	.notification-row.success { border-left-color: #2f8f63; }
	.notification-title { align-items: flex-start; min-width: 0; }
	.notification-title strong { flex: 1; min-width: 0; overflow-wrap: anywhere; }
	.severity-label { flex-shrink: 0; }
	.severity-dot { background: var(--primary); border-radius: 50%; flex: 0 0 .45rem; height: .45rem; }
	.warning .severity-dot { background: #b7791f; }
	.error .severity-dot { background: var(--destructive); }
	.success .severity-dot { background: #2f8f63; }
	.notification-copy p { margin: .35rem 0; overflow-wrap: anywhere; }
	.notification-footer, .read-state { align-items: center; display: flex; gap: .5rem; min-width: 0; }
	.notification-footer { flex-wrap: wrap; justify-content: space-between; }
	.read-state { color: var(--muted-foreground); font-size: .75rem; }
	.is-read .notification-title strong { font-weight: 500; }
	.action-link, .load-more { background: transparent; border: 0; color: var(--primary); cursor: pointer; font: inherit; padding: .2rem 0; }
	.action-link { justify-content: flex-start; min-width: 0; overflow-wrap: anywhere; text-align: left; text-decoration: none; }
	.action-link :global(svg) { flex-shrink: 0; }
	.action-link:hover { text-decoration: underline; }
	.load-more { border-top: 1px solid var(--border); padding-top: .65rem; width: 100%; }
	.notice { margin: 0; }
	.notice.error { color: var(--destructive); }
	button:focus-visible, a:focus-visible { outline: 2px solid var(--ring, var(--primary)); outline-offset: 2px; }
	button:disabled, button[aria-disabled="true"] { cursor: not-allowed; opacity: .55; }
	@media (max-width: 600px) { .notification-trigger, .icon-button { min-height: 2.75rem; min-width: 2.75rem; } .action-link, .load-more { min-height: 2.75rem; } }
</style>
