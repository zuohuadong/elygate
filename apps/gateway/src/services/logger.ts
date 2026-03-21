import { formatWithOptions } from "util";

/**
 * High-performance Asynchronous Logging Service (Bun Optimized)
 * Intercepts native global console.log synchronous calls, utilizes queueMicrotask
 * and batched stdout/stderr writing to maximize throughput and eliminate I/O blocking.
 */
class AsyncLogger {
    private stdoutQueue: string[] = [];
    private stderrQueue: string[] = [];
    private flushScheduled = false;

    private formatArgs(args: unknown[]): string {
        return formatWithOptions({ colors: true, depth: 3 }, ...args);
    }

    private scheduleFlush() {
        if (!this.flushScheduled) {
            this.flushScheduled = true;
            queueMicrotask(() => this.flush());
        }
    }

    private flush() {
        this.flushScheduled = false;
        if (this.stdoutQueue.length > 0) {
            const batch = this.stdoutQueue.join('\n') + '\n';
            this.stdoutQueue.length = 0;
            process.stdout.write(batch);
        }
        if (this.stderrQueue.length > 0) {
            const batch = this.stderrQueue.join('\n') + '\n';
            this.stderrQueue.length = 0;
            process.stderr.write(batch);
        }
    }

    public log(...args: unknown[]) {
        this.stdoutQueue.push(this.formatArgs(args));
        this.scheduleFlush();
    }

    public warn(...args: unknown[]) {
        this.stderrQueue.push(this.formatArgs(args));
        this.scheduleFlush();
    }

    public error(...args: unknown[]) {
        this.stderrQueue.push(this.formatArgs(args));
        this.scheduleFlush();
    }
}

const asyncLogger = new AsyncLogger();
const originalLog = console.log;

/** Structured log object — use instead of console.* */
export const log = {
    info: (...args: unknown[]) => asyncLogger.log(...args),
    warn: (...args: unknown[]) => asyncLogger.warn(...args),
    error: (...args: unknown[]) => asyncLogger.error(...args),
    debug: (...args: unknown[]) => asyncLogger.log('[DEBUG]', ...args),
};

export function overrideConsole(): void {
    console.log = (...args: unknown[]) => asyncLogger.log(...args);
    console.info = (...args: unknown[]) => asyncLogger.log(...args);
    console.warn = (...args: unknown[]) => asyncLogger.warn(...args);
    console.error = (...args: unknown[]) => asyncLogger.error(...args);

    originalLog('\x1b[36m[Logger]\x1b[0m Async batched unified logger injected.');
}
