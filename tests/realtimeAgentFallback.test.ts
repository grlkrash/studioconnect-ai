import { markFailure, isRealtimeDisabled } from '../src/services/realtimeAgentService'

describe('Realtime voice fallback cache', () => {
  it('should mark a business as disabled after a failure and recover after TTL', () => {
    const businessId = 'test-business'
    // initially not disabled
    expect(isRealtimeDisabled(businessId)).toBe(false)

    // mark failure
    markFailure(businessId)
    expect(isRealtimeDisabled(businessId)).toBe(true)

    // fast-forward time beyond TTL
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 31 * 60 * 1000)
    expect(isRealtimeDisabled(businessId)).toBe(false)
  })
}) 