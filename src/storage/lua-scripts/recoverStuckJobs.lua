local processingKey = KEYS[1]
local pendingKey = KEYS[2]
local jobKeyPrefix = ARGV[1]
local now = tonumber(ARGV[2])
local timeoutMs = tonumber(ARGV[3])
local threshold = now - timeoutMs

local stuckJobs = redis.call('ZRANGEBYSCORE', processingKey, 0, threshold)
local recovered = 0


for i, jobId in ipairs(stuckJobs) do
    redis.call('ZREM', processingKey, jobId)
    redis.call('HSET', jobKeyPrefix .. jobId,
        'status', 'pending',
        'processingStartedAt', '',
        'workerId', '',
        'updatedAt', now
    )
    redis.call('LPUSH', pendingKey, jobId)
    recovered = recovered + 1
end

return recovered