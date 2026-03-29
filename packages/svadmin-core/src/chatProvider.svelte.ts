// Chat provider — headless interface for AI chat integration

/** Describes an actionable button rendered in assistant messages (tool-call UX). */
export interface ChatAction {
  label: string;
  /** Optional variant for styling (e.g. 'destructive' renders red) */
  variant?: 'default' | 'destructive' | 'outline';
  /** Arbitrary payload forwarded to the onAction handler */
  payload?: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  /** Tool-call action buttons rendered below the message bubble */
  actions?: ChatAction[];
}

/** Admin context automatically injected into chat system messages. */
export interface ChatContext {
  currentResource?: string;
  selectedRecordId?: string;
  currentView?: 'list' | 'edit' | 'create' | 'show';
  pathname?: string;
}

/**
 * ChatProvider interface for integrating AI chat into admin panels.
 * Implement `sendMessage` to connect to any AI backend (OpenAI, self-hosted, etc.)
 *
 * Return a `string` for non-streaming responses, or an `AsyncGenerator<string>`
 * for streaming (SSE / chunked) responses.
 */
export interface ChatProvider {
  sendMessage(
    messages: ChatMessage[],
    options?: { signal?: AbortSignal },
  ): Promise<string> | AsyncGenerator<string, void, unknown>;
}

// ─── Chat Provider singleton ───────────────────────────────────

let chatProvider: ChatProvider | null = $state(null);

export function setChatProvider(provider: ChatProvider): void {
  chatProvider = provider;
}

export function getChatProvider(): ChatProvider | null {
  return chatProvider;
}

// ─── Chat Context singleton ────────────────────────────────────

let chatContext = $state<ChatContext>({});

export function setChatContext(ctx: ChatContext): void {
  chatContext = ctx;
}

export function getChatContext(): ChatContext {
  return chatContext;
}
