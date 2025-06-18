import { OpenAIRealtimeClient as Client } from '../src/services/openaiRealtimeClient'

describe('OpenAIRealtimeClient model validation', () => {
  it('should fallback to allowed model if invalid provided', () => {
    // Provide fake key and invalid model via constructor
    const c = new Client('sk-test', 'nova', 'hello', 'invalid-model-name') as any
    expect(c.model).toBe('gpt-4o-realtime-preview')
  })
}) 