import Redis from "ioredis";
import { Job } from "../types/Job";
import { StorageAdapter } from "./StorageAdapter";
import { RedisConfig } from "./RedisConfig";
import fs from "fs";
import path from "path";


export class RedisConfigAdapter<T> implements StorageAdapter<T> {
    private client: Redis;
    private blockingClient: Redis;
    private config: RedisConfig;

    constructor(config:RedisConfig) {
        this.config = config
        const redisOptions = {
            host: config.host,
            port: config.port,
            password: config.password,
            maxRetriesPerRequest: null
        }
        this.client = new Redis(redisOptions)
        this.blockingClient = new Redis(redisOptions)
    }

    private get pendingKey(): string {
        return `${this.config.queueName}:pending`;
    }
    private get processingKey(): string {
        return `${this.config.queueName}:processing`;
    }
    private get delayedKey(): string {
        return `${this.config.queueName}:delayed`;
    }
    private jobKey(id: string): string {
        return `${this.config.queueName}:job:${id}`;
    }

    async connect(): Promise<void> {
        await this.client.ping();
        await this.blockingClient.ping();
    }

    async disconnect(): Promise<void> {
        await this.client.quit();
        await this.blockingClient.quit();
    }


    private enqueueLua = fs.readFileSync(path.join(__dirname, 'lua-scripts', 'enqueue.lua'), 'utf-8');
    async enqueue(job: Job<T>): Promise<boolean> {
        const now = Date.now(); 

        job.createdAt = job.createdAt || now;
        job.updatedAt = now;

        const jobData = JSON.stringify(job);

        const result = await this.client.eval(
            this.enqueueLua,
            2,
            this.pendingKey,
            this.jobKey(job.id),
            this.config.capacity.toString(),
            job.id,
            jobData,
        ) as number;
        
        return result === 1;
    }

    private acquireJobLua = fs.readFileSync(path.join(__dirname, 'lua-scripts', 'acquire-job.lua'), 'utf-8'); 
    async dequeue(timeout: number = 5): Promise<Job<T> | null> {
        // Blocking pop from the pending queue
        const result = await this.blockingClient.brpop(this.pendingKey, timeout);

        if(!result) {
            return null;
        }

        const [, jobId] = result;
        const now = Date.now();

        const jobData = await this.client.eval(
            this.acquireJobLua,
            2,
            this.processingKey,
            this.jobKey(jobId),
            now.toString(),
            jobId
        ) as string | null;

        if (!jobData) {
            return null
        }

        const job: Job<T> = JSON.parse(jobData);
        return job;
    }

    private parseJobFromRedis(data: string[]): Job<T> | null  {
        if(!data || data.length === 0) return null;

        const obj: Record<string, string> = {};

        for (let i = 0; i < data.length; i += 2) {
            obj[data[i]] = data[i + 1];
        }
        return {
            id: obj['id'],
            payload: JSON.parse(obj['payload']),
            attempts: parseInt(obj['attempts'], 10),
            maxAttempts: parseInt(obj['maxAttempts'], 10),
            status: obj['status'] as Job<T>['status'],
            nextAttemptAt: obj['nextAttemptAt'] ? new Date(parseInt(obj['nextAttemptAt'], 10)) : null,
            createdAt: obj['createdAt'] ? parseInt(obj['createdAt'], 10) : undefined,
            updatedAt: obj['updatedAt'] ? parseInt(obj['updatedAt'], 10) : undefined,
            processingStartedAt: obj['processingStartedAt'] ? parseInt(obj['processingStartedAt'], 10) : undefined,
            workerId: obj['workerId'] || undefined,
            error: obj['error'] || null,
        }

    }

    async peek(): Promise<Job<T> | null> {
        const jobId = await this.client.lindex(this.pendingKey, 0);
        if (!jobId) {
            return null;
        }
        return this.getJob(jobId);
    }

    async size(): Promise<number> {
        const size = await this.client.llen(this.pendingKey);
        return size;
    }

    async isFull(): Promise<boolean> {
        const size = await this.size();
        return size >= this.config.capacity;
    }

    async isEmpty(): Promise<boolean> {
        const currentSize = await this.size();
        return currentSize === 0;
    }

    async scheduleDelayed(job: Job<T>, executeAt: number): Promise<void> {
        job.updatedAt = Date.now();
        job.nextAttemptAt = new Date(executeAt);

        // Update job in hash
        await this.client.hset(
            this.jobKey(job.id),
            'updatedAt', job.updatedAt.toString(),
            'nextAttemptAt', job.nextAttemptAt.toISOString(),
            'updatedAt', job.updatedAt.toString()
        );

        // Add to delayed sorted set
        await this.client.zadd(this.delayedKey, executeAt, job.id);
    }

    async markProcessing(jobId: string, workerId: string): Promise<void> {
        const now = Date.now();
        await this.client.zadd(this.processingKey, now, jobId);

        await this.client.hset(
            this.jobKey(jobId),
            'status', 'processing',
            'processingStartedAt', now.toString(),
            'workerId', workerId,
            'updatedAt', now.toString()
        );
    }

    async markCompleted(jobId: string): Promise<void> {
        const now = Date.now();
        await this.client.multi()
        .zrem(this.processingKey, jobId)
        .hset(
            this.jobKey(jobId),
            'status', 'completed',
            'processingStartedAt', '',
            'updatedAt', now.toString()
        )
        .expire(this.jobKey(jobId), 86400) // 24 hours
        .exec();
    }

    async markFailed(jobId: string, error: string = ''): Promise<void> {
        const now = Date.now();
        await this.client.multi()
        .zrem(this.processingKey, jobId)
        .hset(
            this.jobKey(jobId),
            'status', 'failed',
            'processingStartedAt', '',
            'error', error || '',
            'updatedAt', now.toString()
        )
        .exec();
    }

    private promoteDelayedLua = fs.readFileSync(path.join(__dirname, 'lua-scripts', 'promoteDelayed.lua'), 'utf-8');
    async promoteDelayedJobs(): Promise<number> {
        const now = Date.now();
        const result = await this.client.eval(
            this.promoteDelayedLua,
            2,
            this.delayedKey,
            this.pendingKey,
            `${this.config.queueName}:job:`,
            now
        ) as number

        return result;
    }

    private recoverStuckJobsLua = fs.readFileSync(path.join(__dirname, 'lua-scripts', 'recoverStuckJobs.lua'), 'utf-8');
    async recoverStuckJobs(timeoutMs: number): Promise<number> {
        const now = Date.now();
        const result = await this.client.eval(
            this.recoverStuckJobsLua,
            2,
            this.processingKey,
            this.pendingKey,
            `${this.config.queueName}:job:`,
            now,
            timeoutMs
        ) as number;
        
        return result;
    }

    async updateJob(job: Job<T>): Promise<void> {
        job.updatedAt = Date.now();
        await this.client.hset(
            this.jobKey(job.id),
            'payload', JSON.stringify(job.payload),
            'attempts', job.attempts.toString(),
            'maxAttempts', job.maxAttempts.toString(),
            'status', job.status,
            'nextAttemptAt', job.nextAttemptAt ? job.nextAttemptAt.getTime().toString() : '',
            'updatedAt', job.updatedAt.toString(),
            'error', job.error || ''
        )
    }

    async getJob(jobId: string): Promise<Job<T>| null>  {
        const data = await this.client.hgetall(this.jobKey(jobId));

        if(!data || Object.keys(data).length === 0 ) return null

        const arr: string[] = [];
        for (const [key, value] of Object.entries(data)) {
            arr.push(key, value)
        }
        return this.parseJobFromRedis(arr)

    }

    async getProcessingJobs(): Promise<string[]> {
        return this.client.zrange(this.processingKey, 0, -1);
    }
}