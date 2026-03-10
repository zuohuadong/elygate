import { formatWithOptions } from "util";

/**
 * 高性能异步日志服务 (Bun 极致调优)
 * 拦截原生的 console.log 同步调用，使用微任务 (microtask) 与 batch 批量刷新
 * 最大化吞吐量，消除高并发下的 stdout I/O 阻塞。
 */
class AsyncLogger {
    private stdoutQueue: string[] = [];
    private stderrQueue: string[] = [];
    private flushScheduled = false;

    private formatArgs(args: any[]): string {
        // 使用原生 util.format 保留控制台的颜色输出与对象深度展开
        return formatWithOptions({ colors: true, depth: 3 }, ...args);
    }

    private scheduleFlush() {
        if (!this.flushScheduled) {
            this.flushScheduled = true;
            // 使用 queueMicrotask 保证在当前事件循环结束时做非阻塞批量输出
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
    // 覆盖全局 console 指针以实现无侵入式优化 50+ 个路由模块
    console.log = (...args: any[]) => asyncLogger.log(...args);
    console.info = (...args: any[]) => asyncLogger.log(...args);
    console.warn = (...args: any[]) => asyncLogger.warn(...args);
    console.error = (...args: any[]) => asyncLogger.error(...args);
    
    originalLog('\x1b[36m[Logger]\x1b[0m Async batched unified logger injected.');
}
