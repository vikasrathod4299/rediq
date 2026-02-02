import BackpressureStrategy from "./queue/Backpressurestrategy"
import { EventEmitter } from "node:stream";
import { Scheduler } from "./worker/scheduler";
import Metrics from "./metrics/metrics";
import { Job } from "./types/Job";
import { StorageAdapter } from "./storage/StorageAdapter";
import { RedisConfig } from "./storage/RedisConfig";
import { RedisConfigAdapter  } from "./storage/RedisConfigAdapter";
import { MemoryStorageAdapter  } from "./storage/MemoryStorageAdapter";

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
    private scheduler: Scheduler<T>
    private metrics: Metrics;
    private options: JobQueueOptions<T>

    constructor(options: JobQueueOptions<T>) {
        super()
        this.options = options
        this.metrics = new Metrics();

        if(options.redis) {
            const redisConfig:RedisConfig = {
                host: options.redis.host,
                port: options.redis.port,
                password: options.redis.password,
                queueName: options.redis.queueName,
                capacity: options.capacity
            }
            this.storage = new RedisConfigAdapter<T>(redisConfig);  
        }else{
            this.storage = new MemoryStorageAdapter<T>(options.capacity);
        }

        this.scheduler = new Scheduler<T>(
            options.processor, 
            options.concurrency,
            this.metrics,
            this.storage
        );
    }

    // private setupEventListeners() {
    // }

    async add(payload: T): Promise<string> {
        const job: Job<T> = {
            id: crypto.randomUUID(),
            payload,
            attempts: 0,
            maxAttempts: 3,
            status: 'pending',
            nextAttemptAt: null,
            error: null
        }
        const added = await this.storage.enqueue(job);
        if(added) {
            this.metrics.incrementJobsAdded();
            const size = await this.storage.size()
            this.metrics.updateQueueSize(size);
            this.emit('job:added', job);
            return job.id
        }

        switch (this.options.strategy) {
            case BackpressureStrategy.DROP_NEWEST:
                this.metrics.incrementJobsDropped();
                this.emit('job:dropped', {job, reason: "DROP_NEWEST"});
                throw new Error('Job dropped due to DROP_NEWEST strategy');
            case BackpressureStrategy.ERROR:
                throw new Error('Queue is full - job dropped');
            
            case BackpressureStrategy.BLOCK_PRODUCER:
                while (await this.storage.isFull()) {
                    await new Promise(resolve => setTimeout(resolve, 100)); 
                }
                return this.add(payload);
            
            case BackpressureStrategy.DROP_OLDEST:
                while (await this.storage.isFull()) {
                    await new Promise(resolve => setTimeout(resolve, 100)); 
                }
            default:
                throw new Error('Unknown backpressure strategy');
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