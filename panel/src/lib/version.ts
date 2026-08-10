interface ParsedVersion {
	major: number;
	minor: number;
	patch: number;
	prerelease: string[];
}

function parseVersion(value: string): ParsedVersion | undefined {
	const match = value.trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
	if (!match) return undefined;
	return {
		major: Number(match[1]),
		minor: Number(match[2] ?? 0),
		patch: Number(match[3] ?? 0),
		prerelease: match[4]?.split('.') ?? [],
	};
}

function comparePrerelease(left: string[], right: string[]): number {
	if (left.length === 0 && right.length > 0) return 1;
	if (right.length === 0 && left.length > 0) return -1;
	for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
		const leftPart = left[index];
		const rightPart = right[index];
		if (leftPart === undefined) return -1;
		if (rightPart === undefined) return 1;
		if (leftPart === rightPart) continue;
		const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : undefined;
		const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : undefined;
		if (leftNumber !== undefined && rightNumber !== undefined) return leftNumber > rightNumber ? 1 : -1;
		if (leftNumber !== undefined) return -1;
		if (rightNumber !== undefined) return 1;
		return leftPart > rightPart ? 1 : -1;
	}
	return 0;
}

export function compareVersions(leftValue: string, rightValue: string): number {
	const left = parseVersion(leftValue);
	const right = parseVersion(rightValue);
	if (!left || !right) return 0;
	for (const part of ['major', 'minor', 'patch'] as const) {
		if (left[part] !== right[part]) return left[part] > right[part] ? 1 : -1;
	}
	return comparePrerelease(left.prerelease, right.prerelease);
}

export function isVersionNewer(latestVersion: string, currentVersion: string): boolean {
	return compareVersions(latestVersion, currentVersion) > 0;
}
