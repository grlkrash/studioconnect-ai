/**
 * 🎯 ENTERPRISE PERFORMANCE MONITORING 🎯
 * Professional monitoring system for production voice agent reliability
 * 
 * Features:
 * - Real-time performance tracking
 * - Automatic alerts when metrics fall below thresholds
 * - Detailed health reporting
 * - SLA compliance monitoring
 * 
 * Usage:
 * const monitor = VoiceHealthMonitor.getInstance();
 * monitor.trackCallStart(callSid);
 * monitor.trackResponse(callSid, responseTimeMs);
 * monitor.trackCallEnd(callSid, success);
 */

import { EventEmitter } from 'events'
import { CallStatus } from '../types/callStatus';
import { PrismaClient } from '@prisma/client';
import realtimeAgentService from '../services/realtimeAgentService';

const prisma = new PrismaClient();

// 🎯 ENTERPRISE PERFORMANCE MONITORING 🎯
const PERFORMANCE_GUARANTEES = {
  RESPONSE_TIME_MS: 2000,        // 2 second response time
  AUDIO_QUALITY_SCORE: 90,       // 90% audio quality
  SUCCESS_RATE_PERCENT: 80,      // 80% success rate  
  ERROR_RECOVERY_MS: 5000,       // 5 second error recovery
  UPTIME_PERCENT: 95             // 95% uptime
}

const CONNECTION_HEALTH_CHECK_INTERVAL_MS = 10000; // 10 seconds

interface PerformanceMetrics {
  responseTime: number;
  audioQuality: number;
  successRate: number;
  errorRecoveryTime: number;
  uptime: number;
  callsHandled: number;
  errorsEncountered: number;
  lastErrorTime: number;
  // Additional metrics for health reporting
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  currentActiveConnections: number;
  peakConcurrentConnections: number;
  averageResponseTime: number;
  maxResponseTime: number;
  responseTimeP95: number;
  responseTimeP99: number;
  averageAudioQuality: number;
  totalAudioDropouts: number;
  averageContextLength: number;
  maxContextLength: number;
  totalErrors: number;
  averageRecoveryTime: number;
  maxRecoveryTime: number;
  uptimePercentage: number;
  memoryUsage: number;
  cpuUsage: number;
  totalUptime: number;
}

interface VoiceHealthAlert {
  timestamp: Date;
  type: 'RESPONSE_TIME' | 'AUDIO_QUALITY' | 'SUCCESS_RATE' | 'ERROR_RECOVERY' | 'UPTIME';
  severity: 'WARNING' | 'CRITICAL';
  message: string;
  metric: number;
  threshold: number;
  businessId?: string;
  callSid?: string;
  currentValue?: number;
}

/**
 * 🎯 ENTERPRISE VOICE HEALTH MONITORING SYSTEM 🎯 
 * Professional monitoring system for production voice agent reliability
 * 
 * Features:
 * - Real-time performance tracking
 * - Automatic alerts when metrics fall below thresholds
 * - Detailed health reporting
 * - SLA compliance monitoring
 * 
 * Usage:
 * const monitor = VoiceHealthMonitor.getInstance();
 * monitor.trackCallStart(callSid);
 * monitor.trackResponse(callSid, responseTimeMs);
 * monitor.trackCallEnd(callSid, success);
 */
class VoiceHealthMonitor extends EventEmitter {
  private static instance: VoiceHealthMonitor;
  private metrics: PerformanceMetrics;
  private alerts: VoiceHealthAlert[];
  private activeCalls: Map<string, { startTime: number; lastActivity: number }>;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private startTime: number;

  private constructor() {
    super();
    this.metrics = {
      responseTime: 0,
      audioQuality: 100,
      successRate: 100,
      errorRecoveryTime: 0,
      uptime: 100,
      callsHandled: 0,
      errorsEncountered: 0,
      lastErrorTime: 0,
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      currentActiveConnections: 0,
      peakConcurrentConnections: 0,
      averageResponseTime: 0,
      maxResponseTime: 0,
      responseTimeP95: 0,
      responseTimeP99: 0,
      averageAudioQuality: 100,
      totalAudioDropouts: 0,
      averageContextLength: 0,
      maxContextLength: 0,
      totalErrors: 0,
      averageRecoveryTime: 0,
      maxRecoveryTime: 0,
      uptimePercentage: 100,
      memoryUsage: 0,
      cpuUsage: 0,
      totalUptime: 0
    };
    this.alerts = [];
    this.activeCalls = new Map();
    this.startTime = Date.now();
    this.startHealthChecks();
  }

  public static getInstance(): VoiceHealthMonitor {
    if (!VoiceHealthMonitor.instance) {
      VoiceHealthMonitor.instance = new VoiceHealthMonitor();
    }
    return VoiceHealthMonitor.instance;
  }

  /**
   * Initialize the monitoring system
   */
  public initialize(): void {
    console.log('🎯 INITIALIZING ENTERPRISE VOICE HEALTH MONITORING...');
    console.log('✅ Professional Performance Monitoring: ACTIVE');
    console.log('✅ Real-time SLA Monitoring: ENABLED');
    console.log('✅ Automatic Alert System: ARMED');
    console.log('✅ ENTERPRISE VOICE HEALTH MONITORING ACTIVE');
  }

  /**
   * 🎯 TRACK CALL INITIATION - FORTUNE 50 PRECISION 🎯
   */
  public trackCallStart(callSid: string, businessId?: string): void {
    console.log(`[🎯 VOICE MONITOR] 📞 TRACKING CALL START: ${callSid}`);
    
    this.activeCalls.set(callSid, { startTime: Date.now(), lastActivity: Date.now() });
    this.metrics.callsHandled++;
    
    console.log(`[🎯 VOICE MONITOR] ✅ Call Started: ${callSid}`);
  }

  /**
   * 🎯 TRACK RESPONSE TIME - SUB-2-SECOND GUARANTEE 🎯
   */
  public trackResponseTime(callSid: string, responseTimeMs: number): void {
    const callData = this.activeCalls.get(callSid);
    if (!callData) return;

    const now = Date.now();
    const elapsed = now - callData.startTime;
    
    this.metrics.responseTime = responseTimeMs;
    
    // Update response time metrics
    const responseTimes = Array.from(this.activeCalls.values())
      .map(c => c.startTime ? (Date.now() - c.startTime) : 0)
      .filter(t => t > 0);
    
    if (responseTimes.length > 0) {
      this.metrics.responseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    }

    // 🚨 CRITICAL ALERT: Response time guarantee breach
    if (responseTimeMs > PERFORMANCE_GUARANTEES.RESPONSE_TIME_MS) {
      this.triggerAlert({
        type: 'RESPONSE_TIME',
        severity: 'CRITICAL',
        message: `🚨 FORTUNE 50 SLA BREACH: Response time ${responseTimeMs}ms exceeds ${PERFORMANCE_GUARANTEES.RESPONSE_TIME_MS}ms guarantee`,
        timestamp: new Date(),
        metric: responseTimeMs,
        threshold: PERFORMANCE_GUARANTEES.RESPONSE_TIME_MS
      });
    }

    console.log(`[🎯 VOICE MONITOR] ⚡ Response Time: ${responseTimeMs}ms (Target: <${PERFORMANCE_GUARANTEES.RESPONSE_TIME_MS}ms)`);
  }

  /**
   * 🎯 TRACK AUDIO QUALITY - 90%+ CLARITY GUARANTEE 🎯
   */
  public trackAudioQuality(callSid: string, qualityScore: number): void {
    const callData = this.activeCalls.get(callSid);
    if (!callData) return;

    this.metrics.audioQuality = qualityScore;
    
    // 🚨 CRITICAL ALERT: Audio quality guarantee breach
    if (qualityScore < PERFORMANCE_GUARANTEES.AUDIO_QUALITY_SCORE) {
      this.triggerAlert({
        type: 'AUDIO_QUALITY',
        severity: 'CRITICAL',
        message: `🚨 FORTUNE 50 AUDIO BREACH: Quality score ${qualityScore}% below ${PERFORMANCE_GUARANTEES.AUDIO_QUALITY_SCORE}% guarantee`,
        timestamp: new Date(),
        metric: qualityScore,
        threshold: PERFORMANCE_GUARANTEES.AUDIO_QUALITY_SCORE
      });
    }

    console.log(`[🎯 VOICE MONITOR] 🎵 Audio Quality: ${qualityScore}% (Target: >${PERFORMANCE_GUARANTEES.AUDIO_QUALITY_SCORE}%)`);
  }

  /**
   * 🎯 TRACK CALL COMPLETION - SUCCESS RATE GUARANTEE 🎯
   */
  public trackCallEnd(callSid: string, status: CallStatus): void {
    const callData = this.activeCalls.get(callSid);
    if (!callData) return;

    const now = Date.now();
    const elapsed = now - callData.startTime;
    
    this.metrics.callsHandled--;

    // Update success rate
    if (status === CallStatus.COMPLETED) {
      this.metrics.successRate = 100;
    } else {
      this.metrics.successRate = 0;
    }

    // 🚨 CRITICAL ALERT: Success rate guarantee breach
    if (this.metrics.successRate < PERFORMANCE_GUARANTEES.SUCCESS_RATE_PERCENT) {
      this.triggerAlert({
        type: 'SUCCESS_RATE',
        severity: 'CRITICAL',
        message: `🚨 FORTUNE 50 SUCCESS BREACH: Success rate ${this.metrics.successRate.toFixed(2)}% below ${PERFORMANCE_GUARANTEES.SUCCESS_RATE_PERCENT}% guarantee`,
        timestamp: new Date(),
        metric: this.metrics.successRate,
        threshold: PERFORMANCE_GUARANTEES.SUCCESS_RATE_PERCENT
      });
    }

    console.log(`[🎯 VOICE MONITOR] ✅ Call Completed: ${status} (Success Rate: ${this.metrics.successRate.toFixed(2)}%)`);
    this.emit('callEnded', { callSid, status, timestamp: new Date() });
  }

  /**
   * 🎯 TRIGGER PERFORMANCE ALERT - INSTANT NOTIFICATION 🎯
   */
  private triggerAlert(alert: VoiceHealthAlert): void {
    this.alerts.push(alert);
    
    // Keep only last 1000 alerts
    if (this.alerts.length > 1000) {
      this.alerts = this.alerts.slice(-1000);
    }

    console.error(`[🚨 VOICE ALERT] ${alert.type}: ${alert.message}`);
    this.emit('performanceAlert', alert);

    // Send to monitoring systems (Slack, email, etc.)
    this.sendAlert(alert);
  }

  /**
   * 🎯 SEND ALERT TO MONITORING SYSTEMS 🎯
   */
  private async sendAlert(alert: VoiceHealthAlert): Promise<void> {
    try {
      // Store alert in database (optional - don't break if DB fails)
      await prisma.callLog.create({
        data: {
          businessId: alert.businessId || 'system',
          conversationId: 'alert-' + Date.now(),
          callSid: alert.callSid || 'system-alert',
          from: 'system',
          to: 'monitoring',
          direction: 'OUTBOUND',
          type: 'VOICE',
          status: 'FAILED',
          source: 'SYSTEM_ALERT',
          metadata: {
            alertType: alert.type,
            metric: alert.metric,
            currentValue: alert.currentValue,
            threshold: alert.threshold,
            message: alert.message
          }
        }
      }).catch(() => {}); // Ignore DB errors, don't let them break monitoring

      // TODO: Send to Slack, email, PagerDuty, etc.
      // await this.sendSlackAlert(alert);
      // await this.sendEmailAlert(alert);
    } catch (error) {
      console.error('[🎯 VOICE MONITOR] Failed to send alert:', error);
    }
  }

  /**
   * 🎯 START CONTINUOUS MONITORING - REAL-TIME HEALTH CHECKS 🎯
   */
  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
      this.updateSystemMetrics();
      this.checkSLACompliance();
    }, CONNECTION_HEALTH_CHECK_INTERVAL_MS); // Check every 10 seconds

    console.log('[🎯 VOICE MONITOR] ✅ Continuous monitoring started (10s intervals)');
  }

  /**
   * 🎯 PERFORM COMPREHENSIVE HEALTH CHECK 🎯
   */
  private performHealthCheck(): void {
    const now = Date.now();
    const uptimeMs = now - this.startTime;
    
    // Update uptime metrics
    this.metrics.uptime = (uptimeMs / CONNECTION_HEALTH_CHECK_INTERVAL_MS) * 100;

    // Check memory usage
    const memoryUsage = process.memoryUsage();
    this.metrics.memoryUsage = Math.round(memoryUsage.heapUsed / 1024 / 1024); // MB
    
    // Memory usage alert
    if (this.metrics.memoryUsage > 1500) { // 1.5GB threshold
      this.triggerAlert({
        type: 'UPTIME',
        severity: 'WARNING',
        message: `⚠️ High memory usage: ${this.metrics.memoryUsage}MB`,
        timestamp: new Date(),
        metric: this.metrics.memoryUsage,
        threshold: 1500
      });
    }

    console.log(`[🎯 VOICE MONITOR] 💓 Health Check: Uptime ${this.metrics.uptime.toFixed(2)}%, Memory ${this.metrics.memoryUsage}MB`);
  }

  /**
   * 🎯 UPDATE SYSTEM METRICS 🎯
   */
  private updateSystemMetrics(): void {
    // Calculate CPU usage (simplified)
    const usage = process.cpuUsage();
    this.metrics.cpuUsage = Math.round((usage.user + usage.system) / 1000000); // Convert to seconds
  }

  /**
   * 🎯 CHECK SLA COMPLIANCE - FORTUNE 50 STANDARDS 🎯
   */
  private checkSLACompliance(): void {
    const violations: string[] = [];

    if (this.metrics.responseTime > PERFORMANCE_GUARANTEES.RESPONSE_TIME_MS) {
      violations.push(`Response Time: ${this.metrics.responseTime}ms > ${PERFORMANCE_GUARANTEES.RESPONSE_TIME_MS}ms`);
    }

    if (this.metrics.successRate < PERFORMANCE_GUARANTEES.SUCCESS_RATE_PERCENT) {
      violations.push(`Success Rate: ${this.metrics.successRate.toFixed(2)}% < ${PERFORMANCE_GUARANTEES.SUCCESS_RATE_PERCENT}%`);
    }

    if (this.metrics.audioQuality < PERFORMANCE_GUARANTEES.AUDIO_QUALITY_SCORE) {
      violations.push(`Audio Quality: ${this.metrics.audioQuality.toFixed(2)}% < ${PERFORMANCE_GUARANTEES.AUDIO_QUALITY_SCORE}%`);
    }

    if (this.metrics.uptime < PERFORMANCE_GUARANTEES.UPTIME_PERCENT) {
      violations.push(`Uptime: ${this.metrics.uptime.toFixed(2)}% < ${PERFORMANCE_GUARANTEES.UPTIME_PERCENT}%`);
    }

    if (violations.length > 0) {
      this.triggerAlert({
        type: 'UPTIME',
        severity: 'CRITICAL',
        message: `🚨 FORTUNE 50 SLA VIOLATIONS: ${violations.join(', ')}`,
        timestamp: new Date(),
        metric: 0,
        threshold: 0
      });
    }
  }

  /**
   * 🎯 GET REAL-TIME PERFORMANCE METRICS 🎯
   */
  public getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }

  /**
   * 🎯 GET PERFORMANCE GUARANTEES STATUS 🎯
   */
  public getGuaranteeStatus(): {
    responseTime: { current: number; target: number; compliant: boolean };
    successRate: { current: number; target: number; compliant: boolean };
    audioQuality: { current: number; target: number; compliant: boolean };
    uptime: { current: number; target: number; compliant: boolean };
    overallCompliance: boolean;
  } {
    const responseTimeCompliant = this.metrics.responseTime <= PERFORMANCE_GUARANTEES.RESPONSE_TIME_MS;
    const successRateCompliant = this.metrics.successRate >= PERFORMANCE_GUARANTEES.SUCCESS_RATE_PERCENT;
    const audioQualityCompliant = this.metrics.audioQuality >= PERFORMANCE_GUARANTEES.AUDIO_QUALITY_SCORE;
    const uptimeCompliant = this.metrics.uptime >= PERFORMANCE_GUARANTEES.UPTIME_PERCENT;

    return {
      responseTime: {
        current: this.metrics.responseTime,
        target: PERFORMANCE_GUARANTEES.RESPONSE_TIME_MS,
        compliant: responseTimeCompliant
      },
      successRate: {
        current: this.metrics.successRate,
        target: PERFORMANCE_GUARANTEES.SUCCESS_RATE_PERCENT,
        compliant: successRateCompliant
      },
      audioQuality: {
        current: this.metrics.audioQuality,
        target: PERFORMANCE_GUARANTEES.AUDIO_QUALITY_SCORE,
        compliant: audioQualityCompliant
      },
      uptime: {
        current: this.metrics.uptime,
        target: PERFORMANCE_GUARANTEES.UPTIME_PERCENT,
        compliant: uptimeCompliant
      },
      overallCompliance: responseTimeCompliant && successRateCompliant && audioQualityCompliant && uptimeCompliant
    };
  }

  /**
   * 🎯 GET RECENT ALERTS 🎯
   */
  public getRecentAlerts(limit: number = 50): VoiceHealthAlert[] {
    return this.alerts.slice(-limit).reverse();
  }

  /**
   * 🎯 GENERATE PERFORMANCE REPORT 🎯
   */
  public generatePerformanceReport(): string {
    const guarantees = this.getGuaranteeStatus();
    const complianceEmoji = guarantees.overallCompliance ? '✅' : '🚨';
    
    return `
🎯 BULLETPROOF VOICE AGENT PERFORMANCE REPORT 🎯

${complianceEmoji} OVERALL COMPLIANCE: ${guarantees.overallCompliance ? 'MEETING ALL FORTUNE 50 GUARANTEES' : 'SLA VIOLATIONS DETECTED'}

📊 PERFORMANCE METRICS:
• Response Time: ${this.metrics.responseTime.toFixed(0)}ms (Target: <${PERFORMANCE_GUARANTEES.RESPONSE_TIME_MS}ms) ${guarantees.responseTime.compliant ? '✅' : '🚨'}
• Success Rate: ${this.metrics.successRate.toFixed(2)}% (Target: >${PERFORMANCE_GUARANTEES.SUCCESS_RATE_PERCENT}%) ${guarantees.successRate.compliant ? '✅' : '🚨'}
• Audio Quality: ${this.metrics.audioQuality.toFixed(1)}% (Target: >${PERFORMANCE_GUARANTEES.AUDIO_QUALITY_SCORE}%) ${guarantees.audioQuality.compliant ? '✅' : '🚨'}
• Uptime: ${this.metrics.uptime.toFixed(2)}% (Target: >${PERFORMANCE_GUARANTEES.UPTIME_PERCENT}%) ${guarantees.uptime.compliant ? '✅' : '🚨'}

📈 CALL STATISTICS:
• Total Calls: ${this.metrics.callsHandled}
• Active Connections: ${this.metrics.callsHandled}

💾 SYSTEM HEALTH:
• Memory Usage: ${this.metrics.memoryUsage}MB
• Total Errors: ${this.metrics.errorsEncountered}
• Average Recovery Time: ${this.metrics.errorRecoveryTime.toFixed(0)}ms

🚨 RECENT ALERTS: ${this.alerts.length > 0 ? this.alerts.slice(-5).map(a => a.message).join('\n• ') : 'None'}
    `.trim();
  }

  /**
   * 🎯 SHUTDOWN MONITORING 🎯
   */
  public shutdown(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    console.log('[🎯 VOICE MONITOR] Monitoring stopped');
  }
}

// Export singleton instance
export const voiceHealthMonitor = VoiceHealthMonitor.getInstance(); 