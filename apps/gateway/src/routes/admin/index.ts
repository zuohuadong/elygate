import { Elysia } from 'elysia';
import { adminGuard } from '../../middleware/auth';
import { memoryCache } from '../../services/cache';
import { optionCache } from '../../services/optionCache';
import { channelsRouter } from './channels';
import { groupsRouter } from './groups';
import { usersRouter } from './users';
import { logsRouter } from './logs';
import { dashboardRouter } from './dashboard';
import { packagesRouter } from './packages';
import { settingsRouter } from './settings';

/**
 * Refresh both memory cache and option cache.
 * Shared across admin sub-modules.
 */
export async function refreshAllCaches(): Promise<void> {
    await memoryCache.refresh();
    await optionCache.refresh();
}

/**
 * Admin Router - aggregates all admin sub-routes.
 * Prefix will be applied in the main index.ts.
 */
export const adminRouter = new Elysia()
    .use(adminGuard)
    .guard({
        beforeHandle: ({ user, set }: any) => {
            if (!user || user.role < 10) {
                set.status = 403;
                throw new Error('Forbidden: Admin privileges required');
            }
        }
    })
    .use(groupsRouter)
    .use(channelsRouter)
    .use(usersRouter)
    .use(logsRouter)
    .use(dashboardRouter)
    .use(packagesRouter)
    .use(settingsRouter);
