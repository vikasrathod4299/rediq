local processingKey = KEYS[1]
local jobKey = KEYS[2]
local now = ARGV[1]
local jobId = ARGV[2]

-- Check if job exists
local exists = redis.call('EXISTS', jobKey)
if exists == 0 then
    return nil
end

redis.call('ZADD', processingKey, now, jobId)

-- Update job status atomically
redis.call('HSET', jobKey,
    'status', 'processing',
    'processingStartedAt', now,
    'updatedAt', now
)

-- Increment attempts
redis.call('HINCRBY', jobKey, 'attempts', 1)

-- Get the full job data and return as JSON
local jobFields = redis.call('HGETALL', jobKey)

-- Convert HGETALL result to a table
local job = {}

for i = 1, #jobFields, 2 do
    job[jobFields[i]] = jobFields[i + 1]
end

-- Return job as JSON string
return cjson.encode(job)