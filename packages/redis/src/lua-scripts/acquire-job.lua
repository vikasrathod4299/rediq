local processingKey = KEYS[1]
local jobKey = KEYS[2]
local now = ARGV[1]
local jobId = ARGV[2]

local exists = redis.call('EXISTS', jobKey)
if exists == 0 then
    return nil
end

redis.call('ZADD', processingKey, now, jobId)
redis.call('HSET', jobKey,
    'status', 'processing',
    'processingStartedAt', now,
    'updatedAt', now
)
redis.call('HINCRBY', jobKey, 'attempts', 1)

local jobFields = redis.call('HGETALL', jobKey)
local job = {}
for i = 1, #jobFields, 2 do
    job[jobFields[i]] = jobFields[i + 1]
end
return cjson.encode(job)