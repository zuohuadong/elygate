import { c as desc, f as gte, l as and, m as sql, r as logs, s as users, t as db, u as eq } from "../../chunks/db.js";
import { n as requirePortalMember } from "../../chunks/portalAuth.js";
import { t as count } from "../../chunks/aggregate.js";
//#region src/routes/+page.server.ts
var load = async ({ locals }) => {
	const { org } = requirePortalMember(locals);
	const hourLabel = sql`TO_CHAR(${logs.createdAt}, 'HH24:00')`;
	const trendData = await db.select({
		label: hourLabel,
		costValue: sql`SUM(${logs.quotaCost})`,
		errorCount: sql`COUNT(*) FILTER (WHERE ${logs.statusCode} >= 400)`,
		avgLatency: sql`AVG(${logs.elapsedMs})`
	}).from(logs).where(and(eq(logs.orgId, org.id), gte(logs.createdAt, sql`NOW() - INTERVAL '24 hours'`))).groupBy(hourLabel).orderBy(hourLabel);
	const errorStats = await db.select({
		statusCode: logs.statusCode,
		count: count()
	}).from(logs).where(and(eq(logs.orgId, org.id), gte(logs.statusCode, 400), gte(logs.createdAt, sql`NOW() - INTERVAL '24 hours'`))).groupBy(logs.statusCode).orderBy(desc(count()));
	const modelDistribution = await db.select({
		name: logs.modelName,
		value: count()
	}).from(logs).where(and(eq(logs.orgId, org.id), gte(logs.createdAt, sql`NOW() - INTERVAL '30 days'`))).groupBy(logs.modelName).orderBy(desc(count())).limit(5);
	const [{ count: activeMembers }] = await db.select({ count: count() }).from(users).where(and(eq(users.orgId, org.id), eq(users.status, 1)));
	return { analytics: {
		usageTrend: trendData.map((row) => ({
			label: row.label,
			cost: Number(row.costValue),
			errors: Number(row.errorCount),
			latency: Math.round(Number(row.avgLatency || 0))
		})),
		modelDistribution: modelDistribution.map((row) => ({
			name: row.name,
			value: Number(row.value)
		})),
		errorStats: errorStats.map((row) => ({
			code: row.statusCode,
			count: Number(row.count)
		})),
		activeMembers: Number(activeMembers)
	} };
};
//#endregion
export { load };
