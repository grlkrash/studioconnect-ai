import { createClient, RedisClientType } from 'redis'

class RedisManager {
  private static instance: RedisManager
  private client: RedisClientType | null = null
  private isConnected = false
  private connectionAttempts = 0
  private maxConnectionAttempts = 3
  private lastConnectionAttempt = 0
  private connectionCooldown = 30000 // 30 seconds

  private constructor() {}

  static getInstance(): RedisManager {
    if (!RedisManager.instance) {
      RedisManager.instance = new RedisManager()
    }
    return RedisManager.instance
  }

  async connect(): Promise<void> {
    if (this.isConnected && this.client) return

    // Check if we're in cooldown period
    const now = Date.now()
    if (this.connectionAttempts >= this.maxConnectionAttempts && 
        now - this.lastConnectionAttempt < this.connectionCooldown) {
      throw new Error('Redis connection in cooldown period')
    }

    // Reset attempts if cooldown period has passed
    if (now - this.lastConnectionAttempt > this.connectionCooldown) {
      this.connectionAttempts = 0
    }

    this.connectionAttempts++
    this.lastConnectionAttempt = now

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
            connectTimeout: 5000
          },
          password: process.env.REDIS_PASSWORD,
          database: parseInt(process.env.REDIS_DB || '0'),
        })
      }

      this.client.on('error', (err) => {
        if (this.connectionAttempts <= this.maxConnectionAttempts) {
          console.error('[Redis] Connection error:', err.message)
        }
        this.isConnected = false
      })

      this.client.on('connect', () => {
        console.log('[Redis] Connected successfully')
        this.isConnected = true
        this.connectionAttempts = 0 // Reset on successful connection
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
      if (this.connectionAttempts <= this.maxConnectionAttempts) {
        console.error('[Redis] Failed to connect:', (error as Error).message)
      }
      this.isConnected = false
      
      if (this.connectionAttempts >= this.maxConnectionAttempts) {
        console.warn(`[Redis] Max connection attempts (${this.maxConnectionAttempts}) reached. Will retry after cooldown.`)
      }
      
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

  async healthCheck(): Promise<{
    connected: boolean
    latency?: number
    error?: string
  }> {
    try {
      if (!this.isClientConnected()) {
        return { connected: false, error: 'Client not connected' }
      }

      const start = Date.now()
      await this.client!.ping()
      const latency = Date.now() - start

      return { connected: true, latency }
    } catch (error) {
      return { 
        connected: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }
    }
  }
}

export default RedisManager 