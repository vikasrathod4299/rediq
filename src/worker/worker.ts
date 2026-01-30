import { Job } from "../types/Job";
import { EventEmitter } from "events";
import Metrics from "../metrics/metrics";
import { StorageAdapter } from "../storage/StorageAdapter";

export class Worker<T> extends EventEmitter {
  private id: string;
  private status: 'idle' | 'busy';
  private currentJob?: Job<T>;
  private processor: (job: Job<T>) => Promise<void>;
  private onRetry: (job: Job<T>) => void;
  private metrics: Metrics;
  private storage: StorageAdapter<T>;

  constructor(
    id: string, 
    processor: (job: Job<T>) => Promise<void>, 
    metrics: Metrics,
    storage: StorageAdapter<T>,
    onRetry?: (job: Job<T>) => void)
  {
    super()
    this.id = id;
    this.processor = processor
    this.metrics = metrics
    this.status = 'idle'
    this.onRetry = onRetry || (() => {})
    this.storage = storage
  }

  async process(job: Job<T>): Promise<void> {
    this.status = 'busy';
    this.currentJob = job;

    job.status = 'processing';
    job.attempts++;

    const startTime = Date.now()
    try {
      await this.processor(job)

      await this.storage.markCompleted(job.id)

      job.status = 'completed'
      console.log(`Job ${job.id} completed`)
      this.metrics.incrementJobsCompleted()
      this.metrics.recordProcessingTime(Date.now() - startTime)
      this.emit('job:completed', job)

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      if (job.attempts < job.maxAttempts) {

        job.status = 'pending'

        const delayMs = Math.pow(2, job.attempts) * 1000;

        const executeAt = new Date(Date.now() + delayMs);

        //job.nextAttemptAt = new Date(Date.now() + delayMs);

        // this.onRetry(job)
        this.metrics.incrementRetries()
        this.emit('job:retry', { job , nextAttemptAt: executeAt }) 
      } else {
        await this.storage.markFailed(job.id, errorMessage)

        this.emit('job:failed', { job, error: errorMessage })
        console.log(`Job ${job.id} permanently failed: ${errorMessage}`)
      }
    } finally {
      this.status = 'idle';
      this.currentJob = undefined;
    }
  }

  isIdle(): boolean {
    return this.status === 'idle';
  }

  getId(): string {
    return this.id;
  }
}