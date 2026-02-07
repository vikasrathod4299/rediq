import { Job } from "../types/Job";

export interface StorageAdapter<T> {
    // Connection lifecycle
    connect(): Promise<void>;
    disconnect(): Promise<void>;

    // Queue operations
    enqueue(job: Job<T>): Promise<boolean>;
    dequeue(timeout?: number): Promise<Job<T> | null>;
    peek(): Promise<Job<T> | null>;
    size(): Promise<number>;
    isFull(): Promise<boolean>;
    isEmpty(): Promise<boolean>;

    // Delayed job operations
    scheduleDelayed(job: Job<T>, executeAt: number): Promise<void>;
    promoteDelayedJobs(): Promise<number>;

    // Job lifecycle
    markProcessing(jobId: string, workerId: string): Promise<void>;
    markCompleted(jobId: string): Promise<void>;
    markFailed(jobId: string, error?: string): Promise<void>;

    // Job data access
    getJob(jobId: string): Promise<Job<T> | null>;
    updateJob(job: Job<T>): Promise<void>;

    // Recovery
    recoverStuckJobs(timeoutMs: number): Promise<number>;
    getProcessingJobs(): Promise<string[]>;
}