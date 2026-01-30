import { Job } from "../types/Job";
import { EventEmitter } from "events";
import Metrics from "../metrics/metrics";

export class Worker<T> extends EventEmitter {
  private id: string;
  private status: 'idle' | 'busy';
  private currentJob?: Job<T>;
  private processor: (job: Job<T>) => Promise<void>;
  private onRetry: (job: Job<T>) => void;
  private metrics: Metrics;

  constructor(id: string, processor: (job: Job<T>) => Promise<void>, metrics: Metrics, onRetry?: (job: Job<T>) => void) {
    super()
    this.id = id;
    this.processor = processor
    this.metrics = metrics
    this.status = 'idle'
    this.onRetry = onRetry || (() => {})
  }

  async process(job: Job<T>): Promise<void> {
    this.status = 'busy';
    this.currentJob = job;

    job.status = 'processing';
    job.attempts++;

    const startTime = Date.now()
    try {
      await this.processor(job)

      job.status = 'completed'
      console.log('job',job)
      this.metrics.incrementJobsCompleted()
      this.metrics.recordProcessingTime(Date.now() - startTime)
    } catch (error) {
      if (job.attempts < job.maxAttempts) {

        job.status = 'pending'

        const delayMs = Math.pow(2, job.attempts) * 1000;
        job.nextAttemptAt = new Date(Date.now() + delayMs);

        this.onRetry(job)
        this.metrics.incrementRetries()
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