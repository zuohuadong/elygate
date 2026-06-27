import { db } from '@elygate/db';
import { verificationCodes } from '@elygate/db/schema';
import { eq, and, desc, gte } from 'drizzle-orm';
import { log } from './logger';
import { generateCode, renderVerificationEmail, sendMail } from './mail';
import { optionCache } from './optionCache';

/**
 * 验证码服务
 * 对标 new-api 的邮件验证、密码重置、邮箱绑定通用验证码。
 * 所有验证码存入 verification_codes 表，10 分钟过期，单次使用。
 */

export const VERIFICATION_EXPIRE_MINUTES = 10;
const RATE_LIMIT_SECONDS = 60; // 同一目标 60 秒内只能发一次

export type VerificationType = 'email_verification' | 'password_reset' | 'email_bind' | 'universal';

interface CreateOptions {
    type: VerificationType;
    target: string;
    userId?: number;
    ipAddress?: string;
}

interface ConsumeOptions {
    type: VerificationType;
    target: string;
    code: string;
}

export function verificationExpiresAt(now = new Date()): Date {
    return new Date(now.getTime() + VERIFICATION_EXPIRE_MINUTES * 60 * 1000);
}

export function isVerificationCodeUsable(row: { code: string; expiresAt: Date | string }, code: string, now = new Date()): boolean {
    return new Date(row.expiresAt) >= now && row.code === code;
}

/**
 * 生成并存储验证码，同时发送邮件。
 */
export async function createAndSendVerification(opts: CreateOptions): Promise<{ success: boolean; message: string }> {
    const systemName = optionCache.get('SystemName', 'Elygate');

    // 频率限制：检查同一 target + type 在 RATE_LIMIT_SECONDS 内是否已发送
    const cutoff = new Date(Date.now() - RATE_LIMIT_SECONDS * 1000);
    const recent = await db.select({ id: verificationCodes.id, createdAt: verificationCodes.createdAt })
        .from(verificationCodes)
        .where(and(
            eq(verificationCodes.type, opts.type),
            eq(verificationCodes.target, opts.target),
            gte(verificationCodes.createdAt, cutoff),
        ))
        .orderBy(desc(verificationCodes.createdAt))
        .limit(1);

    if (recent.length > 0) {
        return { success: false, message: '请求过于频繁，请稍后再试' };
    }

    const code = generateCode(6);
    const expiresAt = verificationExpiresAt();

    await db.insert(verificationCodes).values({
        type: opts.type,
        target: opts.target,
        code,
        userId: opts.userId ?? null,
        ipAddress: opts.ipAddress ?? null,
        consumed: false,
        expiresAt,
    });

    // 发送邮件
    const purposeMap: Record<VerificationType, string> = {
        email_verification: '邮箱验证',
        password_reset: '密码重置',
        email_bind: '邮箱绑定',
        universal: '身份',
    };
    const purpose = purposeMap[opts.type] || '身份';
    const mailContent = renderVerificationEmail({ code, purpose, systemName, expireMinutes: VERIFICATION_EXPIRE_MINUTES });

    const sent = await sendMail({
        to: opts.target,
        subject: mailContent.subject,
        html: mailContent.html,
        text: mailContent.text,
    });

    if (!sent) {
        log.warn(`[Verification] Failed to send email to ${opts.target}, but code ${code} was stored`);
        return { success: false, message: '邮件发送失败，请检查 SMTP 配置' };
    }

    return { success: true, message: '验证码已发送' };
}

/**
 * 校验验证码（成功后自动标记为已消费）。
 */
export async function consumeVerification(opts: ConsumeOptions): Promise<{ valid: boolean; userId?: number; message: string }> {
    const rows = await db.select()
        .from(verificationCodes)
        .where(and(
            eq(verificationCodes.type, opts.type),
            eq(verificationCodes.target, opts.target),
            eq(verificationCodes.consumed, false),
        ))
        .orderBy(desc(verificationCodes.createdAt))
        .limit(5);

    if (rows.length === 0) {
        return { valid: false, message: '验证码不存在或已使用' };
    }

    const now = new Date();
    for (const row of rows) {
        if (!isVerificationCodeUsable(row, opts.code, now)) continue;

        await db.update(verificationCodes)
            .set({ consumed: true })
            .where(eq(verificationCodes.id, row.id));

        return { valid: true, userId: row.userId ?? undefined, message: '验证成功' };
    }

    return { valid: false, message: '验证码错误或已过期' };
}
