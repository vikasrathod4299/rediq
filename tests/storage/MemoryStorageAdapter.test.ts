import { MemoryStorageAdapter } from "../../src/storage/MemoryStorageAdapter"
import { Job } from "../../src"
import { create } from "node:domain";
import { resolve } from "node:dns";

describe("MemoryStorageAdapter", () => {
    let storage: MemoryStorageAdapter<{data: string}>;
    
    const createJob = (id: string, payload = {data: 'test'}): Job<{data: string}> => ({
        id,
        payload,
        attempts: 0,
        maxAttempts: 3,
        status: 'pending',
        nextAttemptAt: null,
        error: null,
    });

    beforeEach(async() => {
        storage = new MemoryStorageAdapter<{data: string}>(10);
        await storage.connect();
    });

    afterEach(async() => {
        await storage.disconnect();
    });

    describe('enqueue', () =>{
        it('should enqueue a job successfully', async () => {
            const job = createJob('job-1');
            const result = await storage.enqueue(job);

            expect(result).toBe(true);
            expect(await storage.size()).toBe(1);
        })

        it('should reject job when queue is full', async () =>{
            // Fill the queue to it's capacity = 10 
            for (let i = 0; i < 10; i++) {
                await storage.enqueue(createJob(`job-${i}`));
            }
            const result = await storage.enqueue(createJob('job-overflow'))
            expect(result).toBe(false);
        })
    
        it('should set createdAt and updatedAt timestamps', async() => {
            const job = createJob('job-1');
            await storage.enqueue(job);

            const storedJob = await storage.getJob('job-1');
            expect(storedJob?.createdAt).toBeDefined();
            expect(storedJob?.updatedAt).toBeDefined();
        })
    })

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
        })

        it('should mark job as processing and increment attempts', async () => {
            await storage.enqueue(createJob('job-1'));
            const job = await storage.dequeue(0);
            
            expect(job?.status).toBe('processing');
            expect(job?.attempts).toBe(1);
            expect(job?.updatedAt).toBeDefined();
            expect(job?.processingStartedAt).toBeDefined();
        })

        it('should return null wheen queue is empty with timeout=0', async () => {
            const job = await storage.dequeue(0);
            expect(job).toBeNull();
        })

        it('should block and wait for job when queue is empty',  async()=>{
            const dequeuePromise = storage.dequeue(2)
            setTimeout(async () => {
                await storage.enqueue(createJob('delayed-job'));
            }, 500)
            const job = await dequeuePromise;
            expect(job?.id).toBe('delayed-job');
        })

        it('should timeout and return null if no job arrives', async () =>{
            const start = Date.now();
            const job = await storage.dequeue(1); // 1 second timeout
            const elapsed = Date.now() - start;

            expect(job).toBeNull();
            expect(elapsed).toBeGreaterThanOrEqual(900); // ~ 1 second
        })
    })

    describe('peek', () => {

        it('shold return first job without removeing it ', async () => {
            await storage.enqueue(createJob('job-1'));
            await storage.enqueue(createJob('job-2'));

            const peeked = await storage.peek()
            expect(peeked?.id).toBe('job-1');
            expect(await storage.size()).toBe(2);
        })
        
        it('should return null when queue is empty', async () => {
            const peeked = await storage.peek();
            expect(peeked).toBeNull();
        });
    })

    describe('size, isFull, isEmpty', () => {
        it('should return correct size', async () => {
            expect(await storage.size()).toBe(0);

            await storage.enqueue(createJob('job-1'));
            expect(await storage.size()).toBe(1);

            await storage.enqueue(createJob('job-2'));
            expect(await storage.size()).toBe(2);
        })

        it('should return true for isEmpty when empty', async () => {
            expect(await storage.isEmpty()).toBe(true);

            await storage.enqueue(createJob('job-1'));
            expect(await storage.isEmpty()).toBe(false);
        })

        it('should return true for isFull when at capacity', async () => {
            for (let i = 0; i < 10; i++) {
                await storage.enqueue(createJob(`job-${i}`));
            }
            expect(await storage.isFull()).toBe(true);
        })
    })

    describe('markCompleted', () => {
        it('should mark job as completed', async()=>{
            await storage.enqueue(createJob('job-1'));
            await storage.dequeue(0);

            await storage.markCompleted('job-1');

            const job = await storage.getJob('job-1');
            expect(job?.status).toBe('completed');
            expect(job?.processingStartedAt).toBeUndefined();
        })

        it('should remove job from processing set', async () =>{
            await storage.enqueue(createJob('job-1'));
            await storage.dequeue();

            const processsingBefore = await storage.getProcessingJobs();
            expect(processsingBefore).toContain('job-1');

            await storage.markCompleted('job-1');

            const processingAfter = await storage.getProcessingJobs();
            expect(processingAfter).not.toContain('job-1');
        })

        describe('markFailed', () => {
            it('should mark job as failed with error message', async () => {
                await storage.enqueue(createJob('job-1'));
                await storage.dequeue(0);
                
                await storage.markFailed('job-1', 'Something went wrong');

                const job = await storage.getJob('job-1');
                expect(job?.status).toBe('failed');
                expect(job?.error).toBe('Something went wrong');
            })
        })

        describe('scheduleDelayed', () => {
            it('should schedule job for delayed execution', async () => {
                const job = createJob('job-1');
                await storage.enqueue(job);
                await storage.dequeue(0); 

                const executeAt = Date.now() + 2000;
                await storage.scheduleDelayed(job, executeAt);

                const updatedJob = await storage.getJob('job-1');
                expect(updatedJob?.status).toBe('pending');
                expect(updatedJob?.nextAttemptAt).toEqual(new Date(executeAt));
            })
        })

        describe('promoteDelayedJobs', () => {
            it('should promote jobs whose executeAt time has passed' , async () =>{
                const job = createJob('job-1');
                await storage.enqueue(job);
                await storage.dequeue(0);

                const executeAt = Date.now() - 1000;
                await storage.scheduleDelayed(job, executeAt);

                const promoted = await storage.promoteDelayedJobs();
                expect(promoted).toBe(1);
                expect(await storage.size()).toBe(1);
            })

            it('should not promote jobs whose executeAt time has not passed', async () =>{
                const job = createJob('job-1');
                await storage.enqueue(job);
                await storage.dequeue(0);

                const executeAt = Date.now() + 60000;
                await storage.scheduleDelayed(job, executeAt);
                
                const promoted = await storage.promoteDelayedJobs();
                expect(promoted).toBe(0);
                expect(await storage.size()).toBe(0);
            })
        })

        describe('recoverStuckJobs', () =>{
            it('should recover jobs stuck in processing', async () => {
                await storage.enqueue(createJob('job-1'));
                await storage.dequeue();

                // Simulate job stuck by manipulating processingStartedAt
                const job = await storage.getJob('job-1');

                if(job) {
                    job.processingStartedAt = Date.now() - 60000; // 1 minute ago
                    await storage.updateJob(job);
                }
                await new Promise(resolve=> setTimeout(resolve, 100)); // Ensure timestamp difference

                const recovered = await storage.recoverStuckJobs(30000); // 30 seconds
                expect(recovered).toBe(1);
                expect(await storage.size()).toBe(1);
            })

            it('should not recover job within timeout', async () => {
                await storage.enqueue(createJob('job-1'));
                await storage.dequeue(0);

                const recovered = await storage.recoverStuckJobs(60000); // 10 minutes
                expect(recovered).toBe(0);
            })
        });

        describe('getJob', () => {
            it('should return job by ID', async () => {
                const originalJob = createJob('job-1', { data: 'test-data' });
                await storage.enqueue(originalJob);

                const job = await storage.getJob('job-1');
                expect(job?.id).toBe('job-1');
                expect(job?.payload.data).toBe('test-data');
            });

            it('should return null for non-existent job', async () => {
              const job = await storage.getJob('non-existent');
              expect(job).toBeNull();
            });
        })

        describe('updateJob', () => {
          it('should update job data', async () => {
            const job = createJob('job-1');
            await storage.enqueue(job);

            job.payload = { data: 'updated' };
            await storage.updateJob(job);

            const updated = await storage.getJob('job-1');
            expect(updated?.payload.data).toBe('updated');
          });
        });
    })
})