// Unit tests for ChatProvider types and ChatContext logic
// Since chatProvider.svelte.ts uses $state runes (requires Svelte compiler),
// we test the pure type shapes and serialization here — matching the project's
// pattern in i18n.test.ts of testing extracted logic.

import { describe, test, expect } from 'bun:test';

/** Mirror of ChatAction from chatProvider.svelte.ts */
interface ChatAction {
  label: string;
  variant?: 'default' | 'destructive' | 'outline';
  payload?: Record<string, unknown>;
}

/** Mirror of ChatMessage from chatProvider.svelte.ts */
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  actions?: ChatAction[];
}

/** Mirror of ChatContext from chatProvider.svelte.ts */
interface ChatContext {
  currentResource?: string;
  selectedRecordId?: string;
  currentView?: 'list' | 'edit' | 'create' | 'show';
  pathname?: string;
}

/** Build context system message (mirrors logic in ChatDialog.svelte) */
function buildContextSystemMessage(ctx: ChatContext): ChatMessage | null {
  if (!ctx.currentResource) return null;

  const parts: string[] = [];
  parts.push(`Resource: ${ctx.currentResource}`);
  if (ctx.currentView) parts.push(`View: ${ctx.currentView}`);
  if (ctx.selectedRecordId) parts.push(`Selected Record ID: ${ctx.selectedRecordId}`);
  if (ctx.pathname) parts.push(`Path: ${ctx.pathname}`);

  return {
    id: 'ctx-system',
    role: 'system',
    content: `[Admin Context] ${parts.join(' | ')}`,
    timestamp: Date.now(),
  };
}

describe('ChatMessage with actions', () => {
  test('message with actions serializes to JSON and back', () => {
    const actions: ChatAction[] = [
      { label: 'Delete Record', variant: 'destructive', payload: { id: '42' } },
      { label: 'View Details' },
    ];
    const msg: ChatMessage = {
      id: 'msg-1',
      role: 'assistant',
      content: 'I found a record to delete.',
      timestamp: 1711500000000,
      actions,
    };

    const serialized = JSON.stringify(msg);
    const deserialized = JSON.parse(serialized) as ChatMessage;

    expect(deserialized.actions).toHaveLength(2);
    expect(deserialized.actions![0].label).toBe('Delete Record');
    expect(deserialized.actions![0].variant).toBe('destructive');
    expect(deserialized.actions![0].payload).toEqual({ id: '42' });
    expect(deserialized.actions![1].variant).toBeUndefined();
  });

  test('message without actions has undefined actions', () => {
    const msg: ChatMessage = {
      id: 'msg-2',
      role: 'user',
      content: 'Hello',
      timestamp: 1711500000000,
    };
    expect(msg.actions).toBeUndefined();
  });

  test('system message persists correctly', () => {
    const msg: ChatMessage = {
      id: 'ctx-1',
      role: 'system',
      content: '[Admin Context] Resource: posts | View: edit',
      timestamp: 1711500000000,
    };
    const parsed = JSON.parse(JSON.stringify(msg)) as ChatMessage;
    expect(parsed.role).toBe('system');
    expect(parsed.content).toContain('posts');
  });
});

describe('buildContextSystemMessage', () => {
  test('returns null when no resource', () => {
    expect(buildContextSystemMessage({})).toBeNull();
  });

  test('builds message with resource only', () => {
    const msg = buildContextSystemMessage({ currentResource: 'users' });
    expect(msg).not.toBeNull();
    expect(msg!.role).toBe('system');
    expect(msg!.content).toContain('Resource: users');
  });

  test('includes all context fields', () => {
    const msg = buildContextSystemMessage({
      currentResource: 'posts',
      currentView: 'edit',
      selectedRecordId: '42',
      pathname: '/posts/edit/42',
    });
    expect(msg!.content).toContain('Resource: posts');
    expect(msg!.content).toContain('View: edit');
    expect(msg!.content).toContain('Selected Record ID: 42');
    expect(msg!.content).toContain('Path: /posts/edit/42');
  });

  test('omits undefined fields', () => {
    const msg = buildContextSystemMessage({
      currentResource: 'users',
      currentView: 'list',
    });
    expect(msg!.content).not.toContain('Selected Record ID');
    expect(msg!.content).not.toContain('Path');
  });
});

describe('ChatContext shape', () => {
  test('empty context is valid', () => {
    const ctx: ChatContext = {};
    expect(ctx.currentResource).toBeUndefined();
  });

  test('full context preserves all fields', () => {
    const ctx: ChatContext = {
      currentResource: 'orders',
      selectedRecordId: '99',
      currentView: 'show',
      pathname: '/orders/show/99',
    };
    expect(ctx.currentResource).toBe('orders');
    expect(ctx.selectedRecordId).toBe('99');
    expect(ctx.currentView).toBe('show');
    expect(ctx.pathname).toBe('/orders/show/99');
  });
});

describe('localStorage persistence simulation', () => {
  test('messages array round-trips through JSON', () => {
    const messages: ChatMessage[] = [
      { id: '1', role: 'user', content: 'Hello', timestamp: 1000 },
      {
        id: '2', role: 'assistant', content: 'Hi!', timestamp: 1001,
        actions: [{ label: 'Create Post', variant: 'default', payload: { resource: 'posts' } }],
      },
    ];
    const json = JSON.stringify(messages);
    const restored = JSON.parse(json) as ChatMessage[];

    expect(restored).toHaveLength(2);
    expect(restored[0].role).toBe('user');
    expect(restored[1].actions![0].label).toBe('Create Post');
  });
});
