export const CIRCUIT_BREAKER_REPORT_SCRIPT = `
local total = redis.call('INCR', KEYS[1])
if total == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end

if ARGV[2] == '1' then
  local failures = redis.call('INCR', KEYS[2])
  if failures == 1 then
    redis.call('EXPIRE', KEYS[2], ARGV[1])
  end

  if total >= tonumber(ARGV[3]) and (failures * 100 / total) >= tonumber(ARGV[4]) then
    redis.call('SET', KEYS[3], 'open')
    redis.call('SET', KEYS[4], ARGV[5])
    redis.call('DEL', KEYS[1])
    redis.call('DEL', KEYS[2])
    return 'open'
  end
end

return 'closed'
`;
