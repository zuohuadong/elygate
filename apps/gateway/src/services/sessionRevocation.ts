export type AuthSessionCookie = {
    value?: string | null;
    remove: () => void;
};

export async function revokeAuthSession(
    authSession: AuthSessionCookie,
    deleteSessionByToken: (token: string) => Promise<unknown>,
): Promise<{ success: true; revoked: boolean; message: string }> {
    const token = typeof authSession.value === 'string' ? authSession.value : '';
    if (token) {
        await deleteSessionByToken(token);
    }
    authSession.remove();
    return { success: true, revoked: Boolean(token), message: 'Logged out successfully' };
}
