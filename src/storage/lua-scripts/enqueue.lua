local pendingKey = KEYS[1] 
local jobKey = KEYS[2]
local capacity = tonumber(ARGV[1])
local jobId = ARGV[2]
local jobData = ARGV[3]

local currentSize = redis.call('LLEN', pendingKey);

if currentSize >= capacity then
    return 0
end

-- Helper to safely convert values (cjson.null is userdata, not nil)
local function safeStr(val, default)
    if val == nil or val == cjson.null then
        return default or ''
    end
    return tostring(val)
end

-- Parse and store job fields
local job = cjson.decode(jobData)
redis.call('HSET', jobKey, 
    'id', safeStr(job.id),
    'payload', cjson.encode(job.payload),
    'attempts', safeStr(job.attempts, '0'),
    'maxAttempts', safeStr(job.maxAttempts, '0'),
    'status', safeStr(job.status, 'pending'),
    'nextAttemptAt', safeStr(job.nextAttemptAt),
    'createdAt', safeStr(job.createdAt, '0'),
    'updatedAt', safeStr(job.updatedAt, '0'),
    'processingStartedAt', '',
    'workerId', '',
    'error', safeStr(job.error)
)

redis.call('LPUSH', pendingKey, jobId)

return 1