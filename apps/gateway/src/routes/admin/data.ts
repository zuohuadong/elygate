import type { ElysiaCtx } from '../../types';
import { Elysia } from 'elysia';
import { db, sql } from '@elygate/db';
import { channels, options, userGroups, vendors } from '@elygate/db/schema';
import { eq } from 'drizzle-orm';
import { decryptChannelKeys, encryptChannelKeys } from '../../services/encryption';

/**
 * 数据导出/导入/备份路由
 * 对标 new-api 后台的"数据库备份"和"配置导出/导入"功能。
 *
 * 导出：channels（含 key 结构但 mask 敏感字段）、options（排除密钥类配置）、userGroups、vendors
 * 导入：channels（批量创建）、options（覆盖）
 */

interface ExportPayload {
    version: string;
    exportedAt: string;
    channels: Record<string, any>[];
    options: Record<string, any>[];
    userGroups: Record<string, any>[];
    vendors: Record<string, any>[];
}

// 导出时需要排除的敏感 option key
const SENSITIVE_OPTION_KEYS = ['SMTPConfig', 'TelegramConfig', 'WebhookSecret', 'WebhookURL'];

export const dataRouter = new Elysia()
    // ─── 全量配置导出 ───
    .get('/data/export', async ({ set }: ElysiaCtx) => {
        const channelRows = await db.select({
            id: channels.id,
            type: channels.type,
            name: channels.name,
            baseUrl: channels.baseUrl,
            models: channels.models,
            modelMapping: channels.modelMapping,
            weight: channels.weight,
            priority: channels.priority,
            groups: channels.groups,
            status: channels.status,
            keyStrategy: channels.keyStrategy,
            keyStatus: channels.keyStatus,
            endpointType: channels.endpointType,
            testModel: channels.testModel,
            openaiOrganization: channels.openaiOrganization,
            autoBan: channels.autoBan,
            tag: channels.tag,
            setting: channels.setting,
            paramOverride: channels.paramOverride,
            headerOverride: channels.headerOverride,
            remark: channels.remark,
        }).from(channels);

        const optionRows = await db.select().from(options);
        const groupRows = await db.select().from(userGroups);
        const vendorRows = await db.select().from(vendors);

        // 过滤敏感配置
        const safeOptions = optionRows
            .filter(r => !SENSITIVE_OPTION_KEYS.includes(r.key))
            .map(r => ({ key: r.key, value: r.value }));

        const payload: ExportPayload = {
            version: '1.0',
            exportedAt: new Date().toISOString(),
            channels: channelRows,
            options: safeOptions,
            userGroups: groupRows,
            vendors: vendorRows,
        };

        set.headers['Content-Type'] = 'application/json';
        set.headers['Content-Disposition'] = `attachment; filename="elygate-config-${Date.now()}.json"`;
        return payload;
    })

    // ─── 全量配置导入 ───
    .post('/data/import', async ({ body, set }: ElysiaCtx) => {
        const payload = body as ExportPayload;
        if (!payload || !payload.version) {
            set.status = 400;
            return { success: false, message: 'Invalid import payload' };
        }

        let importedChannels = 0;
        let importedOptions = 0;
        let importedGroups = 0;
        let errors: string[] = [];

        // 导入 channels
        if (Array.isArray(payload.channels)) {
            for (const ch of payload.channels) {
                try {
                    await db.insert(channels).values({
                        type: ch.type || 1,
                        name: ch.name || `Imported-${Date.now()}`,
                        baseUrl: ch.baseUrl || 'https://api.openai.com',
                        key: ch.key || '',
                        models: ch.models || [],
                        modelMapping: ch.modelMapping || {},
                        weight: ch.weight || 1,
                        priority: ch.priority || 0,
                        groups: ch.groups || null,
                        status: ch.status || 1,
                        keyStrategy: ch.keyStrategy || 0,
                        endpointType: ch.endpointType || 'auto',
                        testModel: ch.testModel || null,
                        autoBan: ch.autoBan ?? 1,
                        tag: ch.tag || null,
                        setting: ch.setting || {},
                        paramOverride: ch.paramOverride || {},
                        headerOverride: ch.headerOverride || {},
                        remark: ch.remark || null,
                    });
                    importedChannels++;
                } catch (e: unknown) {
                    errors.push(`Channel "${ch.name}": ${e instanceof Error ? e.message : String(e)}`);
                }
            }
        }

        // 导入 options
        if (Array.isArray(payload.options)) {
            for (const opt of payload.options) {
                try {
                    if (SENSITIVE_OPTION_KEYS.includes(opt.key)) continue;
                    await db.insert(options).values({
                        key: opt.key,
                        value: typeof opt.value === 'string' ? opt.value : JSON.stringify(opt.value),
                    }).onConflictDoUpdate({
                        target: options.key,
                        set: { value: typeof opt.value === 'string' ? opt.value : JSON.stringify(opt.value) },
                    });
                    importedOptions++;
                } catch (e: unknown) {
                    errors.push(`Option "${opt.key}": ${e instanceof Error ? e.message : String(e)}`);
                }
            }
        }

        return {
            success: true,
            message: `Imported ${importedChannels} channels, ${importedOptions} options`,
            data: { importedChannels, importedOptions, importedGroups, errors: errors.length > 0 ? errors : undefined },
        };
    })

    // ─── 数据库备份（返回表行数统计） ───
    .get('/data/backup/status', async (): Promise<Record<string, any>> => {
        const tables = ['channels', 'users', 'tokens', 'logs', 'options', 'packages', 'redemptions', 'vendors', 'user_groups'];
        const stats: Record<string, number> = {};
        for (const table of tables) {
            try {
                const [row] = await db.execute(sql`SELECT count(*) as cnt FROM ${sql.raw(table)}`);
                stats[table] = Number((row as Record<string, any>)?.cnt || 0);
            } catch {
                stats[table] = -1;
            }
        }
        return { success: true, data: { stats, timestamp: new Date().toISOString() } };
    });
