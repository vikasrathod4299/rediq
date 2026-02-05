import { EventEmitter } from "node:events";

import { Job } from "./types/Job";
import { StorageAdapter } from "./storage/StorageAdapter";

import Metrics from "./metrics/metrics";
import { getStorage } from "./storage/StorageRegistery";

interface WorkerOptions<T> {
    concurrency?: number;
    processor: (job: Job<T>) => Promise<void>;
    stuckJobTimeout?: number;
    redis?: {
        host: string;
        port: number;
        password?: string;
    };
    capacity?: number;
    timeoutMs?: number;
}

export class Worker<T> extends EventEmitter {
    private storage: StorageAdapter<T>;
    private queueName: string;
    private concurrency: number;
    private processor: (job: Job<T>) => Promise<void>;
    private stuckJobTimeout: number;
    private isRunning: boolean = false;
    private activeWorkers: number = 0;
    private metrics: Metrics;
    private timeoutMs: number;

    constructor(queueName:string, options: WorkerOptions<T>) {
        super();
        this.queueName = queueName;
        this.concurrency = options.concurrency ?? 1;
        this.processor = options.processor;
        this.stuckJobTimeout = options.stuckJobTimeout ?? 30000;
        this.metrics = new Metrics();
        this.timeoutMs = options.timeoutMs || 5000;

        this.storage = getStorage<T>(queueName, {
            capacity: options.capacity,
            redis: options.redis
        });
    }

    async start(): Promise<void>{
        if(this.isRunning) return;

        await this.storage.connect();

        this.isRunning = true;
        this.emit('worker:started');
        console.log(`Worker started for queue: ${this.queueName} with concurrency: ${this.concurrency}`);

        const recovered = await this.storage.recoverStuckJobs(this.stuckJobTimeout);
        if(recovered > 0) {
            console.log(`Recovered ${recovered} stuck jobs`);
        }

        for(let i = 0; i < this.concurrency; i++) {
            this.workerLoop(i)
        }

        this.delayedJobLoop();
    }

    async stop(): Promise<void>{
        this.isRunning = false;

        // Wait brifly for active jobs to complete
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        await this.storage.disconnect();
        this.emit('worker:stopped');
        console.log(`Worker stopped for queue: ${this.queueName}`);
    }

    private async workerLoop(workerId: number): Promise<void>{
        const workerName = `${this.queueName}-worker-${workerId}`;

        while (this.isRunning) {
            try {

                const job = await this.storage.dequeue(this.timeoutMs);

                if(job) {
                    const size = await this.storage.size();
                    this.metrics.updateQueueSize(size)

                    this.activeWorkers++;
                    this.updateMetrics()
                    try {
                        await this.processJob(job, workerName)
                    } finally {
                        this.activeWorkers--;
                        this.updateMetrics();
                    }
                }
            } catch (error) {
                console.error(`Error in worker ${workerName}:`, error);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    private async processJob(job: Job<T>, workerName: string): Promise<void> {
        const startTime = Date.now();
        this.emit('job:processing', {job, worker: workerName})
        job.status = 'processing';

        try {
            await this.processor(job);
            await this.storage.markCompleted(job.id);

            job.status = 'completed';
            this.metrics.incrementJobsCompleted()
            this.metrics.recordProcessingTime(Date.now() - startTime)
            this.emit('job:completed', {job, duration: Date.now() - startTime})
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            if(job.attempts < job.maxAttempts) {
                job.status = 'pending';

                const delayMs = Math.pow(2, job.attempts) * 1000;
                const executeAt = Date.now() + delayMs;

                await this.storage.scheduleDelayed(job, executeAt);

                this.metrics.incrementRetries()
                this.emit('job:retry', {job, error: errorMessage, nextAttemptAt: new Date(executeAt)})
            } else {
                job.status = 'failed';
                await this.storage.markFailed(job.id, errorMessage);
                this.emit('job:failed', {job, error: errorMessage});
            }
        }
    }

    private async delayedJobLoop(): Promise<void>{
        while (this.isRunning) {
            try {
                const promoted = await this.storage.promoteDelayedJobs();

                if(promoted > 0) {
                    this.emit('jobs:promoted', {count: promoted});
                    const size = await this.storage.size();
                    this.metrics.updateQueueSize(size);
                }

            } catch (error) {
                this.emit('error', {error, context: 'delayedJobLoop'});
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    private updateMetrics(): void {
        this.metrics.updateWorkerStats(this.activeWorkers, this.concurrency - this.activeWorkers)
    }

    getMetrics() {
        return this.metrics.getSnapshot();
    }

    isActive(): boolean {
        return this.isRunning;
    }
}