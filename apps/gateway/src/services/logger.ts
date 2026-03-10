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

    private formatArgs(args: any[]): string {
        // Use native util.format to preserve console colors and deep object expansion
        return formatWithOptions({ colors: true, depth: 3 }, ...args);
    }

    private scheduleFlush() {
        if (!this.flushScheduled) {
            this.flushScheduled = true;
            // Use queueMicrotask to ensure non-blocking batch output at the end of the current event loop
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

    public log(...args: any[]) {
        this.stdoutQueue.push(this.formatArgs(args));
        this.scheduleFlush();
    }

    public warn(...args: any[]) {
        this.stderrQueue.push(this.formatArgs(args));
        this.scheduleFlush();
    }

    public error(...args: any[]) {
        this.stderrQueue.push(this.formatArgs(args));
        this.scheduleFlush();
    }
}

const asyncLogger = new AsyncLogger();
const originalLog = console.log;

export function overrideConsole() {
    // Override global console pointers for non-intrusive optimization across 50+ routing modules
    console.log = (...args: any[]) => asyncLogger.log(...args);
    console.info = (...args: any[]) => asyncLogger.log(...args);
    console.warn = (...args: any[]) => asyncLogger.warn(...args);
    console.error = (...args: any[]) => asyncLogger.error(...args);
    
    originalLog('\x1b[36m[Logger]\x1b[0m Async batched unified logger injected.');
}
