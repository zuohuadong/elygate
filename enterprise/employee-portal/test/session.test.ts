import { describe, expect, test } from 'bun:test';
import { SessionService } from '../src/auth/session.ts';

const service = new SessionService(
  new TextEncoder().encode('0123456789abcdef0123456789abcdef'),
  '/employee',
  true,
);

describe('employee session', () => {
  test('round-trips only the verified employee identity', async () => {
    const created = await service.createSession({
      providerId: 'supauth',
      userId: 'user-1',
      email: 'employee@example.com',
      name: 'Employee',
      roles: ['engineer'],
    });
    const session = await service.readSession(`elygate_employee_session=${encodeURIComponent(created.token)}`);
    expect(session).toMatchObject({ providerId: 'supauth', userId: 'user-1', email: 'employee@example.com', roles: ['engineer'] });
    expect(session.csrfToken.length).toBeGreaterThan(20);
    expect(service.sessionCookie(created.token)).toContain('Path=/employee/');
    expect(service.sessionCookie(created.token)).toContain('Secure');
    expect(service.sessionCookie(created.token)).toContain('HttpOnly');
  });

  test('rejects missing and invalid sessions', async () => {
    await expect(service.readSession(null)).rejects.toMatchObject({ status: 401 });
    await expect(service.readSession('elygate_employee_session=invalid')).rejects.toMatchObject({ status: 401 });
  });
});
