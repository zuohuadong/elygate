/**
 * Centralized environment configuration.
 * All process.env access should go through this module.
 */

// --- Core ---
export const config = {
    /** Node environment */
    nodeEnv: process.env.NODE_ENV || 'development',
    /** JWT signing secret */
    jwtSecret: process.env.JWT_SECRET!,
    /** Admin panel password */
    adminPassword: process.env.ADMIN_PASSWORD || '',
    /** Admin API token */
    adminToken: process.env.ADMIN_TOKEN || '',
    /** Database connection URL */
    databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/elygate',

    // --- URLs ---
    /** Web frontend base URL */
    webUrl: process.env.WEB_URL || 'http://localhost:5173',
    /** Gateway API base URL */
    gatewayUrl: process.env.GATEWAY_URL || 'http://localhost:3000',

    // --- OAuth ---
    github: {
        clientId: process.env.GITHUB_CLIENT_ID || '',
        clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
        redirectUri: process.env.GITHUB_REDIRECT_URI || 'http://localhost:3000/api/auth/github/callback',
    },
    discord: {
        clientId: process.env.DISCORD_CLIENT_ID || '',
        clientSecret: process.env.DISCORD_CLIENT_SECRET || '',
        redirectUri: process.env.DISCORD_REDIRECT_URI || 'http://localhost:3000/api/auth/discord/callback',
    },
    telegram: {
        botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    },

    // --- Payment ---
    stripe: {
        secretKey: process.env.STRIPE_SECRET_KEY || '',
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    },
    epay: {
        appId: process.env.EPAY_APP_ID || '',
        appSecret: process.env.EPAY_APP_SECRET || '',
        gateway: process.env.EPAY_GATEWAY || 'https://api.epay.com',
    },

    // --- Encryption ---
    encryption: {
        secret: process.env.ENCRYPTION_SECRET || '',
        salt: process.env.ENCRYPTION_SALT || '',
    },

    // --- Misc ---
    /** Midjourney webhook secret */
    mjWebhookSecret: process.env.MJ_WEBHOOK_SECRET || '',
    /** Initial quota for new users */
    initialQuota: Number(process.env.INITIAL_QUOTA) || 500000,
    /** Enable health check endpoint */
    enableHealthCheck: process.env.ENABLE_HEALTH_CHECK === 'true',
} as const;

/** Whether running in production */
export const isProduction = config.nodeEnv === 'production';

/** OAuth availability flags */
export const oauthEnabled = {
    github: !!config.github.clientId,
    discord: !!config.discord.clientId,
    telegram: !!config.telegram.botToken,
} as const;

/** Well-known third-party API URLs — centralized to avoid hardcoded strings */
export const apiUrls = {
    github: {
        authorize: 'https://github.com/login/oauth/authorize',
        accessToken: 'https://github.com/login/oauth/access_token',
        user: 'https://github.com/user',
    },
    discord: {
        authorize: 'https://discord.com/api/oauth2/authorize',
        token: 'https://discord.com/api/oauth2/token',
        user: 'https://discord.com/api/users/@me',
    },
    /** Default fallback when channel has no base_url configured */
    openaiDefault: 'https://api.openai.com',
    geminiDefault: 'https://generativelanguage.googleapis.com',
    stripe: 'https://api.stripe.com',
    search: {
        serper: 'https://google.serper.dev/search',
        brave: 'https://api.search.brave.com/res/v1/web/search',
    },
} as const;
