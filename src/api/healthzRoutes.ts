import express from 'express'
import { prisma } from '../services/db'
import { Request, Response } from 'express'
import { voiceHealthMonitor } from '../monitor/voiceHealthMonitor'

export const healthzRouter = express.Router()

/**
 * 🎯 BULLETPROOF HEALTH CHECK ENDPOINT 🎯
 * Comprehensive monitoring for Fortune 500 production readiness
 */
healthzRouter.get('/', async (req, res) => {
  const startTime = Date.now()
  
  const healthStatus = {
    status: 'healthy' as 'healthy' | 'degraded' | 'unhealthy',
    timestamp: new Date().toISOString(),
    checks: {
      database: { status: 'unknown' as 'pass' | 'fail' | 'unknown', responseTime: 0 },
      elevenlabs: { status: 'unknown' as 'pass' | 'fail' | 'unknown', configured: false },
      openai: { status: 'unknown' as 'pass' | 'fail' | 'unknown', configured: false },
      voiceSystem: { status: 'unknown' as 'pass' | 'fail' | 'unknown', activeConnections: 0 },
      redis: { 
        status: 'unknown' as 'pass' | 'fail' | 'unknown', 
        connected: false
      } as { 
        status: 'pass' | 'fail' | 'unknown', 
        connected: boolean,
        latency?: number,
        error?: string
      }
    },
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime(),
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      external: Math.round(process.memoryUsage().external / 1024 / 1024)
    }
  }

  // Check Database Connection
  try {
    const dbStart = Date.now()
    await prisma.$queryRaw`SELECT 1`
    healthStatus.checks.database = {
      status: 'pass',
      responseTime: Date.now() - dbStart
    }
  } catch (error) {
    console.error('[HEALTH CHECK] Database check failed:', error)
    healthStatus.checks.database = { status: 'fail', responseTime: 0 }
    healthStatus.status = 'unhealthy'
  }

  // Check ElevenLabs Configuration
  try {
    const elevenlabsConfigured = !!(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY.trim())
    healthStatus.checks.elevenlabs = {
      status: elevenlabsConfigured ? 'pass' : 'fail',
      configured: elevenlabsConfigured
    }
    if (!elevenlabsConfigured && healthStatus.status === 'healthy') {
      healthStatus.status = 'degraded'
    }
  } catch (error) {
    console.error('[HEALTH CHECK] ElevenLabs check failed:', error)
    healthStatus.checks.elevenlabs = { status: 'fail', configured: false }
    if (healthStatus.status === 'healthy') healthStatus.status = 'degraded'
  }

  // Check OpenAI Configuration
  try {
    const openaiConfigured = !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim())
    healthStatus.checks.openai = {
      status: openaiConfigured ? 'pass' : 'fail',
      configured: openaiConfigured
    }
    if (!openaiConfigured) {
      healthStatus.status = 'unhealthy'
    }
  } catch (error) {
    console.error('[HEALTH CHECK] OpenAI check failed:', error)
    healthStatus.checks.openai = { status: 'fail', configured: false }
    healthStatus.status = 'unhealthy'
  }

  // Check Voice System Status
  try {
    const { realtimeAgentService } = await import('../services/realtimeAgentService')
    const activeConnections = realtimeAgentService.getActiveConnections()
    
    healthStatus.checks.voiceSystem = {
      status: 'pass',
      activeConnections
    }
  } catch (error) {
    console.error('[HEALTH CHECK] Voice system check failed:', error)
    healthStatus.checks.voiceSystem = { status: 'fail', activeConnections: 0 }
    if (healthStatus.status === 'healthy') healthStatus.status = 'degraded'
  }

  // Check Redis Connection
  try {
    const RedisManager = (await import('../config/redis')).default
    const redisManager = RedisManager.getInstance()
    const redisHealth = await redisManager.healthCheck()
    
    healthStatus.checks.redis = {
      status: redisHealth.connected ? 'pass' : 'fail',
      connected: redisHealth.connected,
      ...(redisHealth.latency && { latency: redisHealth.latency }),
      ...(redisHealth.error && { error: redisHealth.error })
    }
    
    if (!redisHealth.connected && healthStatus.status === 'healthy') {
      healthStatus.status = 'degraded'
    }
  } catch (error) {
    console.error('[HEALTH CHECK] Redis check failed:', error)
    healthStatus.checks.redis = { 
      status: 'fail', 
      connected: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
    if (healthStatus.status === 'healthy') healthStatus.status = 'degraded'
  }

  // Calculate total response time
  const totalResponseTime = Date.now() - startTime

  // Set HTTP status code based on health
  let httpStatus = 200
  if (healthStatus.status === 'degraded') httpStatus = 200 // Still operational
  if (healthStatus.status === 'unhealthy') httpStatus = 503 // Service unavailable

  res.status(httpStatus).json({
    ...healthStatus,
    responseTime: totalResponseTime
  })
})

/**
 * Detailed voice system diagnostics endpoint
 */
healthzRouter.get('/voice', async (req, res) => {
  try {
    const { realtimeAgentService } = await import('../services/realtimeAgentService')
    
    const diagnostics = {
      status: 'operational',
      timestamp: new Date().toISOString(),
      activeConnections: realtimeAgentService.getActiveConnections(),
      connectionStatus: realtimeAgentService.getConnectionStatus(),
      providers: {
        elevenlabs: {
          configured: !!(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY.trim()),
          voiceId: process.env.ELEVENLABS_VOICE_ID || 'default',
          modelId: process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5'
        },
        openai: {
          configured: !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim()),
          realtimeModel: process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview'
        }
      },
      twilio: {
        configured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)
      }
    }

    res.json(diagnostics)
  } catch (error) {
    console.error('[HEALTH CHECK] Voice diagnostics failed:', error)
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: 'Failed to retrieve voice system diagnostics'
    })
  }
})

/**
 * Detailed Redis diagnostics endpoint
 */
healthzRouter.get('/redis', async (req, res) => {
  try {
    const RedisManager = (await import('../config/redis')).default
    const redisManager = RedisManager.getInstance()
    const healthCheck = await redisManager.healthCheck()
    
    let additionalInfo = {}
    
    if (healthCheck.connected) {
      try {
        const client = redisManager.getClient()
        const info = await client.info()
        const dbSize = await client.dbSize()
        
        // Parse basic info from Redis INFO command
        const infoLines = info.split('\r\n')
        const memoryInfo = infoLines.find(line => line.startsWith('used_memory_human:'))
        const uptimeInfo = infoLines.find(line => line.startsWith('uptime_in_seconds:'))
        const connectedClientsInfo = infoLines.find(line => line.startsWith('connected_clients:'))
        
        additionalInfo = {
          dbSize,
          memory: memoryInfo?.split(':')[1],
          uptime: uptimeInfo ? parseInt(uptimeInfo.split(':')[1]) : null,
          connectedClients: connectedClientsInfo ? parseInt(connectedClientsInfo.split(':')[1]) : null
        }
      } catch (error) {
        console.warn('[HEALTH CHECK] Could not fetch additional Redis info:', error)
      }
    }

    const diagnostics = {
      status: healthCheck.connected ? 'operational' : 'error',
      timestamp: new Date().toISOString(),
      connection: {
        connected: healthCheck.connected,
        latency: healthCheck.latency,
        error: healthCheck.error
      },
      configuration: {
        url: process.env.REDIS_URL ? '[CONFIGURED]' : null,
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || '6379',
        database: process.env.REDIS_DB || '0'
      },
      ...additionalInfo
    }

    res.json(diagnostics)
  } catch (error) {
    console.error('[HEALTH CHECK] Redis diagnostics failed:', error)
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: 'Failed to retrieve Redis diagnostics',
      details: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

/**
 * 🎯 BULLETPROOF VOICE HEALTH ENDPOINTS 🎯
 * Provides real-time performance metrics and SLA compliance status
 */

export const healthzRoutes = {
  // Existing basic health check
  getHealth: (req: Request, res: Response) => {
    res.status(200).json({ 
      status: 'healthy', 
      timestamp: new Date().toISOString(),
      service: 'StudioConnect AI Voice Agent'
    });
  },

  // 🎯 NEW: BULLETPROOF VOICE PERFORMANCE REPORT 🎯
  getVoiceHealthReport: (req: Request, res: Response) => {
    try {
      const metrics = voiceHealthMonitor.getMetrics();
      const guaranteeStatus = voiceHealthMonitor.getGuaranteeStatus();
      const recentAlerts = voiceHealthMonitor.getRecentAlerts(10);

      const report = {
        timestamp: new Date().toISOString(),
        service: 'Bulletproof Voice Agent',
        
        // 🎯 FORTUNE 50 PERFORMANCE GUARANTEES 🎯
        performanceGuarantees: {
          responseTime: {
            current: `${Math.round(guaranteeStatus.responseTime.current)}ms`,
            target: `<${guaranteeStatus.responseTime.target}ms`,
            compliant: guaranteeStatus.responseTime.compliant,
            status: guaranteeStatus.responseTime.compliant ? '✅ MEETING GUARANTEE' : '🚨 SLA BREACH'
          },
          successRate: {
            current: `${guaranteeStatus.successRate.current.toFixed(2)}%`,
            target: `>${guaranteeStatus.successRate.target}%`,
            compliant: guaranteeStatus.successRate.compliant,
            status: guaranteeStatus.successRate.compliant ? '✅ MEETING GUARANTEE' : '🚨 SLA BREACH'
          },
          audioQuality: {
            current: `${guaranteeStatus.audioQuality.current.toFixed(1)}%`,
            target: `>${guaranteeStatus.audioQuality.target}%`,
            compliant: guaranteeStatus.audioQuality.compliant,
            status: guaranteeStatus.audioQuality.compliant ? '✅ MEETING GUARANTEE' : '🚨 SLA BREACH'
          },
          uptime: {
            current: `${guaranteeStatus.uptime.current.toFixed(2)}%`,
            target: `>${guaranteeStatus.uptime.target}%`,
            compliant: guaranteeStatus.uptime.compliant,
            status: guaranteeStatus.uptime.compliant ? '✅ MEETING GUARANTEE' : '🚨 SLA BREACH'
          }
        },

        // 🎯 OVERALL COMPLIANCE STATUS 🎯
        overallCompliance: {
          status: guaranteeStatus.overallCompliance ? '✅ ALL GUARANTEES MET' : '🚨 SLA VIOLATIONS DETECTED',
          compliant: guaranteeStatus.overallCompliance,
          ready: guaranteeStatus.overallCompliance ? 'FORTUNE 50 READY' : 'REQUIRES ATTENTION'
        },

        // 🎯 DETAILED METRICS 🎯
        detailedMetrics: {
          calls: {
            total: metrics.totalCalls,
            successful: metrics.successfulCalls,
            failed: metrics.failedCalls,
            active: metrics.currentActiveConnections,
            peak: metrics.peakConcurrentConnections
          },
          performance: {
            avgResponseTime: `${Math.round(metrics.averageResponseTime)}ms`,
            maxResponseTime: `${Math.round(metrics.maxResponseTime)}ms`,
            p95ResponseTime: `${Math.round(metrics.responseTimeP95)}ms`,
            p99ResponseTime: `${Math.round(metrics.responseTimeP99)}ms`
          },
          quality: {
            avgAudioQuality: `${metrics.averageAudioQuality.toFixed(1)}%`,
            audioDropouts: metrics.totalAudioDropouts,
            avgContextLength: Math.round(metrics.averageContextLength),
            maxContextLength: metrics.maxContextLength
          },
          reliability: {
            totalErrors: metrics.totalErrors,
            avgRecoveryTime: `${Math.round(metrics.averageRecoveryTime)}ms`,
            maxRecoveryTime: `${Math.round(metrics.maxRecoveryTime)}ms`,
            uptimePercentage: `${metrics.uptimePercentage.toFixed(3)}%`
          },
          system: {
            memoryUsage: `${metrics.memoryUsage}MB`,
            cpuUsage: `${metrics.cpuUsage}s`,
            uptime: `${Math.round(metrics.totalUptime / 1000 / 60)}min`
          }
        },

        // 🎯 RECENT ALERTS 🎯
        recentAlerts: recentAlerts.length > 0 ? recentAlerts.map(alert => ({
          type: alert.type,
          metric: alert.metric,
          message: alert.message,
          timestamp: alert.timestamp,
          breach: alert.severity === 'CRITICAL'
        })) : ['No recent alerts - system performing optimally'],

        // 🎯 ENTERPRISE STATUS 🎯
        enterpriseStatus: {
          voiceProvider: 'ElevenLabs Premium',
          voiceQuality: 'Enterprise Grade',
          errorRecovery: 'Bulletproof',
          monitoring: 'Real-time',
          slaCompliance: guaranteeStatus.overallCompliance ? 'COMPLIANT' : 'VIOLATIONS',
          deploymentReady: guaranteeStatus.overallCompliance
        }
      };

      // Set appropriate HTTP status based on compliance
      const statusCode = guaranteeStatus.overallCompliance ? 200 : 503;
      
      res.status(statusCode).json(report);
    } catch (error) {
      console.error('[VOICE HEALTH] Error generating report:', error);
      res.status(500).json({
        error: 'Failed to generate voice health report',
        timestamp: new Date().toISOString()
      });
    }
  },

  // 🎯 SIMPLE COMPLIANCE CHECK 🎯
  getComplianceStatus: (req: Request, res: Response) => {
    try {
      const guaranteeStatus = voiceHealthMonitor.getGuaranteeStatus();
      
      res.status(guaranteeStatus.overallCompliance ? 200 : 503).json({
        compliant: guaranteeStatus.overallCompliance,
        status: guaranteeStatus.overallCompliance ? 'ALL FORTUNE 50 GUARANTEES MET' : 'SLA VIOLATIONS DETECTED',
        timestamp: new Date().toISOString(),
        guarantees: {
          responseTime: guaranteeStatus.responseTime.compliant,
          successRate: guaranteeStatus.successRate.compliant,
          audioQuality: guaranteeStatus.audioQuality.compliant,
          uptime: guaranteeStatus.uptime.compliant
          }
});

// 🎯 BULLETPROOF VOICE HEALTH MONITORING ROUTES 🎯
healthzRouter.get('/voice/health-report', healthzRoutes.getVoiceHealthReport);
healthzRouter.get('/voice/compliance', healthzRoutes.getComplianceStatus);
healthzRouter.get('/voice/performance', healthzRoutes.getPerformanceSummary);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to check compliance status',
        timestamp: new Date().toISOString()
      });
    }
  },

  // 🎯 PERFORMANCE SUMMARY 🎯
  getPerformanceSummary: (req: Request, res: Response) => {
    try {
      const report = voiceHealthMonitor.generatePerformanceReport();
      
      res.status(200).json({
        summary: report,
        timestamp: new Date().toISOString(),
        format: 'text'
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to generate performance summary',
        timestamp: new Date().toISOString()
      });
    }
  }
}; 