import { createClient, RedisClientType } from 'redis'

class RedisManager {
  private static instance: RedisManager
  private client: RedisClientType | null = null
  private isConnected = false

  private constructor() {}

  static getInstance(): RedisManager {
    if (!RedisManager.instance) {
      RedisManager.instance = new RedisManager()
    }
    return RedisManager.instance
  }

  async connect(): Promise<void> {
    if (this.isConnected && this.client) return

    try {
      // Create Redis client with connection string or individual options
      const redisUrl = process.env.REDIS_URL
      
      if (redisUrl) {
        // Use Redis URL (for managed Redis services like Render)
        this.client = createClient({ url: redisUrl })
      } else {
        // Use individual connection parameters for local development
        this.client = createClient({
          socket: {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379'),
          },
          password: process.env.REDIS_PASSWORD,
          database: parseInt(process.env.REDIS_DB || '0'),
        })
      }

      this.client.on('error', (err) => {
        console.error('[Redis] Connection error:', err)
        this.isConnected = false
      })

      this.client.on('connect', () => {
        console.log('[Redis] Connected successfully')
        this.isConnected = true
      })

      this.client.on('ready', () => {
        console.log('[Redis] Ready to handle commands')
      })

      this.client.on('end', () => {
        console.log('[Redis] Connection ended')
        this.isConnected = false
      })

      await this.client.connect()
      this.isConnected = true
      console.log('[Redis] Client connected and ready')
      
    } catch (error) {
      console.error('[Redis] Failed to connect:', error)
      this.isConnected = false
      throw error
    }
  }

  async disconnect(): Promise<void> {
    if (this.client && this.isConnected) {
      await this.client.quit()
      this.isConnected = false
      console.log('[Redis] Disconnected')
    }
  }

  getClient(): RedisClientType {
    if (!this.client || !this.isConnected) {
      throw new Error('Redis client not connected. Call connect() first.')
    }
    return this.client
  }

  isClientConnected(): boolean {
    return this.isConnected && this.client !== null
  }
}

export default RedisManager 