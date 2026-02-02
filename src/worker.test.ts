import { Worker } from "./index";

const worker = new Worker<{email: string}>('test-queue', {
    concurrency: 2,
    processor: async (job) => {
        console.log(`Processing job ${job.id} with payload:`, job.payload);
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log(`Completed job ${job.id}`);
    },
    redis: {
        host: "localhost",
        port: 6379
    },
    capacity: 1000
})