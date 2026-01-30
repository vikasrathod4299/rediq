import { AsyncQueue } from "./queue/AsyncQueue";
import BackpressureStrategy from "./queue/Backpressurestrategy"
import { EventEmitter } from "node:stream";
import { Scheduler } from "./worker/scheduler";
import Metrics from "./metrics/metrics";
import { Job } from "./types/Job";
import { StorageAdapter } from "./storage/StorageAdapter";

interface JobQueueOptions<T> {
    capacity: number;
    strategy: BackpressureStrategy;
    concurrency: number;
    processor: (job: Job<T>) => Promise<void>;
    redis?: {
        host: string;
        port: number;
        password?: string;
        queueName: string
    }
}

export class JobQueue<T> extends EventEmitter {
    private storage: StorageAdapter<T>;
    private queue:AsyncQueue<Job<T>>;
    private scheduler: Scheduler<T>
    private metrics: Metrics;
    private options: JobQueueOptions<T>:

    constructor(options: JobQueueOptions<T>) {
        super()
        this.options = options
        this.metrics = new Metrics();
        if(options.redis) {
            const redisConfig:RedisConfig = 
        }

        this.queue = new AsyncQueue<Job<T>>(options.capacity, options.strategy)
        this.scheduler = new Scheduler<T>(this.queue, options.processor, options.concurrency, this.metrics);
    }

    private setupEventListeners() {
        this.queue.on('queue:dropped',  () =>{
            this.metrics.incrementJobsDropped();
        })
    }

    async add(payload: T): Promise<void> {
        const job: Job<T> = {
            id: crypto.randomUUID(),
            payload,
            attempts: 0,
            maxAttempts: 3,
            status: 'pending',
            nextAttemptAt: null
        }
        const added = await this.queue.enqueue(job);
        if(added) {
            this.metrics.incrementJobsAdded();
            this.metrics.updateQueueSize(this.queue.size());
            this.emit('job:added', job);
        }
    }

    start() {
        this.scheduler.start();
    }

    stop() {
        this.scheduler.stop();
    }

    getMetrics() {
        return this.metrics.getSnapshot();
    }

    getPrometheusMetrics() {
        return this.metrics.toPrometheusFormat();
    }
}

async function main() {
    const queue = new JobQueue<{ email: string }>({
  capacity: 100,
  strategy: BackpressureStrategy.BLOCK_PRODUCER,
  concurrency: 4,
  processor: async (job) => {
    await sendEmail(job.payload.email);
  }
});

queue.start();

// Add jobs
console.log('adding')
await queue.add({ email: 'user@example.com' });
console.log('added')


// Check metrics anytime
console.log(queue.getMetrics());

queue.stop()
// {
//   jobsAdded: 1,
//   jobsCompleted: 0,
//   queueSize: 1,
//   activeWorkers: 1,
//   ...
// }

}

async function sendEmail(email: string): Promise<void> {
    // Simulate email sending delay
    return new Promise((resolve) => setTimeout(resolve, 1000));
}

main().catch(console.error);