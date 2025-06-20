declare namespace NodeJS {
  interface ProcessEnv {
    DATABASE_URL: string
    DIRECT_URL?: string
    DEFAULT_BUSINESS_ID?: string
    ELEVENLABS_API_KEY?: string
    OPENAI_REALTIME_ENABLED?: string
    NODE_ENV: 'development' | 'production' | 'test'
  }
} 