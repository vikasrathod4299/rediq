import { Worker } from "../src";

const worker = new Worker<{email: string}>('test-queue', {
    concurrency: 2,
    processor: async (job) => {
        console.log(`Processing job ${job.id} with payload:`, job.payload);
        await new Promise(resolve => setTimeout(resolve, 1000));
    },
    redis: {
        host: "localhost",
        port: 6379
    },
    capacity: 1000
})

worker.start().then(() => {
    console.log("Worker started");
}).catch(err => {
    console.error("Error starting worker:", err);
})
worker.on('job:completed', (data) => {
    console.log(`Job ${data.job.id} completed successfully in ${data.duration}ms.`);
});