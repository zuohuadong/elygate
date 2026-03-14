export interface PortalUser {
	id: number;
	username: string;
	role: number;
}

export interface PortalOrg {
	id: number;
	name: string;
	totalQuota: number;
	usedQuota: number;
}

export interface PortalPolicy {
	allowedModels: string[];
	deniedModels: string[];
	allowedSubnets: string;
	quotaAlarmThreshold: number;
}

export interface PortalMember {
	id: number;
	username: string;
	role: number;
	quota: number;
	usedQuota: number;
	status: number;
	createdAt: string;
}

export interface PortalLogSummary {
	id: number;
	userId: number;
	username: string;
	tokenId: number | null;
	modelName: string;
	promptTokens: number;
	completionTokens: number;
	quotaCost: number;
	statusCode: number;
	createdAt: string;
	ipAddress: string | null;
	traceId: string | null;
	hasDetails: boolean;
}

export interface PortalLogDetail {
	id: number;
	userId: number;
	username: string;
	tokenId: number | null;
	modelName: string;
	promptTokens: number;
	completionTokens: number;
	quotaCost: number;
	statusCode: number;
	createdAt: string;
	elapsedMs: number | null;
	traceId: string | null;
	requestBody: unknown;
	responseBody: unknown;
}
