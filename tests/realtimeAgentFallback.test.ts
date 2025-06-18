import { markRealtimeFailure, isRealtimeTemporarilyDisabled } from '../src/services/realtimeAgentService'

describe('Realtime voice fallback cache', () => {
  it('should mark a business as disabled after a failure and recover after TTL', () => {
    const businessId = 'test-business'
    // initially not disabled
    expect(isRealtimeTemporarilyDisabled(businessId)).toBe(false)

    // mark failure
    markRealtimeFailure(businessId)
    expect(isRealtimeTemporarilyDisabled(businessId)).toBe(true)

    // fast-forward time beyond TTL
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 31 * 60 * 1000)
    expect(isRealtimeTemporarilyDisabled(businessId)).toBe(false)
  })
}) 