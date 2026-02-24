import { MemoryStorageAdapter, Job } from 'flexmq';

describe("MemoryStorageAdapter", () => {
    let storage: MemoryStorageAdapter<{ data: string }>;

    const createJob = (id: string, payload = { data: 'test' }): Job<{ data: string }> => ({
        id,
        payload,
        attempts: 0,
        maxAttempts: 3,
        status: 'pending',
        nextAttemptAt: null,
        error: null,
    });

    beforeEach(async () => {
        storage = new MemoryStorageAdapter<{ data: string }>(10);
        await storage.connect();
    });

    afterEach(async () => {
        await storage.disconnect();
    });

    describe('enqueue', () => {
        it('should enqueue a job successfully', async () => {
            const job = createJob('job-1');
            const result = await storage.enqueue(job);

            expect(result).toBe(true);
            expect(await storage.size()).toBe(1);
        });

        it('should reject job when queue is full', async () => {
            for (let i = 0; i < 10; i++) {
                await storage.enqueue(createJob(`job-${i}`));
            }
            const result = await storage.enqueue(createJob('job-overflow'));
            expect(result).toBe(false);
        });

        it('should set createdAt and updatedAt timestamps', async () => {
            const job = createJob('job-1');
            await storage.enqueue(job);

            const storedJob = await storage.getJob('job-1');
            expect(storedJob?.createdAt).toBeDefined();
            expect(storedJob?.updatedAt).toBeDefined();
        });
    });

    describe('dequeue', () => {
        it('should dequeue jobs in FIFO order', async () => {
            await storage.enqueue(createJob('job-1'));
            await storage.enqueue(createJob('job-2'));
            await storage.enqueue(createJob('job-3'));

            const job1 = await storage.dequeue(0);
            const job2 = await storage.dequeue(0);
            const job3 = await storage.dequeue(0);

            expect(job1?.id).toBe('job-1');
            expect(job2?.id).toBe('job-2');
            expect(job3?.id).toBe('job-3');
        });

        it('should mark job as processing and increment attempts', async () => {
            await storage.enqueue(createJob('job-1'));
            const job = await storage.dequeue(0);

            expect(job?.status).toBe('processing');
            expect(job?.attempts).toBe(1);
            expect(job?.updatedAt).toBeDefined();
            expect(job?.processingStartedAt).toBeDefined();
        });

        it('should return null when queue is empty with timeout=0', async () => {
            const job = await storage.dequeue(0);
            expect(job).toBeNull();
        });

        it('should block and wait for job when queue is empty', async () => {
            const dequeuePromise = storage.dequeue(2);
            setTimeout(async () => {
                await storage.enqueue(createJob('delayed-job'));
            }, 500);
            const job = await dequeuePromise;
            expect(job?.id).toBe('delayed-job');
        });

        it('should timeout and return null if no job arrives', async () => {
            const start = Date.now();
            const job = await storage.dequeue(1);
            const elapsed = Date.now() - start;

            expect(job).toBeNull();
            expect(elapsed).toBeGreaterThanOrEqual(900);
        });
    });
});