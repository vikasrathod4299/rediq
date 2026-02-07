import { EventEmitter } from "node:events";
import { Job } from "./types/Job";
import { randomUUID } from "node:crypto";
import { StorageAdapter } from "./storage/StorageAdapter";
import BackpressureStrategy from "./queue/BackpressureStrategy";
import { getMemoryStorage } from "./storage/StorageRegistry";

export interface QueueOptions<T> {
    storage?: StorageAdapter<T>;
    capacity?: number;
    backpressureStrategy?: BackpressureStrategy;
}

export class Queue<T> extends EventEmitter {
    private storage: StorageAdapter<T>;
    private queueName: string;
    private capacity: number;
    private backpressureStrategy: BackpressureStrategy;
    private isConnected: boolean = false;

    constructor(queueName: string, options: QueueOptions<T> = {}) {
        super();
        this.queueName = queueName;
        this.capacity = options.capacity ?? 1000;
        this.backpressureStrategy = options.backpressureStrategy ?? BackpressureStrategy.BLOCK_PRODUCER;

        // Use provided storage or fall back to in-memory
        this.storage = options.storage ?? getMemoryStorage<T>(queueName, this.capacity);
    }

    async connect(): Promise<void> {
        if (this.isConnected) return;
        await this.storage.connect();
        this.isConnected = true;
        this.emit('queue:connected');
    }

    async disconnect(): Promise<void> {
        if (!this.isConnected) return;
        await this.storage.disconnect();
        this.isConnected = false;
        this.emit('queue:disconnected');
    }

    async add(payload: T, options: { maxAttempts?: number } = {}): Promise<Job<T>> {
        if (!this.isConnected) await this.connect();

        const job: Job<T> = {
            id: randomUUID(),
            payload,
            attempts: 0,
            maxAttempts: options?.maxAttempts ?? 3,
            status: 'pending',
            nextAttemptAt: null,
            error: null,
        };

        const added = await this.storage.enqueue(job);

        if (added) {
            this.emit('job:added', job);
            return job;
        }

        return this.handleBackpressure(payload, options);
    }

    private async handleBackpressure(payload: T, options: { maxAttempts?: number }): Promise<Job<T>> {
        switch (this.backpressureStrategy) {
            case BackpressureStrategy.DROP_NEWEST: {
                this.emit('job:dropped', { payload, reason: "DROP_NEWEST" });
                throw new Error("Queue is full. Job dropped (DROP_NEWEST).");
            }

            case BackpressureStrategy.ERROR: {
                throw new Error("Queue is full. Job cannot be added.");
            }

            case BackpressureStrategy.BLOCK_PRODUCER: {
                while (await this.storage.isFull()) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                return this.add(payload, options);
            }

            case BackpressureStrategy.DROP_OLDEST: {
                const oldestJob = await this.storage.dequeue(0);
                if (oldestJob) {
                    this.emit('job:dropped', { job: oldestJob, reason: "DROP_OLDEST" });
                }
                return this.add(payload, options);
            }

            default:
                throw new Error("Queue is full.");
        }
    }

    /** Get the underlying storage adapter (useful for advanced usage) */
    getStorage(): StorageAdapter<T> {
        return this.storage;
    }

    async getJob(jobId: string): Promise<Job<T> | null> {
        return this.storage.getJob(jobId);
    }

    async getSize(): Promise<number> {
        return this.storage.size();
    }

    getName(): string {
        return this.queueName;
    }
}