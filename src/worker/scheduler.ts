import Metrics from "../metrics/metrics";
import { AsyncQueue } from "../queue/AsyncQueue";
import { Job } from "../types/Job";
import { Worker } from "./worker"

export class Scheduler<T> {
  private workers: Worker<T>[] = [];
  private delayedJobs: Job<T>[] = [];
  private queue: AsyncQueue<Job<T>>;
  private isRunning: boolean = false;
  private metrics: Metrics

  constructor(queue: AsyncQueue<Job<T>>, processor: (job: Job<T>) => Promise<void>, concurrency: number, metrics: Metrics) {
    this.queue = queue;
    this.metrics = metrics
    for (let i = 0; i < concurrency; i++) {
      this.workers.push(new Worker<T>(`worker-${i}`, processor, this.metrics, this.scheduleRetry))
    }
  }

  start(): void {
    this.isRunning = this.isRunning = true;
    this.scheduleLoop()
    this.delayCheckLoop()
  }
  stop(): void {
    this.isRunning = false
  }
  scheduleRetry(job: Job<T>): void {
    this.delayedJobs.push(job);
  }

  private async scheduleLoop(): Promise<void> {
    while (this.isRunning) {
      const idleWorker = this.getIdleWorker()
      if (idleWorker) {
        const job = await this.queue.dequeue();
        this.metrics.updateQueueSize(this.queue.size())
        idleWorker.process(job).then(() => {
          this.updateWorkerStats();
        })
        this.updateWorkerStats();
      } else {
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    }
  }

  private async delayCheckLoop(): Promise<void> {
    while (this.isRunning) {
      const now = Date.now();

      const readyJobs:Job<T>[] = []

      this.delayedJobs = this.delayedJobs.filter(job=>{
        if (job.nextAttemptAt && job.nextAttemptAt.getTime() <= now){
          readyJobs.push(job)
          return false // Remove from delayed
        }
        return true // keep in delayed
      })

      for (const job of readyJobs) {
        job.nextAttemptAt = null;
        await this.queue.enqueue(job)
      }

      await new Promise(resolve=>setTimeout(resolve, 100)) // Check every 100ms
    }
  }

  private getIdleWorker(): Worker<T> | undefined {
    return this.workers.find(w => w.isIdle())
  }

  private updateWorkerStats(): void {
    const idle = this.workers.filter(w => w.isIdle()).length
    const active = this.workers.length - idle;
    this.metrics.updateWorkerStats(active, idle)
  }
}