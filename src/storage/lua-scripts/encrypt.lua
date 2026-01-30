local pendingKey = KEYS[1] 
local jobKey = KEYS[2]
local capacity = tonumber(ARGV[1])
local jobId = ARGV[2]
local jobData = ARGV[3]

local currentSize = redis.call('LLEN', pendingKey);

if currentSize >= capacity then
    return 0
end

-- Parse and store job fields
local job = cjson.decode(jobData)
redis.call('HSET', jobKey, 
    'id', job.id,
    'payload', cjson.encode(job.payload),
    'attempts', tostring(job.attempts),
    'maxAttempts', tostring(job.maxAttempts),
    'status', job.status,
    'nextAttemptAt', job.nextAttemptAt or '',
    'createdAt', tostring(job.createdAt or 0),
    'updatedAt', tostring(job.updatedAt or 0),
    'processingStartedAt', '',
    'workerId', '',
    'error', ''
)

redis.call('LPUSH', pendingKey, jobId)

return 1