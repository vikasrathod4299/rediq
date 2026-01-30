local pendingKey = KEYS[1]
local processingKey = KEYS[2]
local jobKeyPrefix = ARGV[1]
local now = ARGV[2]
local workerId = ARGV[3]

local jobId = redis.call('RPOP', pendingKey)
if not jobId then 
    return nil
end

local jobKey = jobKeyPrefix .. jobId

-- Add to processing sorted set (score = timestamp)
redis.call('ZADD', processingKey, now, jobId)

-- update job status
redis.call('HSET', jobKey,
    'status', 'processing',
    'processingStartedAt', now,
    'workerId', workerId,
    'updatedAt', now
)
redis.call('HINCRBY', jobKey, 'attempts', 1)

-- Return all job fields
return redis.call('HGETALL', jobKey)