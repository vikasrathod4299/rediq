import { StorageAdapter } from "./StorageAdapter";
import { MemoryStorageAdapter } from "./MemoryStorageAdapter";
import { RedisConfigAdapter } from "./RedisConfigAdapter";
import { RedisConfig } from "./RedisConfig";


interface StorageOptoins {
    capacity?: number;
    redis?: {
        host: string;
        port: number;
        password?: string;
    }
}


const memoryStorageRegistry = new Map<string, MemoryStorageAdapter<any>>();

export function getStorage<T>(queueName: string, options: StorageOptoins = {}): StorageAdapter<T> {
    if(options.redis) {
        const redisConfig:RedisConfig = {
            host: options.redis.host,
            port: options.redis.port,
            password: options.redis.password,
            queueName,
            capacity: options.capacity || 1000
        }
        return new RedisConfigAdapter<T>(redisConfig);  
    }

    // In-Memory: Return SAME instance for same queue name
    if(!memoryStorageRegistry.has(queueName)) {
        memoryStorageRegistry.set(queueName, new MemoryStorageAdapter<T>(options.capacity || 1000));
    }

    return memoryStorageRegistry.get(queueName) as StorageAdapter<T>;
}

export function clearMemoryStorageRegistry() {
    memoryStorageRegistry.clear();
}