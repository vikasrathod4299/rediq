import Metrics from "../metrics/metrics";
import { AsyncQueue } from "../queue/AsyncQueue";
import { StorageAdapter } from "../storage/StorageAdapter";
import { Job } from "../types/Job";
import { Worker } from "./worker"

export class Scheduler<T> {
  private workers: Worker<T>[] = [];
  private delayedJobs: Job<T>[] = [];
  private isRunning: boolean = false;
  private metrics: Metrics;
  private storage: StorageAdapter<T>

  constructor(
   processor: (job: Job<T>) => Promise<void>,
   concurrency: number,
   metrics: Metrics,
   storage: StorageAdapter<T>) 
  {
    this.metrics = metrics
    this.storage = storage
    for (let i = 0; i < concurrency; i++) {
      this.workers.push(new Worker<T>(`worker-${i}`, processor, this.metrics, this.storage))
    }
  }

  async start(): Promise<void> {
    this.isRunning = this.isRunning = true;

    // Recover any stuck jobs from previous run 
    const recoverd = await this.storage.recoverStuckJobs(300000)

    if(recoverd > 0){
      console.log(`Recovered ${recoverd} stuck jobs from previous run.`)
    }

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
        const job = await this.storage.dequeue(1)

        if(job) {
          const size = await this.storage.size()
          this.metrics.updateQueueSize(size)

          idleWorker.process(job).then(() => {
            this.updateWorkerStats();
          })

          this.updateWorkerStats();
        }
      } else {
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    }
  }

  private async delayCheckLoop(): Promise<void> {
    while (this.isRunning) {

      const promoted = await this.storage.promoteDelayedJobs()

      if (promoted > 0) {
        console.log(`Promoted ${promoted} delayed jobs to the main queue.`)
        const size = await this.storage.size()
        this.metrics.updateQueueSize(size)
      }

      // this part is now handled in StorageAdapter's promoteDelayedJobs method
      // const now = Date.now();

      // const readyJobs:Job<T>[] = []

      // this.delayedJobs = this.delayedJobs.filter(job=>{
      //   if (job.nextAttemptAt && job.nextAttemptAt.getTime() <= now){
      //     readyJobs.push(job)
      //     return false // Remove from delayed
      //   }
      //   return true // keep in delayed
      // })

      // for (const job of readyJobs) {
      //   job.nextAttemptAt = null;
      //   await this.queue.enqueue(job)
      // }

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