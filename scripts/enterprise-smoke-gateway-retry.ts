export type GatewayRetryOptions = {
    readonly explicitPort: number | null;
    readonly initialPort: number;
    readonly maxAttempts?: number;
    readonly allocatePort: () => Promise<number>;
    readonly runAttempt: (port: number, attempt: number) => Promise<void>;
    readonly cleanupAttempt: (error: unknown, attempt: number, port: number) => void | Promise<void>;
    readonly isRetryableError?: (error: unknown) => boolean;
    readonly warn?: (message: string) => void;
};

export function isAddressInUseError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('EADDRINUSE') || (message.includes('port') && message.includes('in use'));
}

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

export async function runGatewayWithRetries(options: GatewayRetryOptions): Promise<number> {
    const maxAttempts = options.explicitPort ? 1 : options.maxAttempts ?? 5;
    const isRetryableError = options.isRetryableError ?? isAddressInUseError;
    const warn = options.warn ?? console.warn;
    let port = options.initialPort;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (!options.explicitPort && attempt > 1) {
            port = await options.allocatePort();
        }

        try {
            await options.runAttempt(port, attempt);
            return port;
        } catch (error) {
            lastError = error;
            await options.cleanupAttempt(error, attempt, port);

            if (!options.explicitPort && attempt < maxAttempts && isRetryableError(error)) {
                warn(`[enterprise-runtime-smoke] gateway port retry ${attempt}/${maxAttempts}: ${toError(error).message}`);
                continue;
            }

            throw toError(error);
        }
    }

    throw toError(lastError);
}
