export type ChannelErrorAction = 'mark-key' | 'disable-channel' | 'mark-busy' | 'ignore-client-error' | 'record-window-failure';

export function classifyChannelError(status?: number, hasActiveKey = false): ChannelErrorAction {
    if ((status === 401 || status === 403) && hasActiveKey) return 'mark-key';
    if (status === 401) return 'disable-channel';
    if (status === 403 || status === 429) return 'mark-busy';
    if (status && status >= 400 && status < 500) return 'ignore-client-error';
    return 'record-window-failure';
}
