
interface RedisConfig {
    host: string;
    port: number;
    password?: string;
    queueName: string;
    capacity: number;
}

export { RedisConfig };