import { Queue } from "../src";
import BackpressureStrategy from "../src/queue/Backpressurestrategy";

const queue = new Queue<string>("test-queue", {
    redis: {
        host: "localhost",
        port: 6379
    },
    capacity: 500,
    backpressureStrategy: BackpressureStrategy.BLOCK_PRODUCER
})
queue.connect().then(async () => {
    console.log("Queue connected");
    for(let i = 0; i < 10; i++) {
        const job = await queue.add(`Job payload ${i}`, {maxAttempts: 3});
        console.log(`Added job ${job.id} with payload:`, job.payload);
    }
}).catch(err => {
    console.error("Error connecting to queue:", err);
})