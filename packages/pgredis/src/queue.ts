import { PgBoss, type ConstructorOptions, type Job, type Queue, type QueueResult, type SendOptions, type WorkHandler, type WorkOptions } from "pg-boss";

export type PgBossQueueMap = Record<string, Omit<Queue, "name">>;

export interface PgBossQueueOptions extends ConstructorOptions {
  queues?: PgBossQueueMap;
}

export class PgBossJobQueue {
  private boss: PgBoss | null = null;

  constructor(private readonly options: PgBossQueueOptions | string) {}

  async start(): Promise<PgBoss> {
    if (this.boss) return this.boss;
    const boss = typeof this.options === "string"
      ? new PgBoss(this.options)
      : new PgBoss(this.options);
    await boss.start();
    const queues = typeof this.options === "string" ? undefined : this.options.queues;
    if (queues) {
      for (const [name, options] of Object.entries(queues)) {
        await boss.createQueue(name, options);
      }
    }
    this.boss = boss;
    return boss;
  }

  async stop(): Promise<void> {
    if (!this.boss) return;
    const boss = this.boss;
    this.boss = null;
    await boss.stop();
  }

  async ensureQueue(name: string, options: Omit<Queue, "name"> = {}): Promise<void> {
    const boss = await this.start();
    await boss.createQueue(name, options);
  }

  async send<T extends object>(name: string, data?: T | null, options?: SendOptions): Promise<string | null> {
    const boss = await this.start();
    return boss.send(name, data ?? null, options);
  }

  async work<T extends object>(
    name: string,
    options: WorkOptions,
    handler: WorkHandler<T>
  ): Promise<string> {
    const boss = await this.start();
    return boss.work<T>(name, options, handler);
  }

  async getBoss(): Promise<PgBoss> {
    return this.start();
  }
}

export function createPgBossJobQueue(options: PgBossQueueOptions | string): PgBossJobQueue {
  return new PgBossJobQueue(options);
}

export { PgBoss };
export type { ConstructorOptions as PgBossOptions, Job, Queue, QueueResult, SendOptions, WorkHandler, WorkOptions };
