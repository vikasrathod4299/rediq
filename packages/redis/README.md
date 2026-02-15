# @flexq/redis

Redis storage adapter for `flexq`.

`@flexq/redis` provides `RedisStorageAdapter<T>`, an implementation of the `StorageAdapter<T>` interface from `flexq`.  
Use it when you want persistent/distributed queue state instead of in-memory storage.

## Installation

```bash
npm install flexq @flexq/redis ioredis
```

> `ioredis` is a peer dependency and must be installed by the consuming app.

## Quick start

```ts
import { Queue, Worker } from 'flexq';
import { RedisStorageAdapter } from '@flexq/redis';

type TaskPayload = { taskId: string };

const storage = new RedisStorageAdapter<TaskPayload>({
  host: '127.0.0.1',
  port: 6379,
  queueName: 'tasks',
  capacity: 10000,
});

const queue = new Queue<TaskPayload>('tasks', { storage });

const worker = new Worker<TaskPayload>('tasks', {
  storage,
  concurrency: 4,
  processor: async (job) => {
    console.log('Processing task', job.payload.taskId);
  },
});

async function main() {
  await queue.connect();

  await queue.add({ taskId: 'task-1' }, { maxAttempts: 3 });
  await queue.add({ taskId: 'task-2' }, { maxAttempts: 5 });

  await worker.start();

  // graceful shutdown example:
  // await worker.stop();
  // await queue.disconnect();
}

main().catch(console.error);
```

## Configuration

`RedisStorageAdapter` expects:

```ts
interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  queueName: string;
  capacity: number;
}
```

- `queueName` is used as key prefix in Redis.
- `capacity` limits pending queue length.

## Behavior notes

- Uses Redis lists/sorted sets/hashes for queue and job state.
- Supports delayed retry promotion.
- Supports stuck job recovery.
- Uses blocking dequeue for workers (`BRPOP`) with timeout.

## Compatibility

- Requires `flexq` as dependency.
- Requires `ioredis` v5+.

## License

MIT