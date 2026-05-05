import type { ElysiaCtx } from '../../types';
import { Elysia, t } from 'elysia';
import { sql } from '@elygate/db';

/**
 * Content management APIs for announcements, about, privacy, FAQ, pricing, etc.
 * All content is stored in the options table with specific keys.
 */
export const contentRouter = new Elysia()
    // --- Get all content ---
    .get('/content', async () => {
        const keys = [
            'Notice', 'About', 'PrivacyPolicy', 'UserAgreement', 'HomePageContent',
            'Footer_HTML', 'FAQ', 'PricingContent', 'SEO_Title', 'SEO_Description',
            'SEO_Keywords', 'Logo_URL', 'Custom_CSS', 'Custom_JS', 'Favicon',
            'ServerName', 'ServerAddress', 'GithubUrl',
        ];
        const rows = await sql`SELECT key, value FROM options WHERE key IN ${sql(keys)}`;
        const data: Record<string, string> = {};
        for (const r of rows) data[r.key] = r.value;
        return { success: true, data };
    })

    // --- Update content ---
    .put('/content', async ({ body }: ElysiaCtx) => {
        const payload = body as Record<string, string>;
        for (const [key, value] of Object.entries(payload)) {
            await sql`
                INSERT INTO options (key, value) VALUES (${key}, ${value})
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            `;
        }
        return { success: true };
    })

    // --- Get notice ---
    .get('/notice', async () => {
        const [row] = await sql`SELECT value FROM options WHERE key = 'Notice'`;
        return { success: true, data: row?.value || '' };
    })

    // --- Update notice ---
    .put('/notice', async ({ body }: ElysiaCtx) => {
        const { content } = body as { content: string };
        await sql`
            INSERT INTO options (key, value) VALUES ('Notice', ${content})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
        `;
        return { success: true };
    }, { body: t.Object({ content: t.String() }) })

    // --- Get pricing page content ---
    .get('/pricing', async () => {
        const [row] = await sql`SELECT value FROM options WHERE key = 'PricingContent'`;
        return { success: true, data: row?.value || '' };
    })

    // --- Get FAQ ---
    .get('/faq', async () => {
        const [row] = await sql`SELECT value FROM options WHERE key = 'FAQ'`;
        return { success: true, data: row?.value || '' };
    })

    // --- Get about ---
    .get('/about', async () => {
        const [row] = await sql`SELECT value FROM options WHERE key = 'About'`;
        return { success: true, data: row?.value || '' };
    })

    // --- Get privacy policy ---
    .get('/privacy', async () => {
        const [row] = await sql`SELECT value FROM options WHERE key = 'PrivacyPolicy'`;
        return { success: true, data: row?.value || '' };
    })

    // --- Get user agreement ---
    .get('/user-agreement', async () => {
        const [row] = await sql`SELECT value FROM options WHERE key = 'UserAgreement'`;
        return { success: true, data: row?.value || '' };
    })

    // --- Get home page content ---
    .get('/home-page', async () => {
        const [row] = await sql`SELECT value FROM options WHERE key = 'HomePageContent'`;
        return { success: true, data: row?.value || '' };
    });
