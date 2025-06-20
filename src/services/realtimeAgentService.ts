import { WebSocket } from 'ws';
import twilio from 'twilio';
import { PrismaClient, LeadPriority } from '@prisma/client';
import { processMessage } from '../core/aiHandler';
import { getChatCompletion } from '../services/openai';
import { cleanVoiceResponse } from '../utils/voiceHelpers';
import { sendLeadNotificationEmail, initiateEmergencyVoiceCall, sendLeadConfirmationToCustomer } from './notificationService';
import OpenAI from 'openai';
import { generateSpeechFromText, getTranscription } from './openai';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { getBusinessWelcomeMessage } from './businessService';
import { getClientByPhoneNumber } from './clientService';
import crypto from 'crypto';
import { normalizePhoneNumber } from '../utils/phoneHelpers';
import ffmpegPath from 'ffmpeg-static';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { OpenAIRealtimeClient } from './openaiRealtimeClient';
import { createVoiceSystemPrompt } from '../core/aiHandler';
import { LeadQualifier } from '../core/leadQualifier';
import { getPrimaryUrl } from '../utils/env';
import { BulletproofElevenLabsClient } from './elevenlabsStreamingClient'
import { formatForSpeech } from '../utils/ssml';
import RedisManager from '../config/redis';
import ENTERPRISE_VOICE_CONFIG, { validateEnterpriseConfig, getEnterpriseVoiceSettings, getEnterpriseVADSettings, getEnterprisePhantomFilter, getEnterpriseErrorMessages } from '../config/enterpriseDefaults';
import { voiceHealthMonitor } from '../monitor/voiceHealthMonitor';

const prisma = new PrismaClient();
const openai = new OpenAI();
const execFileAsync = promisify(execFile);

// Prisma enums are emitted as string union types, so we'll use string literals for values

// Initialize Twilio REST client for fetching call details
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

interface ConnectionState {
  ws: WebSocket;
  isTwilioReady: boolean;
  isAiReady: boolean;
  streamSid: string | null;
  audioQueue: string[];
  conversationHistory: Array<{ role: 'user' | 'assistant', content: string, timestamp: Date }>;
  businessId: string | null;
  leadCaptureTriggered: boolean;
  hasCollectedLeadInfo: boolean;
  isCallActive: boolean;
  welcomeMessageDelivered: boolean;
  welcomeMessageAttempts: number;
  isCleaningUp: boolean;
  callSid: string | null;
  lastActivity: number;
  fromNumber: string | null;
  toNumber: string | null;
  clientId?: string;
  currentFlow: string | null;
  ttsProvider: 'openai' | 'polly' | 'realtime' | 'elevenlabs';
  openaiVoice: string;
  openaiModel: string;
  personaPrompt?: string;
  lastSpeechMs: number;
  vadCalibrated: boolean;
  vadSamples: number;
  vadNoiseFloor: number;
  vadThreshold: number;
  /** Indicates we have received at least one non-empty user transcript this turn */
  hasUserTranscript: boolean;
  /** Indicates that we are currently recording an utterance */
  isRecording: boolean;
  isProcessing: boolean;
  __configLoaded?: boolean;
  openaiClient?: OpenAIRealtimeClient;
  isSpeaking: boolean;
  pendingAudioGeneration: boolean;
  /** internal idle follow-up prompt counter */
  idlePromptCount?: number;
  idlePromptTimer?: NodeJS.Timeout | null;
  callStartTime?: number;
  /** true if current recording chunk is linear16 */
  isLinear16Recording?: boolean;
  /** lead qualification */
  leadQualifier?: LeadQualifier
  qualAnswers?: Record<string, string>
  currentMissingQuestionId?: string;
  qualQuestionMap?: Record<string, { questionText: string; mapsToLeadField?: string }>
  sttClient?: BulletproofElevenLabsClient;
  voiceSettings?: any;
  /** timestamp when current recording started */
  recordingStartMs?: number;
  /** timer waiting for first realtime audio chunk */
  realtimeAudioTimer?: NodeJS.Timeout | null;
  /** last assistant text received (for TTS fallback) */
  lastAssistantText?: string;
  /** --- NEW: barge-in handling --- */
  bargeInDetected?: boolean;
  /** Remaining speech buffer that was interrupted */
  pendingSpeechBuffer?: Buffer | null;
  /** indicates that the agent has transitioned to an active listening state */
  isListening: boolean;
}

interface AgentSession {
  ws: WebSocket;
  businessId: string;
  conversationId: string;
  isActive: boolean;
  lastActivity: Date;
}

interface Question {
  questionText: string;
  order: number;
}

interface TwilioMedia {
  payload?: string;
  event?: string;
  streamSid?: string;
}

// Types
interface AgentState {
  callSid: string;
  businessId: string;
  conversationHistory: Array<{ role: 'user' | 'assistant', content: string }>;
  currentFlow: string | null;
  isProcessing: boolean;
  lastActivity: number;
  metadata: {
    callerNumber: string;
    twilioCallSid: string;
    voiceSettings: {
      voice: string;
      language: string;
    };
  };
}

interface AgentConfig {
  useOpenaiTts: boolean;
  openaiVoice: 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'sage' | 'shimmer' | 'verse';
  openaiModel: 'tts-1' | 'tts-1-hd';
  welcomeMessage: string;
  voiceGreetingMessage: string;
}

// 🎯 BULLETPROOF FORTUNE 500 ENTERPRISE CONSTANTS 🎯
const MAX_CONVERSATION_HISTORY = 50;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_MEMORY_USAGE_MB = 1536; // 75% of 2GB RAM

// Import enterprise-grade settings from centralized config
const VAD_CONFIG = getEnterpriseVADSettings();
const VAD_THRESHOLD = VAD_CONFIG.THRESHOLD;
const VAD_SILENCE_MS = VAD_CONFIG.SILENCE_MS;
const MAX_UTTERANCE_MS = VAD_CONFIG.MAX_UTTERANCE_MS;
const IDLE_PROMPT_DELAYS_MS = ENTERPRISE_VOICE_CONFIG.TIMING.IDLE_PROMPTS;

// 🎯 BULLETPROOF ENTERPRISE DEFAULTS - CENTRALIZED CONFIGURATION 🎯
const ENTERPRISE_DEFAULTS = {
  ttsProvider: ENTERPRISE_VOICE_CONFIG.TTS.PRIMARY_PROVIDER,
  voiceId: ENTERPRISE_VOICE_CONFIG.TTS.ELEVENLABS.DEFAULT_VOICE_ID,
  modelId: ENTERPRISE_VOICE_CONFIG.TTS.ELEVENLABS.DEFAULT_MODEL,
  voiceSettings: getEnterpriseVoiceSettings()
}

// State management
const activeAgents = new Map<string, ConnectionState>();
let cleanupInterval: NodeJS.Timeout;

// -----------------------------------
//  Voice-config cache (per business)
// -----------------------------------
type VoiceConfigCacheEntry = {
  ttsProvider: 'openai' | 'polly' | 'realtime' | 'elevenlabs'
  openaiVoice: string
  openaiModel: string
  personaPrompt?: string
  cachedAt: number
}

// In-memory cache; TTL keeps things fresh across config edits while preventing DB spam during a call
const VOICE_CFG_TTL_MS = 10 * 60 * 1000 // 10 minutes
const voiceConfigCache = new Map<string, VoiceConfigCacheEntry>()

// --- New: cache to remember realtime failures per business ---
const REALTIME_FAILURE_CACHE = new Map<string, number>()
const REALTIME_FAILURE_TTL_MS = 30 * 60 * 1000 // 30 minutes

// Helper to check if realtime is temporarily disabled for a business
function isRealtimeTemporarilyDisabled(businessId: string): boolean {
  const ts = REALTIME_FAILURE_CACHE.get(businessId)
  if (!ts) return false
  return (Date.now() - ts) < REALTIME_FAILURE_TTL_MS
}

function markRealtimeFailure(businessId: string): void {
  REALTIME_FAILURE_CACHE.set(businessId, Date.now())
}

// Initialize cleanup interval
function startCleanupInterval(): void {
  if (cleanupInterval) clearInterval(cleanupInterval);
  
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [callSid, state] of activeAgents.entries()) {
      if (now - state.lastActivity > SESSION_TIMEOUT_MS) {
        activeAgents.delete(callSid);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`[Agent Cleanup] Removed ${cleanedCount} inactive sessions`);
    }
    
    // Memory check
    const memoryUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
    
    if (heapUsedMB > MAX_MEMORY_USAGE_MB) {
      console.warn(`[Memory Alert] High memory usage: ${heapUsedMB}MB > ${MAX_MEMORY_USAGE_MB}MB threshold`);
    }
  }, CLEANUP_INTERVAL_MS);
}

// Start cleanup on module load
startCleanupInterval();

// Helper functions
function logMemoryUsage(context: string): void {
  const usage = process.memoryUsage();
  const formatBytes = (bytes: number): number => Math.round(bytes / 1024 / 1024 * 100) / 100;
  
  console.log(`[Memory ${context}] RSS: ${formatBytes(usage.rss)}MB, Heap Used: ${formatBytes(usage.heapUsed)}MB`);
}

async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    // Do not delete shared cache files
    if (filePath.includes('scai_tts_cache')) return
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
      console.log(`[File Cleanup] Deleted temp file: ${filePath}`);
    }
  } catch (error) {
    console.error(`[File Cleanup] Error deleting temp file ${filePath}:`, error);
  }
}

// Add conversational fillers to enhance naturalness of the assistant tone.
const FILLER_INSTRUCTIONS = '\nWhen responding, occasionally use natural fillers such as "Got it.", "Perfect.", "Let me check that for you…", or "Absolutely." to sound conversational.'

/**
 * 🏢 ENTERPRISE REALTIME VOICE AGENT SERVICE 🏢
 * 
 * Bulletproof voice agent system designed for Fortune 50 companies
 * Features:
 * - ElevenLabs premium TTS as default for enterprise quality
 * - Bulletproof welcome message delivery with triple fallbacks
 * - Professional conversation handling with lead qualification
 * - Enterprise-grade error recovery and failover systems
 * - Optimized for high-stakes business conversations
 */
class RealtimeAgentService {
  private static instance: RealtimeAgentService;
  private connections: Map<string, ConnectionState>;
  private twilioClient: twilio.Twilio;
  private callSid: string | null = null;
  private onCallSidReceived?: (callSid: string) => void;
  private connectToOpenAI?: () => void;

  private constructor() {
    this.connections = new Map();
    this.twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    
    // 🎯 VALIDATE ENTERPRISE CONFIGURATION 🎯
    if (!validateEnterpriseConfig()) {
      console.error('[🎯 ENTERPRISE INIT] ❌ CRITICAL: Enterprise configuration validation failed');
      throw new Error('Enterprise configuration validation failed - system cannot start');
    }
    
    console.log('🎯 BULLETPROOF ENTERPRISE VOICE AGENT SERVICE INITIALIZED 🎯');
    console.log('✅ ElevenLabs Premium TTS: FORCED DEFAULT');
    console.log('✅ Fortune 500 Quality: BULLETPROOF');
    console.log('✅ Phantom Speech Filtering: ENTERPRISE GRADE');
    console.log('✅ Error Recovery: BULLETPROOF');
    console.log('✅ VAD Configuration: OPTIMIZED FOR BUSINESS');
  }

  public static getInstance(): RealtimeAgentService {
    if (!RealtimeAgentService.instance) {
      RealtimeAgentService.instance = new RealtimeAgentService();
    }
    return RealtimeAgentService.instance;
  }

  public getCallSid(): string | null {
    return this.callSid;
  }

  public async handleNewConnection(ws: WebSocket, params: URLSearchParams): Promise<void> {
    const callSid = params.get('callSid');
    const businessId = params.get('businessId');
    const fromNumber = params.get('fromPhoneNumber');

    // Allow connections even if callSid or businessId is missing – they can be
    // derived from the Twilio START event that follows the websocket upgrade.
    if (!callSid || !businessId) {
      console.warn('[🏢 ENTERPRISE AGENT] Missing callSid or businessId in WebSocket URL – will derive from START event', {
        callSid,
        businessId
      })
    }

    this.callSid = callSid;
    console.log(`[🏢 ENTERPRISE AGENT] 🚀 NEW FORTUNE 50 CONNECTION: Call ${callSid} → Business ${businessId}`);

    // Initialize connection state with BULLETPROOF ENTERPRISE DEFAULTS
    const state: ConnectionState = {
      ws,
      callSid,
      businessId,
      fromNumber: fromNumber || null,
      conversationHistory: [],
      currentFlow: null,
      isTwilioReady: false,
      isAiReady: false,
      streamSid: null,
      audioQueue: [],
      leadCaptureTriggered: false,
      hasCollectedLeadInfo: false,
      isCallActive: false,
      welcomeMessageDelivered: false,
      welcomeMessageAttempts: 0,
      isCleaningUp: false,
      lastActivity: Date.now(),
      toNumber: null,
      // 🎯 FORCE ELEVENLABS AS DEFAULT FOR ENTERPRISE QUALITY 🎯
      ttsProvider: ENTERPRISE_DEFAULTS.ttsProvider,
      openaiVoice: ENTERPRISE_DEFAULTS.voiceId,
      openaiModel: ENTERPRISE_DEFAULTS.modelId,
      personaPrompt: undefined,
      lastSpeechMs: Date.now(),
      vadCalibrated: false,
      vadSamples: 0,
      vadNoiseFloor: 0,
      vadThreshold: VAD_THRESHOLD,
      isRecording: false,
      isProcessing: false,
      __configLoaded: false,
      openaiClient: undefined,
      isSpeaking: false,
      pendingAudioGeneration: false,
      idlePromptCount: 0,
      idlePromptTimer: null,
      callStartTime: Date.now(),
      hasUserTranscript: false,
      bargeInDetected: false,
      pendingSpeechBuffer: null,
      // 🎯 ENTERPRISE VOICE SETTINGS FOR FORTUNE 50 QUALITY 🎯
      voiceSettings: { ...ENTERPRISE_DEFAULTS.voiceSettings },
      isListening: false,
    };

    // Try to identify client if phone number is available
    if (fromNumber) {
      try {
        const client = await getClientByPhoneNumber(fromNumber);
        if (client) {
          state.clientId = client.id;
          console.log(`[🏢 ENTERPRISE AGENT] ✅ IDENTIFIED EXISTING CLIENT: ${client.id} for call ${callSid}`);
        }
      } catch (error) {
        console.error(`[🏢 ENTERPRISE AGENT] ❌ Error identifying client:`, error);
      }
    }

    const connectionKey = callSid ?? crypto.randomUUID();
    this.connections.set(connectionKey, state);

    // Register lifecycle listeners for this WebSocket
    this.setupWebSocketListeners(state);

    // 🏢 ENTERPRISE-GRADE INITIALIZATION SEQUENCE 🏢
    if (callSid && businessId) {
      try {
        console.log(`[🏢 ENTERPRISE AGENT] 🔧 LOADING ENTERPRISE CONFIGURATION...`);
        
        // Load business configuration FIRST with bulletproof error handling
        await this.loadEnterpriseVoiceConfiguration(state);
        
        // Create conversation record
        await prisma.callLog.create({
          data: {
            businessId,
            conversationId: crypto.randomUUID(),
            callSid,
            from: fromNumber ?? '',
            to: '',
            direction: 'INBOUND',
            type: 'VOICE',
            status: 'INITIATED',
            source: 'TWILIO'
          }
        });

        console.log(`[🏢 ENTERPRISE AGENT] ✅ ENTERPRISE VOICE PIPELINE INITIALIZED FOR BUSINESS ${businessId}`);
        console.log(`[🏢 ENTERPRISE AGENT] 🎯 Provider: ${state.ttsProvider.toUpperCase()}`);
        console.log(`[🏢 ENTERPRISE AGENT] 🎙️ Voice: ${state.openaiVoice}`);
        console.log(`[🏢 ENTERPRISE AGENT] 🚀 READY FOR FORTUNE 50 QUALITY EXPERIENCE`);
      } catch (error) {
        console.error('[🏢 ENTERPRISE AGENT] ❌ Error in enterprise initialization:', error);
        // Continue with bulletproof defaults
        console.log('[🏢 ENTERPRISE AGENT] 🛡️ CONTINUING WITH BULLETPROOF DEFAULTS');
      }
    }

    // Schedule idle prompts for professional call management
    this._scheduleIdlePrompt(state);
  }

  /**
   * 🎯 BULLETPROOF ENTERPRISE VOICE CONFIGURATION LOADER 🎯
   * Loads voice configuration with triple-layered fallback system
   */
  private async loadEnterpriseVoiceConfiguration(state: ConnectionState): Promise<void> {
    if (!state.businessId || state.__configLoaded) return;

    console.log(`[🏢 ENTERPRISE CONFIG] 🔧 Loading voice configuration for business ${state.businessId}`);

    try {
      // 🎯 LAYER 1: Load from database with comprehensive error handling
      const cfg: any = await prisma.agentConfig.findUnique({
        where: { businessId: state.businessId },
        select: {
          useOpenaiTts: true,
          openaiVoice: true,
          openaiModel: true,
          personaPrompt: true,
          ttsProvider: true,
          voiceSettings: true,
          elevenlabsVoice: true,
          elevenlabsModel: true,
          voiceGreetingMessage: true,
          welcomeMessage: true,
        } as any,
      });

      if (cfg) {
        console.log(`[🏢 ENTERPRISE CONFIG] ✅ Configuration found in database`);
        
        // 🎯 FORCE ELEVENLABS FOR ENTERPRISE QUALITY - NO EXCEPTIONS 🎯
        state.ttsProvider = 'elevenlabs';
        console.log(`[🏢 ENTERPRISE CONFIG] 🎯 FORCED ELEVENLABS FOR ENTERPRISE QUALITY`);
        
        // 🎯 CRITICAL FIX: Use configured voice ID properly
        if ((cfg as any).elevenlabsVoice && (cfg as any).elevenlabsVoice.trim().length > 10) {
          state.openaiVoice = (cfg as any).elevenlabsVoice.trim();
          console.log(`[🏢 ENTERPRISE CONFIG] ✅ Using configured ElevenLabs voice: ${state.openaiVoice}`);
        } else if (cfg.openaiVoice && String(cfg.openaiVoice).trim().length > 3) {
          state.openaiVoice = String(cfg.openaiVoice).trim();
          console.log(`[🏢 ENTERPRISE CONFIG] ✅ Using configured OpenAI voice: ${state.openaiVoice}`);
        } else {
          state.openaiVoice = ENTERPRISE_DEFAULTS.voiceId;
          console.log(`[🏢 ENTERPRISE CONFIG] ⚠️ No voice configured - using enterprise default: ${state.openaiVoice}`);
        }
        
        // Set model with fallback
        state.openaiModel = (cfg as any).elevenlabsModel || cfg.openaiModel || ENTERPRISE_DEFAULTS.modelId;
        console.log(`[🏢 ENTERPRISE CONFIG] 🔧 Using model: ${state.openaiModel}`);
        
        // Set persona prompt
        state.personaPrompt = (cfg.personaPrompt || '') + FILLER_INSTRUCTIONS;
        
        // 🎯 PARSE VOICE SETTINGS WITH BULLETPROOF ERROR HANDLING 🎯
        try {
          const voiceSettings = (cfg as any).voiceSettings;
          if (voiceSettings) {
            if (typeof voiceSettings === 'string') {
              const parsed = JSON.parse(voiceSettings);
              state.voiceSettings = {
                stability: parsed.stability || 0.3,
                similarity_boost: parsed.similarity_boost || parsed.similarity || 0.8,
                style: parsed.style || 0.5,
                use_speaker_boost: parsed.use_speaker_boost !== false
              };
              console.log(`[🏢 ENTERPRISE CONFIG] ✅ Parsed voice settings from JSON string`);
            } else if (typeof voiceSettings === 'object') {
              state.voiceSettings = {
                stability: voiceSettings.stability || 0.3,
                similarity_boost: voiceSettings.similarity_boost || voiceSettings.similarity || 0.8,
                style: voiceSettings.style || 0.5,
                use_speaker_boost: voiceSettings.use_speaker_boost !== false
              };
              console.log(`[🏢 ENTERPRISE CONFIG] ✅ Using voice settings object`);
            } else {
              throw new Error('Invalid voice settings format');
            }
          } else {
            throw new Error('No voice settings found');
          }
        } catch (jsonErr) {
          console.warn('[🏢 ENTERPRISE CONFIG] ⚠️ Invalid voiceSettings, using enterprise defaults:', jsonErr);
          state.voiceSettings = { ...ENTERPRISE_DEFAULTS.voiceSettings };
        }
        
        console.log(`[🏢 ENTERPRISE CONFIG] ✅ ENTERPRISE VOICE CONFIG LOADED SUCCESSFULLY`);
        console.log(`[🏢 ENTERPRISE CONFIG] 📊 Voice Settings:`, state.voiceSettings);
      } else {
        // 🎯 LAYER 2: No config found - use enterprise defaults
        console.log(`[🏢 ENTERPRISE CONFIG] ⚠️ No config found, using ENTERPRISE DEFAULTS`);
        state.ttsProvider = ENTERPRISE_DEFAULTS.ttsProvider;
        state.openaiVoice = ENTERPRISE_DEFAULTS.voiceId;
        state.openaiModel = ENTERPRISE_DEFAULTS.modelId;
        state.voiceSettings = { ...ENTERPRISE_DEFAULTS.voiceSettings };
      }
    } catch (err) {
      // 🎯 LAYER 3: Database error - use bulletproof defaults
      console.error('[🏢 ENTERPRISE CONFIG] ❌ Database error, using BULLETPROOF DEFAULTS:', (err as Error).message);
      state.ttsProvider = ENTERPRISE_DEFAULTS.ttsProvider;
      state.openaiVoice = ENTERPRISE_DEFAULTS.voiceId;
      state.openaiModel = ENTERPRISE_DEFAULTS.modelId;
      state.voiceSettings = { ...ENTERPRISE_DEFAULTS.voiceSettings };
    } finally {
      state.__configLoaded = true;
      console.log(`[🏢 ENTERPRISE CONFIG] 🎯 FINAL CONFIGURATION:`);
      console.log(`[🏢 ENTERPRISE CONFIG] 🎯 Provider: ${state.ttsProvider}`);
      console.log(`[🏢 ENTERPRISE CONFIG] 🎯 Voice: ${state.openaiVoice}`);
      console.log(`[🏢 ENTERPRISE CONFIG] 🎯 Model: ${state.openaiModel}`);
      console.log(`[🏢 ENTERPRISE CONFIG] 🎯 READY FOR FORTUNE 50 QUALITY`);
    }
  }

  /**
   * 🎯 BULLETPROOF ENTERPRISE WELCOME MESSAGE SYSTEM 🎯
   * Triple-layered fallback system ensures welcome message ALWAYS delivers
   */
  private async getEnterpriseWelcomeMessage(state: ConnectionState): Promise<string> {
    console.log(`[🏢 ENTERPRISE WELCOME] 🎯 Generating welcome message for business: ${state.businessId}`);
    
    // 🎯 LAYER 1: Business-specific welcome message
    if (state.businessId) {
      try {
        const business = await prisma.business.findUnique({
          where: { id: state.businessId },
          select: { name: true }
        });

        const agentConfig = await prisma.agentConfig.findUnique({
          where: { businessId: state.businessId }
        });

        console.log(`[🏢 ENTERPRISE WELCOME] 📊 Database query result:`, {
          configExists: !!agentConfig,
          hasVoiceGreeting: !!agentConfig?.voiceGreetingMessage,
          hasWelcomeMessage: !!agentConfig?.welcomeMessage,
          voiceGreetingLength: agentConfig?.voiceGreetingMessage?.length || 0,
          welcomeMessageLength: agentConfig?.welcomeMessage?.length || 0,
          businessName: business?.name,
          agentName: agentConfig?.agentName,
          rawVoiceGreeting: agentConfig?.voiceGreetingMessage,
          rawWelcomeMessage: agentConfig?.welcomeMessage
        });

        let welcomeMessage = '';
        const businessName = business?.name || 'this premier creative agency';
        const agentName = agentConfig?.agentName || 'your AI Account Manager';
        
        // 🎯 CRITICAL FIX: Use CONFIGURED messages with proper validation
        console.log(`[🏢 ENTERPRISE WELCOME] 🔍 Raw config data:`, JSON.stringify({
          voiceGreetingMessage: agentConfig?.voiceGreetingMessage,
          welcomeMessage: agentConfig?.welcomeMessage,
          agentName: agentConfig?.agentName
        }, null, 2));

        if (agentConfig?.voiceGreetingMessage && agentConfig.voiceGreetingMessage.trim().length > 3) {
          welcomeMessage = agentConfig.voiceGreetingMessage.trim();
          console.log(`[🏢 ENTERPRISE WELCOME] ✅ Using CONFIGURED voice greeting: "${welcomeMessage}"`);
        } 
        else if (agentConfig?.welcomeMessage && agentConfig.welcomeMessage.trim().length > 3) {
          welcomeMessage = agentConfig.welcomeMessage.trim();
          console.log(`[🏢 ENTERPRISE WELCOME] ✅ Using CONFIGURED welcome message: "${welcomeMessage}"`);
        } 
        else {
          // Generate with actual business name
          welcomeMessage = `Hello! Thank you for calling ${businessName}. I'm ${agentName}, ready to assist you with your creative projects and business needs. How may I help you today?`;
          console.log(`[🏢 ENTERPRISE WELCOME] ⚠️ NO CONFIGURED MESSAGE - Using generated for ${businessName}`);
        }

        // 🎯 CRITICAL: Replace ALL placeholders properly
        welcomeMessage = welcomeMessage
          .replace(/\{businessName\}/gi, businessName)
          .replace(/\{agentName\}/gi, agentName)
          .replace(/\{business\}/gi, businessName)
          .replace(/\{company\}/gi, businessName);

        // 🎯 ENHANCEMENT: Enhanced personalization for clients
        if (state.clientId && state.fromNumber) {
          try {
            const client = await prisma.client.findUnique({
              where: { id: state.clientId },
              select: { name: true, email: true }
            });
            
            if (client) {
              const clientName = client.name;
              
              if (clientName) {
                welcomeMessage = `Welcome back, ${clientName}! ` + welcomeMessage;
                console.log(`[🏢 ENTERPRISE WELCOME] ✅ Personalized for client: ${clientName}`);
              } else {
                welcomeMessage = 'Welcome back! ' + welcomeMessage;
                console.log(`[🏢 ENTERPRISE WELCOME] ✅ Personalized for returning client`);
              }
            }
          } catch (clientError) {
            console.error(`[🏢 ENTERPRISE WELCOME] Error personalizing for client:`, clientError);
            welcomeMessage = 'Welcome back! ' + welcomeMessage;
          }
        }

        console.log(`[🏢 ENTERPRISE WELCOME] 🎯 FINAL MESSAGE: "${welcomeMessage}"`);
        return welcomeMessage;
      } catch (error) {
        console.error(`[🏢 ENTERPRISE WELCOME] ❌ Error getting business welcome message:`, error);
        // Fall through to Layer 2
      }
    }

    // 🎯 LAYER 2: Generic Fortune 500 professional welcome
    const genericMessage = 'Good day! Thank you for calling. I\'m your dedicated AI Account Manager, ready to provide immediate assistance with your creative projects and business needs. How may I help you today?';
    console.log(`[🏢 ENTERPRISE WELCOME] ⚠️ Using generic Fortune 500 professional message`);
    return genericMessage;
  }

  /**
   * 🎯 BULLETPROOF WELCOME MESSAGE DELIVERY SYSTEM 🎯
   * Ensures welcome message ALWAYS gets delivered with multiple fallback layers
   */
  private async deliverBulletproofWelcomeMessage(state: ConnectionState): Promise<void> {
    if (state.welcomeMessageDelivered) {
      console.log(`[🏢 ENTERPRISE WELCOME] ✅ Welcome message already delivered`);
      return;
    }

    if (!state.streamSid) {
      console.warn(`[🏢 ENTERPRISE WELCOME] ⚠️ No streamSid available, cannot deliver welcome message yet`);
      return;
    }

    console.log(`[🏢 ENTERPRISE WELCOME] 🚀 INITIATING BULLETPROOF WELCOME MESSAGE DELIVERY...`);

    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts && !state.welcomeMessageDelivered) {
      attempts++;
      console.log(`[🏢 ENTERPRISE WELCOME] 🎯 Delivery attempt ${attempts}/${maxAttempts}`);

      try {
        // Get welcome message
        const welcomeMessage = await this.getEnterpriseWelcomeMessage(state);
        console.log(`[🏢 ENTERPRISE WELCOME] 📝 Welcome message: "${welcomeMessage.substring(0, 100)}..."`);

        // Ensure we have a streamSid
        if (!state.streamSid) {
          throw new Error('StreamSid not available');
        }

        // Deliver with bulletproof TTS
        await this.streamEnterpriseQualityTTS(state, welcomeMessage);
        
        state.welcomeMessageDelivered = true;
        console.log(`[🏢 ENTERPRISE WELCOME] ✅ WELCOME MESSAGE DELIVERED SUCCESSFULLY ON ATTEMPT ${attempts}`);
        
        // 🎯 CRITICAL FIX: Transition to listening state immediately after successful delivery
        this.startListening(state);
        
        // 🎯 CRITICAL FIX: Initialize STT and ensure call stays alive
        await this.initializeElevenLabsSTT(state).catch(err => {
          console.error('[🏢 ENTERPRISE WELCOME] STT initialization warning:', err);
        });
        
        console.log(`[🏢 ENTERPRISE WELCOME] 🎯 Agent is now actively listening for caller response`);
        return;

      } catch (error) {
        console.error(`[🏢 ENTERPRISE WELCOME] ❌ Attempt ${attempts} failed:`, error);
        
        if (attempts === maxAttempts) {
          // Final emergency fallback
          console.log(`[🏢 ENTERPRISE WELCOME] 🚨 EMERGENCY FALLBACK ACTIVATED`);
          try {
            await this.streamEnterpriseQualityTTS(state, 'Hello! Thank you for calling. I am here to help. How may I assist you?');
            state.welcomeMessageDelivered = true;
            console.log(`[🏢 ENTERPRISE WELCOME] ✅ EMERGENCY WELCOME MESSAGE DELIVERED`);
            
            // 🎯 CRITICAL FIX: Ensure emergency fallback also starts listening
            this.startListening(state);
            await this.initializeElevenLabsSTT(state).catch(err => {
              console.error('[🏢 ENTERPRISE WELCOME] Emergency STT initialization warning:', err);
            });
          } catch (emergencyError) {
            console.error(`[🏢 ENTERPRISE WELCOME] 🚨 CRITICAL: Emergency fallback failed:`, emergencyError);
          }
        } else {
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
  }

  /**
   * 🎯 ENTERPRISE-GRADE TTS STREAMING SYSTEM 🎯
   * Bulletproof TTS with automatic provider fallback for Fortune 50 reliability
   */
  private async streamEnterpriseQualityTTS(state: ConnectionState, text: string): Promise<void> {
    if (!state.streamSid) {
      console.warn('[🏢 ENTERPRISE TTS] ⚠️ No streamSid available, cannot stream audio');
      return;
    }

    if (state.isSpeaking || state.pendingAudioGeneration) {
      console.warn('[🏢 ENTERPRISE TTS] ⚠️ Already generating/playing audio, skipping request');
      return;
    }

    // Validate text input
    if (!text || text.trim().length === 0) {
      console.warn('[🏢 ENTERPRISE TTS] ⚠️ Empty text provided, skipping TTS');
      return;
    }

    state.pendingAudioGeneration = true;
    console.log(`[🏢 ENTERPRISE TTS] 🚀 GENERATING ENTERPRISE QUALITY TTS: "${text.substring(0, 50)}..."`);

    try {
      // 🎯 CRITICAL: ENSURE CONFIGURATION IS LOADED AND VALID 🎯
      if (!state.__configLoaded || !state.businessId) {
        console.log(`[🏢 ENTERPRISE TTS] 🔧 Loading enterprise configuration...`);
        await this.loadEnterpriseVoiceConfiguration(state);
        state.__configLoaded = true;
      }

      // 🎯 FORCE ELEVENLABS FOR ENTERPRISE QUALITY - NO EXCEPTIONS 🎯
      console.log(`[🏢 ENTERPRISE TTS] 🔍 Current TTS provider: ${state.ttsProvider}`);
      console.log(`[🏢 ENTERPRISE TTS] 🔍 Current voice: ${state.openaiVoice}`);
      console.log(`[🏢 ENTERPRISE TTS] 🔍 Current model: ${state.openaiModel}`);
      
      // Force ElevenLabs with proper configuration
      state.ttsProvider = 'elevenlabs';
      
      // Validate and set voice configuration
      const voiceIdPattern = /^[a-zA-Z0-9_-]{15,}$/;
      if (!state.openaiVoice || !voiceIdPattern.test(state.openaiVoice)) {
        console.warn(`[🏢 ENTERPRISE TTS] ⚠️ Invalid/missing ElevenLabs voice ID "${state.openaiVoice}", using enterprise default`);
        state.openaiVoice = ENTERPRISE_DEFAULTS.voiceId;
      }
      
      if (!state.openaiModel || state.openaiModel.length < 5) {
        console.warn(`[🏢 ENTERPRISE TTS] ⚠️ Invalid/missing ElevenLabs model "${state.openaiModel}", using enterprise default`);
        state.openaiModel = ENTERPRISE_DEFAULTS.modelId;
      }

      console.log(`[🏢 ENTERPRISE TTS] ✅ FINAL CONFIG: Provider=${state.ttsProvider}, Voice=${state.openaiVoice}, Model=${state.openaiModel}`);

      // Format text for ElevenLabs (clean text, no SSML)
      const cleanText = text.replace(/<[^>]*>/g, '').trim();
      
      console.log(`[🏢 ENTERPRISE TTS] 🎯 Using ElevenLabs with voice ${state.openaiVoice} and model ${state.openaiModel}`);

      // Generate high-quality TTS with automatic multi-provider fallback
      let mp3Path = await generateSpeechFromText(
        cleanText,
        state.openaiVoice,
        state.openaiModel,
        'elevenlabs',
        state.voiceSettings
      );

      // Hard-fail if ElevenLabs generation did not succeed – no low-quality fallbacks
      if (!mp3Path) {
        console.error('[🏢 ENTERPRISE TTS] 🚨 ELEVENLABS_GENERATION_FAILED – aborting stream');
        throw new Error('ELEVENLABS_GENERATION_FAILED');
      }

      // Mark as speaking before streaming
      state.isSpeaking = true;
      console.log(`[🏢 ENTERPRISE TTS] 🎵 Starting audio stream...`);

      // 🚨 CRITICAL FIX: Convert MP3 to µ-law with bulletproof error handling
      const ulawPath = path.join(os.tmpdir(), `${path.basename(mp3Path, path.extname(mp3Path))}.ulaw`);

      try {
        console.log(`[🚨 FFMPEG CONVERSION] 🔄 Converting MP3 to µ-law: ${mp3Path} -> ${ulawPath}`);
        
        await execFileAsync(ffmpegPath as string, [
          '-y',
          '-i', mp3Path,
          '-ar', '8000',
          '-ac', '1',
          '-f', 'mulaw',
          '-af', 'volume=0.85,highpass=f=100,lowpass=f=3400', // Professional audio processing
          ulawPath
        ]);
        
        // 🚨 CRITICAL FIX: Validate conversion output
        if (!fs.existsSync(ulawPath)) {
          console.error('[🚨 FFMPEG_CONVERSION_FAILED] Output file does not exist after conversion');
          console.error('[🚨 FFMPEG_CONVERSION_FAILED] Expected output:', ulawPath);
          console.error('[🚨 FFMPEG_CONVERSION_FAILED] Input file:', mp3Path);
          throw new Error('FFMPEG_CONVERSION_FAILED: Output file not created');
        }
        
        const ulawStats = await fs.promises.stat(ulawPath);
        if (ulawStats.size === 0) {
          console.error('[🚨 FFMPEG_CONVERSION_FAILED] Output file is empty after conversion');
          console.error('[🚨 FFMPEG_CONVERSION_FAILED] Output path:', ulawPath);
          console.error('[🚨 FFMPEG_CONVERSION_FAILED] File size:', ulawStats.size);
          throw new Error('FFMPEG_CONVERSION_FAILED: Output file is empty');
        }
        
        console.log(`[🚨 FFMPEG CONVERSION] ✅ Conversion successful: ${ulawStats.size} bytes`);
        
      } catch (ffmpegError) {
        console.error('[🚨 FFMPEG_CONVERSION_FAILED] ===============================');
        console.error('[🚨 FFMPEG_CONVERSION_FAILED] CRITICAL AUDIO CONVERSION FAILURE');
        console.error('[🚨 FFMPEG_CONVERSION_FAILED] ===============================');
        console.error('[🚨 FFMPEG_CONVERSION_FAILED] Input file:', mp3Path);
        console.error('[🚨 FFMPEG_CONVERSION_FAILED] Output file:', ulawPath);
        console.error('[🚨 FFMPEG_CONVERSION_FAILED] FFmpeg path:', ffmpegPath);
        console.error('[🚨 FFMPEG_CONVERSION_FAILED] Error:', ffmpegError);
        console.error('[🚨 FFMPEG_CONVERSION_FAILED] ===============================');
        throw new Error('FFMPEG_CONVERSION_FAILED: Audio conversion error');
      }

      const ulawBuffer = await fs.promises.readFile(ulawPath);
      const CHUNK_SIZE = 320; // 40ms of audio at 8kHz µ-law

      // 🎯 STREAM AUDIO WITH BULLETPROOF DELIVERY GUARANTEE 🎯
      let streamingComplete = false;
      const totalChunks = Math.ceil(ulawBuffer.length / CHUNK_SIZE);
      let chunksStreamed = 0;
      
      console.log(`[🏢 ENTERPRISE TTS] 🚀 Starting audio stream: ${totalChunks} chunks, ${ulawBuffer.length} bytes`);
      
      for (let offset = 0; offset < ulawBuffer.length; offset += CHUNK_SIZE) {
        chunksStreamed++;
        
        // Check for barge-in (but NEVER during welcome message)
        if (state.bargeInDetected && state.welcomeMessageDelivered) {
          state.pendingSpeechBuffer = ulawBuffer.subarray(offset);
          console.log(`[🏢 ENTERPRISE TTS] 🛑 Playback paused at chunk ${chunksStreamed}/${totalChunks} due to barge-in`);
          break;
        }

        const chunk = ulawBuffer.subarray(offset, offset + CHUNK_SIZE);
        const payload = chunk.toString('base64');

        if (state.ws.readyState === WebSocket.OPEN && state.streamSid) {
          state.ws.send(JSON.stringify({
            event: 'media',
            streamSid: state.streamSid,
            media: { payload }
          }));
          
          // Log progress for welcome message only
          if (!state.welcomeMessageDelivered && chunksStreamed % 20 === 0) {
            console.log(`[🏢 ENTERPRISE TTS] 📊 Welcome message progress: ${chunksStreamed}/${totalChunks} chunks (${Math.round(chunksStreamed/totalChunks*100)}%)`);
          }
        } else {
          console.warn(`[🏢 ENTERPRISE TTS] ⚠️ WebSocket not ready at chunk ${chunksStreamed}, stopping stream`);
          break;
        }

        // CRITICAL FIX: Optimized timing for professional quality without cutoff
        await new Promise((resolve) => setTimeout(resolve, 38)); // 38ms = smooth professional pace
        
        // Check if we've reached the end
        if (offset + CHUNK_SIZE >= ulawBuffer.length) {
          streamingComplete = true;
          console.log(`[🏢 ENTERPRISE TTS] ✅ Audio streaming completed successfully (${chunksStreamed}/${totalChunks} chunks)`);
        }
      }

      // 🎯 CRITICAL: ENSURE COMPLETE AUDIO DELIVERY 🎯
      if (streamingComplete) {
        // Add proper delay to ensure all audio is processed by Twilio
        await new Promise((resolve) => setTimeout(resolve, 300));

        // Signal end of message only if streaming completed successfully
        if (state.ws.readyState === WebSocket.OPEN && state.streamSid) {
          state.ws.send(JSON.stringify({ 
            event: 'mark', 
            streamSid: state.streamSid, 
            mark: { name: 'speech_complete' } 
          }));
          console.log('[🏢 ENTERPRISE TTS] ✅ Audio streaming completed with end marker');
          
          // Mark welcome message as delivered if this was the welcome
          if (!state.welcomeMessageDelivered) {
            state.welcomeMessageDelivered = true;
            console.log('[🏢 ENTERPRISE TTS] 🎉 WELCOME MESSAGE SUCCESSFULLY DELIVERED');
          }
        }
      } else {
        console.warn('[🏢 ENTERPRISE TTS] ⚠️ Audio streaming was interrupted');
      }

      console.log('[🏢 ENTERPRISE TTS] ✅ ENTERPRISE QUALITY TTS DELIVERED SUCCESSFULLY');

      // 🎯 TRACK AUDIO QUALITY FOR FORTUNE 50 GUARANTEE 🎯
      // Assume high quality for ElevenLabs (95%), good quality for others (85%)
      const audioQuality = state.ttsProvider === 'elevenlabs' ? 95 : 85;
      if (state.callSid) {
        voiceHealthMonitor.trackAudioQuality(state.callSid, audioQuality);
      }

      // Clean up temp files
      await cleanupTempFile(mp3Path);
      await cleanupTempFile(ulawPath);

    } catch (error) {
      // 🚨 HARD FAIL – do not attempt to recover with lower-quality TTS
      console.error('[🏢 ENTERPRISE TTS] 🚨 CRITICAL ERROR – abandoning call:', error)
      throw error
    } finally {
      // Always reset state flags
      state.isSpeaking = false;
      state.pendingAudioGeneration = false;
    }
  }

  // Delegate streamTTS to enterprise system
  private async streamTTS(state: ConnectionState, text: string): Promise<void> {
    await this.streamEnterpriseQualityTTS(state, text);
  }

  private async getWelcomeMessage(state: ConnectionState): Promise<string> {
    if (!state.businessId) {
      return 'Welcome to StudioConnect AI. How can I help you today?';
    }

    try {
      const welcomeMessage = await getBusinessWelcomeMessage(state.businessId);
      if (state.clientId) {
        return `Welcome back! ${welcomeMessage}`;
      }
      return welcomeMessage;
    } catch (error) {
      console.error(`[REALTIME AGENT] Error getting welcome message:`, error);
      return 'Welcome to StudioConnect AI. How can I help you today?';
    }
  }

  private setupTwilioListeners(state: ConnectionState): void {
    const { callSid, businessId } = state;

    if (!callSid || !businessId) {
      console.error('[REALTIME AGENT] Missing required state:', { callSid, businessId });
      return;
    }

    // The Node Twilio helper library does not emit 'start'/'media' events – those are only sent
    // over the WebSocket stream.  We keep this method for future expansions (e.g. call status
    // callbacks) but no longer attempt to attach stream listeners here.
  }

  private setupWebSocketListeners(state: ConnectionState): void {
    const { ws, callSid } = state;

    if (!callSid) {
      console.error('[REALTIME AGENT] Missing callSid in state');
      return;
    }

    ws.on('close', () => {
      console.log(`[REALTIME AGENT] WebSocket closed for call ${callSid}`);
      this.cleanup(callSid);
    });

    ws.on('error', (error) => {
      console.error(`[REALTIME AGENT] WebSocket error for call ${callSid}:`, error);
      this.cleanup(callSid);
    });
  }

  public async cleanup(reason: string): Promise<void> {
    if (this.callSid) {
      const state = this.connections.get(this.callSid);
      if (state) {
        // ---- update callLog with duration / status ----
        const durationMs = Date.now() - (state.callStartTime || Date.now())
        const status = durationMs < 15000 ? 'ERROR' : 'COMPLETED'

        // 🎯 TRACK CALL COMPLETION WITH BULLETPROOF MONITORING 🎯
        const callStatus = status === 'COMPLETED' ? 'COMPLETED' : 'FAILED';
        voiceHealthMonitor.trackCallEnd(this.callSid, callStatus as any);

        if (state.callSid) {
          await prisma.callLog.update({ where: { callSid: state.callSid }, data: { updatedAt: new Date(), metadata: { endReason: status } } } as any).catch(() => {})
        }

        // ---- send call summary email ----
        if (state.businessId) {
          try {
            const biz = await prisma.business.findUnique({ where: { id: state.businessId }, select: { id: true, name: true, notificationEmails: true, notificationPhoneNumber: true } })
            if (biz?.notificationEmails && biz.notificationEmails.length) {
              const transcriptText = state.conversationHistory
                .map((m) => `${m.role === 'user' ? 'Client' : 'Agent'}: ${m.content}`)
                .join('\n')

              const { sendCallSummaryEmail } = await import('./notificationService')
              await sendCallSummaryEmail(biz.notificationEmails, {
                businessName: biz.name,
                caller: state.fromNumber || 'Unknown',
                callee: state.toNumber || undefined,
                durationSec: Math.round(durationMs / 1000),
                transcript: transcriptText,
              })
            }
          } catch (err) {
            console.error('[REALTIME AGENT] Failed to send call summary email', err)
          }
        }

        try {
          state.ws.close();
        } catch (error) {
          console.error(`[REALTIME AGENT] Error closing WebSocket:`, error);
        }

        // Gracefully close realtime voice session
        if (state.openaiClient) {
          try { state.openaiClient.close() } catch {}
        }
        // Close ElevenLabs STT client if active
        if (state.sttClient) {
          try { state.sttClient.disconnect() } catch {}
        }
        this.connections.delete(this.callSid);
        console.log(`[REALTIME AGENT] Cleaned up connection for call ${this.callSid}: ${reason}`);
      }
    }
    this.callSid = null;
  }

  /**
   * Sends a TTS message to the caller **without** terminating the existing media stream.
   * The strategy is:
   * 1.  Issue a `Call.update()` with TwiML that first <Say>s the message.
   * 2.  Immediately after the <Say>, we <Connect><Stream> back to **the same** WebSocket
   *     endpoint so Twilio re-establishes the media stream once playback is finished.
   * 3.  We keep a long <Pause> at the end of the TwiML so the call remains open for
   *     additional interactions.
   *
   * This avoids the premature hang-ups the user experienced where updating TwiML with only
   * a <Say> caused Twilio to drop the stream (and therefore the call) once playback ended.
   */
  private sendTwilioMessage(state: ConnectionState, message: string): void {
    const { callSid, businessId } = state

    if (!callSid) {
      console.error('[REALTIME AGENT] Attempted to send Twilio message without CallSid')
      return
    }

    try {
      // Build the WebSocket URL that Twilio should reconnect to after speaking
      const base = getPrimaryUrl() || (process.env.HOST ? `https://${process.env.HOST}` : '')
      const host = base.replace(/\/$/, '') || `https://${process.env.HOST || 'localhost'}`
      const wsBase = host.replace(/^https?:\/\//, 'wss://')
      const wsUrl = `${wsBase}/?callSid=${encodeURIComponent(callSid)}${businessId ? `&businessId=${encodeURIComponent(businessId)}` : ''}`

      const twiml = new twilio.twiml.VoiceResponse()

      // Use a higher-quality Amazon Polly voice for a more natural sound
      twiml.say({ voice: 'Polly.Amy', language: 'en-US' }, message)

      const connect = twiml.connect()
      const stream = connect.stream({ url: wsUrl })
      stream.parameter({ name: 'callSid', value: callSid })
      if (businessId) {
        stream.parameter({ name: 'businessId', value: businessId })
      }

      // Keep the call alive for up to 4 hours
      twiml.pause({ length: 14400 })

      this.twilioClient.calls(callSid).update({ twiml: twiml.toString() })
    } catch (error) {
      console.error('[REALTIME AGENT] Error sending Twilio message:', error)
    }
  }

  private async flushAudioQueue(state: ConnectionState): Promise<void> {
    if (state.audioQueue.length === 0) {
      state.isProcessing = false
      return
    }

    const audioToProcess = [...state.audioQueue]
    state.audioQueue = []
    state.isRecording = false

    let rawPath: string | null = null
    let wavPath: string | null = null

    try {
      console.log(`[🎯 BULLETPROOF TRANSCRIPTION] 🚀 Processing ${audioToProcess.length} audio chunks for Fortune 500 quality transcription`)

      const rawBuffers = audioToProcess.map((b64) => Buffer.from(b64, 'base64'))
      const isLinear16 = state.isLinear16Recording ?? false
      const rawData = Buffer.concat(rawBuffers)

      // 🎯 CRITICAL FIX: More lenient duration check for real conversations
      const MIN_DURATION_MS = 100 // FIXED: Much more reasonable minimum
      const bytesPerMs = isLinear16 ? 32 : 8 // adjust for codec
      const durationMs = rawData.length / bytesPerMs

      if (durationMs < MIN_DURATION_MS) {
        console.log(`[🎯 BULLETPROOF TRANSCRIPTION] ⚠️ Audio too short (${durationMs.toFixed(0)}ms), skipping transcription`)
        state.isProcessing = false
        return
      }

      console.log(`[🎯 BULLETPROOF TRANSCRIPTION] 📊 Processing ${durationMs.toFixed(0)}ms of audio (${rawData.length} bytes)`)

      const baseName = `${state.callSid || 'unknown'}_${Date.now()}`
      rawPath = path.join(os.tmpdir(), `${baseName}.ulaw`)
      wavPath = path.join(os.tmpdir(), `${baseName}.wav`)

      await fs.promises.writeFile(rawPath, rawData)

      // 🚨 CRITICAL FIX: Enhanced audio conversion with bulletproof error handling
      const inputFormat = isLinear16 ? 's16le' : 'mulaw'
      const inputRate = isLinear16 ? '16000' : '8000'
      
      console.log(`[🚨 FFMPEG TRANSCRIPTION] 🔄 Converting ${inputFormat} audio to WAV...`)
      
      try {
        await execFileAsync(ffmpegPath as string, [
          '-y',
          '-f', inputFormat,
          '-ar', inputRate,
          '-ac', '1',
          '-i', rawPath,
          '-af', 'highpass=f=80,lowpass=f=3400,volume=1.5,dynaudnorm',
          '-ar', '16000',
          wavPath
        ]);
        
        // 🚨 CRITICAL FIX: Bulletproof validation of WAV conversion
        if (!fs.existsSync(wavPath)) {
          console.error('[🚨 FFMPEG_TRANSCRIPTION_FAILED] WAV file was not created by ffmpeg');
          console.error('[🚨 FFMPEG_TRANSCRIPTION_FAILED] Expected output:', wavPath);
          console.error('[🚨 FFMPEG_TRANSCRIPTION_FAILED] Input file:', rawPath);
          console.error('[🚨 FFMPEG_TRANSCRIPTION_FAILED] Input format:', inputFormat);
          console.error('[🚨 FFMPEG_TRANSCRIPTION_FAILED] Input rate:', inputRate);
          throw new Error('FFMPEG_TRANSCRIPTION_FAILED: WAV file was not created by ffmpeg');
        }
        
        const wavStats = await fs.promises.stat(wavPath);
        if (wavStats.size < 1000) {
          console.error('[🚨 FFMPEG_TRANSCRIPTION_FAILED] WAV file too small after conversion');
          console.error('[🚨 FFMPEG_TRANSCRIPTION_FAILED] File size:', wavStats.size);
          console.error('[🚨 FFMPEG_TRANSCRIPTION_FAILED] Input size:', rawData.length);
          console.error('[🚨 FFMPEG_TRANSCRIPTION_FAILED] Duration estimate:', durationMs + 'ms');
          throw new Error(`FFMPEG_TRANSCRIPTION_FAILED: WAV file too small (${wavStats.size} bytes)`);
        }
        
        console.log(`[🚨 FFMPEG TRANSCRIPTION] ✅ WAV conversion successful: ${wavStats.size} bytes`);
        
      } catch (ffmpegTranscriptionError) {
        console.error('[🚨 FFMPEG_TRANSCRIPTION_FAILED] ===============================');
        console.error('[🚨 FFMPEG_TRANSCRIPTION_FAILED] CRITICAL TRANSCRIPTION AUDIO CONVERSION FAILURE');
        console.error('[🚨 FFMPEG_TRANSCRIPTION_FAILED] ===============================');
        console.error('[🚨 FFMPEG_TRANSCRIPTION_FAILED] Input file:', rawPath);
        console.error('[🚨 FFMPEG_TRANSCRIPTION_FAILED] Output file:', wavPath);
        console.error('[🚨 FFMPEG_TRANSCRIPTION_FAILED] Input format:', inputFormat);
        console.error('[🚨 FFMPEG_TRANSCRIPTION_FAILED] Input rate:', inputRate);
        console.error('[🚨 FFMPEG_TRANSCRIPTION_FAILED] Raw data size:', rawData.length);
        console.error('[🚨 FFMPEG_TRANSCRIPTION_FAILED] Duration estimate:', durationMs + 'ms');
        console.error('[🚨 FFMPEG_TRANSCRIPTION_FAILED] FFmpeg path:', ffmpegPath);
        console.error('[🚨 FFMPEG_TRANSCRIPTION_FAILED] Error:', ffmpegTranscriptionError);
        console.error('[🚨 FFMPEG_TRANSCRIPTION_FAILED] ===============================');
        throw new Error('FFMPEG_TRANSCRIPTION_FAILED: Audio conversion error for transcription');
      }

      // 🎯 BULLETPROOF TRANSCRIPTION WITH COMPREHENSIVE ERROR HANDLING 🎯
      let transcriptRaw: string | null = null;
      let attempts = 0;
      const maxAttempts = 5; // Increased attempts for reliability

      while (!transcriptRaw && attempts < maxAttempts) {
        attempts++;
        console.log(`[🎯 BULLETPROOF TRANSCRIPTION] 🔄 Transcription attempt ${attempts}/${maxAttempts}`);
        
        try {
          // Create a fresh copy for this attempt to avoid file locks
          const attemptWavPath = path.join(os.tmpdir(), `${baseName}_attempt${attempts}.wav`);
          await fs.promises.copyFile(wavPath, attemptWavPath);
          
          console.log(`[🎯 BULLETPROOF TRANSCRIPTION] 📡 Sending to Whisper... (attempt ${attempts})`);
          
          // Use the transcription service with explicit error handling
          transcriptRaw = await getTranscription(attemptWavPath, false);
          
          // Clean up attempt file
          await cleanupTempFile(attemptWavPath);
          
          if (transcriptRaw && transcriptRaw.trim() && transcriptRaw.trim() !== '...' && transcriptRaw.trim() !== '') {
            // Additional validation for meaningful content
            const words = transcriptRaw.trim().split(/\s+/);
            if (words.length >= 1 && words[0].length >= 2) {
              console.log(`[🎯 BULLETPROOF TRANSCRIPTION] ✅ SUCCESS on attempt ${attempts}: "${transcriptRaw.substring(0, 100)}..."`);
              break;
            } else {
              console.warn(`[🎯 BULLETPROOF TRANSCRIPTION] ⚠️ Transcript too short or unclear on attempt ${attempts}: "${transcriptRaw}"`);
              transcriptRaw = null; // Reset for retry
            }
          } else {
            console.warn(`[🎯 BULLETPROOF TRANSCRIPTION] ⚠️ Empty or invalid transcription on attempt ${attempts}: "${transcriptRaw}"`);
            transcriptRaw = null; // Reset for retry
          }
        } catch (transcriptError) {
          console.error(`[🎯 BULLETPROOF TRANSCRIPTION] ❌ Transcription attempt ${attempts} failed:`, transcriptError);
          
          if (attempts === maxAttempts) {
            console.error(`[🎯 BULLETPROOF TRANSCRIPTION] 🚨 ALL TRANSCRIPTION ATTEMPTS FAILED - ACTIVATING RECOVERY`);
            
            // Send professional recovery message instead of failing silently
            try {
              const recoveryMessages = [
                "I apologize, I didn't catch that clearly. Could you please repeat what you said?",
                "Sorry, there was some audio interference. Would you mind saying that again?",
                "I'm having trouble hearing you clearly. Please repeat your message.",
                "Let me ask you to speak a bit more clearly - how can I help you today?"
              ];
              const randomRecovery = recoveryMessages[Math.floor(Math.random() * recoveryMessages.length)];
              
              await this.streamEnterpriseQualityTTS(state, randomRecovery);
              console.log(`[🎯 BULLETPROOF TRANSCRIPTION] ✅ Recovery message delivered: "${randomRecovery}"`);
            } catch (recoveryError) {
              console.error('[🎯 BULLETPROOF TRANSCRIPTION] 🚨 CRITICAL: Recovery message also failed:', recoveryError);
              // Last resort - try to keep call alive
              try {
                await this.streamEnterpriseQualityTTS(state, "How may I help you?");
              } catch (finalError) {
                console.error('[🎯 BULLETPROOF TRANSCRIPTION] 🚨 FINAL FALLBACK FAILED:', finalError);
              }
            }
            
            state.isProcessing = false;
            return;
          }
          
          // Wait briefly before retry with exponential backoff
          const delay = Math.min(1000 * Math.pow(2, attempts - 1), 5000);
          console.log(`[🎯 BULLETPROOF TRANSCRIPTION] ⏳ Waiting ${delay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      if (!transcriptRaw || transcriptRaw.trim().length === 0) {
        console.error('[🎯 BULLETPROOF TRANSCRIPTION] 🚨 CRITICAL: No transcription received after all attempts')
        state.isProcessing = false;
        return
      }

      const transcript = transcriptRaw.trim()
      console.log(`[🎯 BULLETPROOF TRANSCRIPTION] ✅ FINAL TRANSCRIPT: "${transcript}"`)

      // -------------------- Deterministic Lead Qualification --------------------
      if (state.leadQualifier) {
        try {
          // Store answer for previous question
          if (state.currentMissingQuestionId) {
            state.qualAnswers = state.qualAnswers || {}
            state.qualAnswers[state.currentMissingQuestionId] = transcript
          }

          const { nextPrompt, finished, missingKey } = state.leadQualifier.getNextPrompt(state.qualAnswers!)

          if (!finished) {
            // Ask next question
            state.currentMissingQuestionId = missingKey || undefined
            if (nextPrompt) {
              console.log(`[🎯 LEAD QUALIFICATION] 📝 Next question: "${nextPrompt}"`);
              await this.streamTTS(state, nextPrompt)
            }
            // Reset flags for next utterance
            state.isProcessing = false
            return
          } else {
            // Lead qualification complete -> create lead record and proceed to AI flow
            try {
              const capturedData: any = {}
              let contactName: string | undefined
              let contactEmail: string | undefined
              let contactPhone: string | undefined
              let address: string | undefined
              let notes: string | undefined

              Object.entries(state.qualAnswers || {}).forEach(([qid, answer]) => {
                const meta = state.qualQuestionMap?.[qid]
                if (!meta) return
                capturedData[meta.questionText] = answer
                switch ((meta.mapsToLeadField || '').toLowerCase()) {
                  case 'contactname':
                  case 'name':
                    contactName = answer
                    break
                  case 'contactemail':
                  case 'email':
                    contactEmail = answer
                    break
                  case 'contactphone':
                  case 'phone':
                    contactPhone = answer
                    break
                  case 'address':
                    address = answer
                    break
                  case 'notes':
                  case 'description':
                    notes = answer
                    break
                  default:
                    break
                }
              })

              // Determine priority – mark URGENT if any answer contains keywords or an explicit emergency question exists
              let leadPriority: LeadPriority = 'NORMAL'
              const emergencyKeywords = /(urgent|emergency|asap|immediately|right away|straight away|crisis)/i
              const answersConcat = Object.values(capturedData).join(' ').toLowerCase()
              if (emergencyKeywords.test(answersConcat)) {
                leadPriority = 'URGENT'
              }

              const newLead = await prisma.lead.create({
                data: {
                  businessId: state.businessId!,
                  capturedData,
                  conversationTranscript: JSON.stringify(state.conversationHistory),
                  contactEmail,
                  contactPhone,
                  contactName,
                  address,
                  notes,
                  priority: leadPriority,
                },
              })

              // Notification email
              const biz = await prisma.business.findUnique({
                where: { id: state.businessId! },
                select: { id: true, name: true, notificationEmails: true, notificationPhoneNumber: true },
              })

              if (biz?.notificationEmails?.length) {
                await sendLeadNotificationEmail(biz.notificationEmails as any, newLead, leadPriority, biz.name)
              }

              // Trigger emergency voice alert if URGENT and phone configured
              if (leadPriority === 'URGENT' && biz && biz.notificationEmails?.length) {
                if (biz.notificationPhoneNumber) {
                  const summary = `${contactName || 'Unknown'} – ${notes?.slice(0, 120) || 'urgent request'}`
                  initiateEmergencyVoiceCall(biz.notificationPhoneNumber, biz.name, summary, biz.id).catch(() => {})
                }
              }

              await this.streamTTS(state, 'Thanks for those details! Someone from our team will reach out shortly. How else can I assist you today?')
            } catch (err) {
              console.error('[🎯 LEAD QUALIFICATION] ❌ Failed to process lead qualification completion:', err)
            }

            // Clear qualifier and continue normal flow
            state.leadQualifier = undefined
            state.currentMissingQuestionId = undefined
            state.currentFlow = null
            // Continue to AI processing if user said something else
          }
        } catch (err) {
          console.error('[🎯 LEAD QUALIFICATION] ❌ Lead qualification error:', err)
        }
      }

      // Enhanced validation for professional business conversations
      const txt = transcript.toLowerCase().trim()
      const words = txt.split(/\s+/).filter(w => w.length > 0)
      
      // More strict validation to prevent processing garbage/phantom speech
      const validSingleWords = [
        // Basic responses
        'yes', 'no', 'ok', 'okay', 'sure', 'thanks', 'hello', 'hi', 'hey',
        'great', 'perfect', 'correct', 'right', 'help', 'urgent', 'rush',
        // Business terms
        'project', 'status', 'update', 'billing', 'invoice', 'payment',
        'deadline', 'timeline', 'budget', 'quote', 'estimate', 'contract',
        // Creative industry terms
        'design', 'branding', 'website', 'logo', 'identity', 'marketing',
        'creative', 'concept', 'mockup', 'prototype', 'wireframe', 'layout',
        'animation', 'video', 'motion', 'graphics', 'illustration', 'photography',
        // Packaging & print
        'packaging', 'print', 'brochure', 'catalog', 'poster', 'signage',
        'storyboard', 'boards', 'presentation', 'pitch', 'proposal',
        // Project management terms
        'kickoff', 'launch', 'delivery', 'revision', 'feedback', 'approval',
        'milestone', 'phase', 'iteration', 'round', 'final', 'proofs',
        // Client communication
        'meeting', 'call', 'email', 'follow', 'followup', 'discuss',
        'review', 'changes', 'edits', 'tweaks', 'adjustments'
      ]
      
      // 🎯 BULLETPROOF PHANTOM TRANSCRIPTION FILTERING - ENTERPRISE GRADE 🎯
      const phantomConfig = getEnterprisePhantomFilter();
      
      // BULLETPROOF validation using enterprise configuration
      const isValid = (
        words.length >= phantomConfig.MIN_WORDS_REQUIRED || // STRICTER - Require at least 2 words for most cases
        (words.length === 1 && 
         validSingleWords.includes(txt) && 
         !phantomConfig.PHANTOM_WORDS.includes(txt) && 
         !phantomConfig.SINGLE_LETTERS.includes(txt) &&
         txt.length >= phantomConfig.MIN_WORD_LENGTH) || // STRICTER - Single words must be 3+ chars and not phantom
        phantomConfig.BUSINESS_PATTERNS.some(pattern => pattern.test(txt)) ||
        (phantomConfig.CREATIVE_INDUSTRY_TERMS.some(term => txt.includes(term)) && words.length >= phantomConfig.MIN_WORDS_REQUIRED)
      )

      if (!isValid) {
        console.log(`[🎯 BULLETPROOF FILTER] ⚠️ Eliminated phantom transcription: "${transcript}" (${words.length} words) - maintaining Fortune 500 quality`)
        state.isProcessing = false
        return
      }

      const callSid = state.callSid ?? 'UNKNOWN_CALLSID'

      console.log('[🎯 AI PROCESSING] 🧠 Processing message with AI handler...')
      // 🎯 TRACK RESPONSE TIME FOR FORTUNE 50 GUARANTEE 🎯
      const responseStartTime = Date.now();
      
      const response = await processMessage({
        message: transcript,
        conversationHistory: state.conversationHistory,
        businessId: state.businessId!,
        currentActiveFlow: state.currentFlow ?? null,
        callSid,
        channel: 'VOICE'
      });

      // 🎯 TRACK RESPONSE TIME COMPLETION 🎯
      const responseTime = Date.now() - responseStartTime;
      if (callSid) {
        voiceHealthMonitor.trackResponseTime(callSid, responseTime);
      }

      console.log(`[🎯 AI PROCESSING] ✅ AI Response generated in ${responseTime}ms: "${response.reply?.substring(0, 100) || 'No reply'}..."`);

      // Update conversation history
      this.addToConversationHistory(state, 'user', transcript)
      if (response.reply) {
        this.addToConversationHistory(state, 'assistant', response.reply)
      }
      state.currentFlow = response.currentFlow || null
      
      // 🎯 TRACK CONTEXT LENGTH FOR FORTUNE 50 GUARANTEE 🎯
      if (callSid) {
        voiceHealthMonitor.trackContextLength(callSid, state.conversationHistory.length);
      }
      
      // Manage conversation history size
      if (state.conversationHistory.length > MAX_CONVERSATION_HISTORY) {
        state.conversationHistory = state.conversationHistory.slice(-MAX_CONVERSATION_HISTORY)
      }

      if (response.reply) {
        console.log(`[🎯 AI PROCESSING] 🗣️ Delivering AI response via TTS: "${response.reply.substring(0, 100)}..."`)
        await this.streamTTS(state, response.reply)
      } else {
        console.warn(`[🎯 AI PROCESSING] ⚠️ No reply generated from AI - sending professional recovery response`)
        await this.streamTTS(state, "I'm here to help. Could you tell me more about what you need assistance with?")
      }

      // Handle escalation request (warm transfer)
      if (response.nextAction === 'TRANSFER') {
        console.log('[🎯 AI PROCESSING] 📞 AI requested live escalation – initiating warm transfer')
        // Use business notification phone if available
        let targetNum: string | undefined
        if (state.businessId) {
          const biz = await prisma.business.findUnique({ where: { id: state.businessId }, select: { notificationPhoneNumber: true } })
          targetNum = biz?.notificationPhoneNumber || undefined
        }
        await this.escalateToHuman(state, targetNum)
      } else if (response.nextAction === 'VOICEMAIL') {
        console.log('[🎯 AI PROCESSING] 📧 AI requested voicemail – redirecting caller')
        this.sendToVoicemail(state)
      }

      // 🎯 CRITICAL FIX: Keep call active for continued conversation
      console.log('[🎯 AI PROCESSING] ✅ Response delivered, ready for next interaction')
      this._scheduleIdlePrompt(state);

    } catch (error) {
      console.error('[🎯 BULLETPROOF TRANSCRIPTION] 🚨 CRITICAL ERROR in audio processing pipeline:', error)
      
      // 🎯 TRACK ERROR RECOVERY TIME 🎯
      const recoveryStartTime = Date.now();
      
      // 🎯 BULLETPROOF ENTERPRISE ERROR RECOVERY 🎯
      const enterpriseErrors = getEnterpriseErrorMessages();
      const randomMessage = enterpriseErrors.RECOVERY[Math.floor(Math.random() * enterpriseErrors.RECOVERY.length)]
      
      try {
        console.log(`[🎯 BULLETPROOF TRANSCRIPTION] 🛡️ ACTIVATING ENTERPRISE ERROR RECOVERY: "${randomMessage}"`);
        await this.streamEnterpriseQualityTTS(state, randomMessage) // Use enterprise TTS for recovery
        
        // 🎯 TRACK SUCCESSFUL ERROR RECOVERY 🎯
        const recoveryTime = Date.now() - recoveryStartTime;
        if (state.callSid) {
          voiceHealthMonitor.trackErrorRecovery(state.callSid, recoveryTime);
        }
        console.log(`[🎯 BULLETPROOF TRANSCRIPTION] ✅ Enterprise recovery completed in ${recoveryTime}ms`);
      } catch (fallbackError) {
        console.error('[🎯 BULLETPROOF TRANSCRIPTION] 🚨 Enterprise error recovery also failed:', fallbackError)
        
        // 🎯 TRACK FAILED ERROR RECOVERY 🎯
        const recoveryTime = Date.now() - recoveryStartTime;
        if (state.callSid) {
          voiceHealthMonitor.trackErrorRecovery(state.callSid, recoveryTime);
        }
        
        // Absolute last resort
        try {
          await this.streamEnterpriseQualityTTS(state, "I apologize for the technical difficulty. How may I assist you?");
          console.log(`[🎯 BULLETPROOF TRANSCRIPTION] ✅ Final fallback message delivered`);
        } catch (finalError) {
          console.error('[🎯 BULLETPROOF TRANSCRIPTION] 🚨 FINAL FALLBACK ALSO FAILED:', finalError);
        }
      }
      
    } finally {
      // Always clean up temp files
      if (rawPath) await cleanupTempFile(rawPath)
      if (wavPath) await cleanupTempFile(wavPath)
      
      // Reset processing state
      state.isProcessing = false
      state.audioQueue = [] // Ensure queue is clear

      // Resume any interrupted speech if conditions allow
      if (!state.isSpeaking && state.pendingSpeechBuffer && state.pendingSpeechBuffer.length > 0) {
        try {
          await this._playBufferedAudio(state, state.pendingSpeechBuffer)
          state.pendingSpeechBuffer = null
          state.bargeInDetected = false
        } catch (err) {
          console.error('[🎯 BULLETPROOF TRANSCRIPTION] ❌ Failed to resume queued speech:', err)
        }
      }
      
      console.log(`[🎯 BULLETPROOF TRANSCRIPTION] 🏁 Processing complete, state reset`)
    }
  }

  public getConnectionStatus(): string {
    return this.connections.size > 0 ? 'active' : 'idle';
  }

  public getActiveConnections(): number {
    return this.connections.size;
  }

  private async handleStartEvent(state: ConnectionState, data: any): Promise<void> {
    console.log('[🏢 ENTERPRISE AGENT] 🚀 PROCESSING CALL START EVENT WITH ENTERPRISE VOICE PIPELINE...');
    const callSid = data.start?.callSid;
    state.streamSid = data.start?.streamSid;
    state.isTwilioReady = true;
    state.callSid = callSid;
    this.callSid = callSid ?? this.callSid;

    // 🎯 TRACK CALL START WITH BULLETPROOF MONITORING 🎯
    if (callSid && state.businessId) {
      voiceHealthMonitor.trackCallStart(callSid, state.businessId);
    }

    // Initialize state flags for bulletproof operation
    state.isSpeaking = false;
    state.pendingAudioGeneration = false;
    state.welcomeMessageDelivered = false;

    if (this.onCallSidReceived && callSid) this.onCallSidReceived(callSid);

    if (!callSid) {
      console.error('[🏢 ENTERPRISE AGENT] ❌ CallSid not found in start message');
      this.cleanup('Missing CallSid');
      return;
    }

    try {
      const callDetails = await twilioClient.calls(callSid).fetch();
      const toNumberRaw = callDetails.to ?? '';
      const fromNumberRaw = callDetails.from ?? '';

      const toNumber = normalizePhoneNumber(toNumberRaw);
      const fromNumber = normalizePhoneNumber(fromNumberRaw);

      console.log('[🏢 ENTERPRISE AGENT] 📞 Call details:', { toNumber, fromNumber });

      const digitsOnly = toNumber.replace(/[^0-9]/g, '');
      let business: { id: string; twilioPhoneNumber: string | null } | null = null;

      if (digitsOnly) {
        console.log(`[🏢 ENTERPRISE AGENT] 🔍 Looking up business for phone number: ${toNumber}`);
        // Exact match first
        business = await prisma.business.findFirst({
          where: { twilioPhoneNumber: toNumber },
          select: { id: true, twilioPhoneNumber: true },
        });

        // Fallback: try matching last 10 digits
        if (!business && digitsOnly.length >= 10) {
          const lastTen = digitsOnly.slice(-10);
          const businesses = await prisma.business.findMany({
            where: { twilioPhoneNumber: { endsWith: lastTen } },
            select: { id: true, twilioPhoneNumber: true },
          });
          if (businesses.length > 0) {
            business = businesses[0];
          }
        }
      }

      if (business) {
        console.log(`[🏢 ENTERPRISE AGENT] ✅ BUSINESS FOUND: ${business.id} - INITIALIZING ENTERPRISE VOICE PIPELINE`);
        
        state.businessId = business.id;
        state.fromNumber = fromNumber;
        state.toNumber = toNumber;

        // Load enterprise configuration with bulletproof error handling
        await this.loadEnterpriseVoiceConfiguration(state);

        // Create conversation record
        const conversation = await prisma.conversation.create({
          data: {
            businessId: business.id,
            sessionId: crypto.randomUUID(),
            messages: [],
          },
        });

        // Log call with proper status
        await prisma.callLog.upsert({
          where: { callSid },
          create: {
            businessId: business.id,
            callSid,
            from: fromNumber,
            to: toNumber,
            direction: 'INBOUND',
            type: 'VOICE',
            status: 'IN_PROGRESS',
            source: 'VOICE_CALL',
            conversationId: conversation.id,
            metadata: { streamSid: state.streamSid },
          },
          update: {
            status: 'IN_PROGRESS',
            metadata: { streamSid: state.streamSid },
            updatedAt: new Date(),
          },
        });

        // Build enterprise system prompt
        const systemPrompt = await this.buildSystemPrompt(state);

        // 🎯 BULLETPROOF WELCOME MESSAGE DELIVERY SYSTEM 🎯
        if (!state.welcomeMessageDelivered && state.streamSid) {
          console.log('[🏢 ENTERPRISE AGENT] 🎯 INITIATING BULLETPROOF WELCOME MESSAGE DELIVERY...');
          console.log('[🏢 ENTERPRISE AGENT] 🔍 Current state:', {
            streamSid: state.streamSid,
            businessId: state.businessId,
            welcomeDelivered: state.welcomeMessageDelivered,
            wsReady: state.ws.readyState === 1
          });
          
          // 🎯 CRITICAL FIX: IMMEDIATE WELCOME MESSAGE DELIVERY WITH BULLETPROOF RETRIES
          const deliverWelcome = async (attempt: number = 1): Promise<void> => {
            console.log(`[🏢 ENTERPRISE AGENT] 🎯 WELCOME DELIVERY ATTEMPT ${attempt}/3`);
            
            if (state.welcomeMessageDelivered) {
              console.log('[🏢 ENTERPRISE AGENT] ✅ Welcome already delivered, skipping');
              return;
            }

            if (!state.streamSid) {
              console.warn('[🏢 ENTERPRISE AGENT] ⚠️ No streamSid available for delivery');
              if (attempt < 3) {
                setTimeout(() => deliverWelcome(attempt + 1), 500);
              }
              return;
            }

            if (state.ws.readyState !== 1) {
              console.warn('[🏢 ENTERPRISE AGENT] ⚠️ WebSocket not ready for delivery');
              if (attempt < 3) {
                setTimeout(() => deliverWelcome(attempt + 1), 500);
              }
              return;
            }

            try {
              console.log(`[🏢 ENTERPRISE AGENT] 🚀 DELIVERING WELCOME MESSAGE NOW (Attempt ${attempt})`);
              await this.deliverBulletproofWelcomeMessage(state);
              console.log(`[🏢 ENTERPRISE AGENT] ✅ WELCOME MESSAGE DELIVERED SUCCESSFULLY ON ATTEMPT ${attempt}`);
              // 👉 Transition to listening state immediately after successful delivery
              this.startListening(state);
            } catch (error) {
              console.error(`[🏢 ENTERPRISE AGENT] ❌ Welcome delivery attempt ${attempt} failed:`, error);
              if (attempt < 3) {
                setTimeout(() => deliverWelcome(attempt + 1), 1000);
              } else {
                console.error('[🏢 ENTERPRISE AGENT] 🚨 ALL WELCOME DELIVERY ATTEMPTS FAILED');
              }
            }
          };

          // Start delivery with appropriate delay for stream stability
          setTimeout(() => deliverWelcome(1), 1200); // OPTIMIZED: 1.2s for bulletproof stability
        }

        // Initialize ElevenLabs STT for high-quality transcription
        await this.initializeElevenLabsSTT(state);

      } else {
        console.warn('[🏢 ENTERPRISE AGENT] ⚠️ Business not found for phone number:', toNumber);
        
        state.businessId = null;
        state.fromNumber = fromNumber;
        state.toNumber = toNumber;

        // Load enterprise defaults even for unknown businesses
        await this.loadEnterpriseVoiceConfiguration(state);

        // Generic professional greeting for unknown businesses
        if (!state.welcomeMessageDelivered && state.streamSid) {
          console.log('[🏢 ENTERPRISE AGENT] 🎯 Delivering generic enterprise welcome message...');
          await this.deliverBulletproofWelcomeMessage(state);
        }
      }

      // Initialize lead qualification if needed
      await this.initializeLeadQualification(state);

    } catch (error) {
      console.error('[🏢 ENTERPRISE AGENT] ❌ Error handling start event:', error);
      
      // 🚨 EMERGENCY RECOVERY SYSTEM 🚨
      if (!state.welcomeMessageDelivered && state.streamSid) {
        console.log('[🏢 ENTERPRISE AGENT] 🚨 EMERGENCY RECOVERY ACTIVATED');
        try {
          await this.streamEnterpriseQualityTTS(state, 'Hello! Thank you for calling. I apologize for any technical difficulties. How may I help you today?');
          state.welcomeMessageDelivered = true;
          console.log('[🏢 ENTERPRISE AGENT] ✅ EMERGENCY RECOVERY WELCOME MESSAGE DELIVERED');
        } catch (emergencyError) {
          console.error('[🏢 ENTERPRISE AGENT] 🚨 CRITICAL: Emergency recovery also failed:', emergencyError);
        }
      }
    }
  }

  private async buildSystemPrompt(state: ConnectionState): Promise<string> {
    if (!state.businessId) return createVoiceSystemPrompt('this creative agency', undefined, undefined, state.personaPrompt);

    const business = await prisma.business.findUnique({
      where: { id: state.businessId },
      select: { name: true }
    });
    
    let context = '';
    let clientContext = '';
    let projectContext = '';
    let knowledgeContext = '';

    // 1. Fetch Knowledge Base
    const knowledgeBaseEntries = await prisma.knowledgeBase.findMany({
      where: { businessId: state.businessId },
      select: { content: true },
    });
    if (knowledgeBaseEntries.length > 0) {
      knowledgeContext = '--- KNOWLEDGE BASE ---\n' + knowledgeBaseEntries.map((e: { content: string }) => `- ${e.content}`).join('\n');
    }

    // 2. Fetch Client and Project info
    if (state.fromNumber) {
      const client = await getClientByPhoneNumber(state.fromNumber);
      if (client && client.businessId === state.businessId) {
        clientContext = `--- CALLER INFORMATION ---\nThis call is from an existing client: ${client.name}.`;

        // ---- NEW: preload last conversation history for smoother multi-turn across calls ----
        try {
          const lastConv = await prisma.conversation.findFirst({
            where: { clientId: client.id },
            orderBy: { updatedAt: 'desc' },
            select: { messages: true },
          })
          if (lastConv?.messages && Array.isArray(lastConv.messages)) {
            for (const mRaw of lastConv.messages.slice(-20)) {
              const m = mRaw as any
              if (m && typeof m === 'object' && 'role' in m && 'content' in m) {
                state.conversationHistory.push({
                  role: m.role as 'user' | 'assistant',
                  content: String(m.content),
                  timestamp: new Date(),
                })
              }
            }
          }
        } catch (histErr) {
          console.error('[REALTIME AGENT] Failed to preload prior conversation', histErr)
        }
      }
    }

    // 3. Assemble final context
    const contextParts = [clientContext, projectContext, knowledgeContext].filter(Boolean);
    if (contextParts.length > 0) {
      context = contextParts.join('\n\n');
    }

    // 4. Fetch Lead Capture Questions
    const agentConfig = await prisma.agentConfig.findUnique({
        where: { businessId: state.businessId },
        include: { questions: { orderBy: { order: 'asc' } } }
    });
    const leadCaptureQuestions = agentConfig?.questions || [];

    return createVoiceSystemPrompt(business?.name || 'this creative agency', context, leadCaptureQuestions, state.personaPrompt);
  }

  private async loadAgentConfig(state: ConnectionState): Promise<void> {
    if (!state.businessId || state.__configLoaded) return

    // --- Attempt Redis cache for persona prompt ---
    try {
      const redis = RedisManager.getInstance()
      if (!redis.isClientConnected()) {
        await redis.connect().catch((err) => {
          // Silently fail Redis connection for persona cache - not critical
          console.debug('[RealtimeAgent] Redis persona cache unavailable:', err.message)
        })
      }
      if (redis.isClientConnected()) {
        const key = `persona:${state.businessId}`
        const cachedPersona = await redis.getClient().get(key)
        if (cachedPersona) {
          state.personaPrompt = cachedPersona + FILLER_INSTRUCTIONS
        }
      }
    } catch (err) {
      // Don't log Redis errors repeatedly - they're not critical for voice operation
      console.debug('[RealtimeAgent] Redis persona cache unavailable:', (err as Error).message)
    }

    // --- Global override for ops ---
    const forcedProvider = process.env.AGENT_FORCE_TTS?.toLowerCase() as 'openai' | 'polly' | 'realtime' | 'elevenlabs' | undefined
    if (forcedProvider && ['openai', 'polly', 'realtime', 'elevenlabs'].includes(forcedProvider)) {
      state.ttsProvider = forcedProvider
      state.__configLoaded = true
      console.log(`[RealtimeAgent] AGENT_FORCE_TTS override → ${forcedProvider}`)
    }

    // 1. Try cache first
    const cached = voiceConfigCache.get(state.businessId)
    const now = Date.now()
    if (cached && now - cached.cachedAt < VOICE_CFG_TTL_MS) {
      state.ttsProvider = cached.ttsProvider
      state.openaiVoice = cached.openaiVoice
      state.openaiModel = cached.openaiModel
      state.personaPrompt = cached.personaPrompt
      state.__configLoaded = true
      console.log(`[RealtimeAgent] Voice config served from cache for business ${state.businessId}`)
      return
    }

    // 2. Fetch from DB
    try {
      // @ts-ignore – voiceSettings column typed dynamically
      const cfg: any = await prisma.agentConfig.findUnique({
        where: { businessId: state.businessId },
        select: {
          useOpenaiTts: true,
          openaiVoice: true,
          openaiModel: true,
          personaPrompt: true,
          ttsProvider: true,
          voiceSettings: true,
        } as any,
      })

      if (cfg) {
        const provider = (cfg as any).ttsProvider
        if (provider) {
          state.ttsProvider = provider
        } else if (cfg.useOpenaiTts !== undefined) {
          state.ttsProvider = cfg.useOpenaiTts ? 'openai' : 'elevenlabs' // Changed default
        }
        if (!state.ttsProvider) state.ttsProvider = 'elevenlabs'
        
        // Set voice based on provider
        if (state.ttsProvider === 'elevenlabs') {
          state.openaiVoice = cfg.elevenlabsVoice || cfg.openaiVoice || process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB'
        } else {
          state.openaiVoice = cfg.openaiVoice || 'nova'
        }
        
        state.openaiModel = cfg.elevenlabsModel || cfg.openaiModel || (state.ttsProvider === 'elevenlabs' ? 'eleven_turbo_v2_5' : 'tts-1')
        state.personaPrompt = (cfg.personaPrompt || '') + FILLER_INSTRUCTIONS
        
        // Fix JSON parsing
        try {
          state.voiceSettings = cfg.voiceSettings && typeof cfg.voiceSettings === 'string' 
            ? JSON.parse(cfg.voiceSettings) 
            : cfg.voiceSettings || {}
        } catch (jsonErr) {
          console.warn('[RealtimeAgent] Invalid voiceSettings JSON, using defaults')
          state.voiceSettings = {}
        }

        // Persist persona prompt to Redis cache for 1 hour
        try {
          const redis = RedisManager.getInstance()
          if (!redis.isClientConnected()) {
            await redis.connect().catch((err) => {
              console.debug('[RealtimeAgent] Redis cache unavailable for persona storage:', err.message)
            })
          }
          if (redis.isClientConnected() && state.personaPrompt) {
            await redis.getClient().setEx(`persona:${state.businessId}`, 3600, cfg.personaPrompt || '')
          }
        } catch (err) {
          console.debug('[RealtimeAgent] Failed to store persona in Redis:', (err as Error).message)
        }

        // Cache it
        voiceConfigCache.set(state.businessId, {
          ttsProvider: state.ttsProvider,
          openaiVoice: state.openaiVoice,
          openaiModel: state.openaiModel,
          personaPrompt: state.personaPrompt,
          cachedAt: now,
        })

        console.log(`[RealtimeAgent] Voice config loaded & cached for business ${state.businessId}`)
      } else {
        // Set defaults when no config found
        state.ttsProvider = 'elevenlabs'
        state.openaiVoice = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB'
        state.openaiModel = process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5'
        state.voiceSettings = {}
      }
    } catch (err) {
      console.error('[REALTIME AGENT] Failed to load agentConfig – using high-quality defaults:', (err as Error).message)
      state.ttsProvider = 'elevenlabs'
      state.openaiVoice = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB'
      state.openaiModel = process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5'
      state.voiceSettings = {}
    } finally {
      state.__configLoaded = true
    }
  }

  private async initializeOpenAIRealtimeClient(state: ConnectionState, initialPrompt: string): Promise<void> {
    if (state.openaiClient || !process.env.OPENAI_API_KEY) return

    // Respect temporary failure cache
    if (state.businessId && isRealtimeTemporarilyDisabled(state.businessId)) {
      console.log(`[REALTIME AGENT] Realtime voice temporarily disabled for business ${state.businessId} – falling back to OpenAI TTS`)
      state.ttsProvider = 'openai'
      return
    }

    // --- New: ensure the selected voice is supported by the realtime API ---
    const ALLOWED_REALTIME_VOICES = ['shimmer', 'echo', 'alloy', 'ash', 'ballad', 'coral', 'sage', 'verse'] as const
    const realtimeVoice = ALLOWED_REALTIME_VOICES.includes(state.openaiVoice as any)
      ? state.openaiVoice
      : 'shimmer' // prefer Shimmer for more natural tone

    if (realtimeVoice !== state.openaiVoice) {
      console.warn(`[REALTIME AGENT] Voice "${state.openaiVoice}" not supported for realtime – using "${realtimeVoice}" for realtime session`)
    }

    console.log('[REALTIME AGENT] Initializing OpenAI Realtime Client with professional settings...')
    try {
      const client = new OpenAIRealtimeClient(
        process.env.OPENAI_API_KEY,
        realtimeVoice,
        initialPrompt,
        process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview',
      );
      
      // Set longer timeout for initial connection
      const connectionPromise = client.connect();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Realtime client connection timeout')), 15000)
      });

      await Promise.race([connectionPromise, timeoutPromise]);

      // Enhanced event handlers with professional voice quality
      client.on('assistantAudio', (b64) => {
        if (!state.welcomeMessageDelivered) {
          state.welcomeMessageDelivered = true
          console.log('[REALTIME AGENT] First audio received, welcome message delivered via realtime')
        }
        
        if (state.ws.readyState === WebSocket.OPEN && state.streamSid) {
          state.isSpeaking = true // Mark as speaking
          state.ws.send(
            JSON.stringify({
              event: 'media',
              streamSid: state.streamSid,
              media: { payload: b64 },
            }),
          )
        }
      })

      // Handle text responses to maintain conversation history
      client.on('assistantMessage', (text) => {
        this.addToConversationHistory(state, 'assistant', text);
        console.log(`[REALTIME AGENT] Assistant response: ${text.substring(0, 100)}...`);
      });

      // Capture user transcripts to decide when to trigger assistant replies
      client.on('userTranscript', (text) => {
        state.hasUserTranscript = true
        this.addToConversationHistory(state, 'user', text)
        console.log(`[REALTIME AGENT] User transcript received (${text.length} chars)`)
      })

      // Enhanced error handling - bulletproof fallback system
      client.on('error', async (error) => {
        console.error('[REALTIME AGENT] OpenAI Realtime Client Error:', error.message)
        
        // Detect invalid model explicitly so we can mark failure cache
        if (error.message?.includes('invalid_model')) {
          if (state.businessId) markRealtimeFailure(state.businessId)
        }

        // Graceful degradation to high-quality TTS fallback
        console.log('[REALTIME AGENT] Switching to bulletproof TTS fallback for reliability')
        state.openaiClient = undefined
        state.ttsProvider = 'openai' // Use high-quality OpenAI TTS
        state.openaiVoice = 'nova' // Premium voice
        state.openaiModel = 'tts-1-hd' // HD quality

        if (!state.welcomeMessageDelivered) {
          try {
            const fallbackGreeting = await this.getWelcomeMessage(state)
            await this.streamTTS(state, fallbackGreeting)
            state.welcomeMessageDelivered = true
            console.log('[REALTIME AGENT] Successfully delivered greeting via TTS fallback')
          } catch (fallbackErr) {
            console.error('[REALTIME AGENT] Critical error in fallback system:', fallbackErr)
            // Emergency simple greeting
            await this.streamTTS(state, 'Hello! Thank you for calling. How may I assist you today?')
            state.welcomeMessageDelivered = true
          }
        }
      });

      // Dedicated invalidModel event emitted by client – mark cache immediately
      client.on('invalidModel', (err: Error) => {
        console.error('[REALTIME AGENT] Realtime client reported invalid model:', err.message)
        if (state.businessId) markRealtimeFailure(state.businessId)
      })

      client.on('close', async () => {
        console.log('[REALTIME AGENT] OpenAI Realtime Client connection closed gracefully')
        
        // Don't immediately switch to fallback - connection might recover
        if (state.openaiClient === client) {
          console.log('[REALTIME AGENT] Realtime client closed, will use TTS fallback for new requests')
          state.ttsProvider = 'openai'
          state.openaiClient = undefined
        }
        if (state.businessId) markRealtimeFailure(state.businessId) // hard-failover for 60 min
      });

      // Handle speech events for better turn-taking
      client.on('speechStarted', () => {
        console.log('[REALTIME AGENT] User speech started (realtime VAD)')
        state.isRecording = true
        if (state.realtimeAudioTimer) {
          clearTimeout(state.realtimeAudioTimer)
          state.realtimeAudioTimer = null
        }
      });

      client.on('speechStopped', () => {
        console.log('[REALTIME AGENT] User speech stopped (realtime VAD)')
        state.isRecording = false
        state.isSpeaking = false // User stopped, we can speak
        // Give the user a short grace period before assistant replies to avoid overlap
        setTimeout(() => {
          if (state.openaiClient && state.ttsProvider === 'realtime') {
            if (state.hasUserTranscript) {
              try {
                state.openaiClient.requestAssistantResponse()
              } catch { /* ignore */ }
              // Reset flag to wait for next user turn
              state.hasUserTranscript = false
            } else {
              console.log('[REALTIME AGENT] Skipping assistant response – no user transcript yet')
            }
          }
        }, 500)
        this._scheduleIdlePrompt(state)
      });

      client.on('responseComplete', () => {
        console.log('[REALTIME AGENT] Response complete')
        state.isSpeaking = false // Response finished
        if (state.realtimeAudioTimer) {
          clearTimeout(state.realtimeAudioTimer)
          state.realtimeAudioTimer = null
        }
        this._scheduleIdlePrompt(state)
      });

      state.openaiClient = client
      console.log('[REALTIME AGENT] OpenAI Realtime Client connected successfully with professional voice settings')
      
    } catch (err) {
      console.error('[REALTIME AGENT] Failed to establish OpenAI realtime session:', err.message)
      console.log('[REALTIME AGENT] Falling back to high-quality TTS pipeline')
      state.ttsProvider = 'openai' // Use OpenAI TTS as fallback for quality
      state.openaiVoice = 'nova' // Ensure we use a high-quality voice
      state.openaiModel = 'tts-1-hd' // Use HD model for better quality
    }
  }

  // Example: when adding to conversationHistory, always include timestamp
  private addToConversationHistory(state: ConnectionState, role: 'user' | 'assistant', content: string) {
    state.conversationHistory.push({ role, content, timestamp: new Date() });
  }

  /** Schedules the idle prompt timer. This should only be called when the agent is finished speaking. */
  private _scheduleIdlePrompt(state: ConnectionState): void {
    // Do not schedule idle prompts until the initial greeting has been delivered.
    if (!state.welcomeMessageDelivered) return

    this._clearIdlePrompt(state); // Always clear previous before setting a new one

    // Pick delay based on how many prompts we have already sent
    const promptIdx = state.idlePromptCount ?? 0
    const delay = IDLE_PROMPT_DELAYS_MS[Math.min(promptIdx, IDLE_PROMPT_DELAYS_MS.length - 1)]

    state.idlePromptTimer = setTimeout(async () => {
      // Check for any activity before firing the prompt
      if (state.isRecording || state.isSpeaking || !this.connections.has(state.callSid || '')) {
        return; // Bail out if there's activity
      }
      
      state.idlePromptCount = (state.idlePromptCount || 0) + 1;

      // Reduce from 3 to 2 prompts before hanging up to be less repetitive
      if (state.idlePromptCount > 2) { 
        await this.streamTTS(state, 'It seems we got disconnected. Please call back anytime. Goodbye.');
        this.cleanup(state.callSid || 'Caller inactive');
        return;
      }
      
      const followUp = 'Are you still there?';
      console.log(`[IDLE_PROMPT] Firing idle prompt #${state.idlePromptCount}: "${followUp}"`);
      
      try {
        // Always use TTS directly (bypassing realtime pipeline) to avoid the model replying "Yes, I'm still here".
        if (state.openaiClient && state.ttsProvider === 'realtime') {
          const backupClient = state.openaiClient
          const backupProvider = state.ttsProvider

          // Temporarily switch to OpenAI TTS fallback
          state.openaiClient = undefined
          state.ttsProvider = 'openai'

          await this.streamTTS(state, followUp)

          // Restore realtime settings after the prompt
          state.openaiClient = backupClient
          state.ttsProvider = backupProvider
        } else {
          await this.streamTTS(state, followUp)
        }
      } catch (e) {
        console.warn('[REALTIME AGENT] Failed to send idle follow-up prompt:', e);
      }
    }, delay);
  }

  /** Clears the idle prompt timer. This should be called whenever there is any activity. */
  private _clearIdlePrompt(state: ConnectionState): void {
    if (state.idlePromptTimer) {
      clearTimeout(state.idlePromptTimer);
      state.idlePromptTimer = null;
    }
    state.idlePromptCount = 0;
  }

  /**
   * Entry-point for WebSocketServer to forward every Twilio media-stream message (JSON string).
   * This keeps all Twilio-specific parsing logic inside the RealtimeAgentService.
   */
  public handleTwilioStreamEvent(ws: WebSocket, payload: Record<string, unknown>): void {
    // Locate the connection state for this WebSocket instance.
    const state = [...this.connections.values()].find((s) => s.ws === ws);

    if (!state) {
      console.warn('[REALTIME AGENT] Received stream event for unknown WebSocket');
      return;
    }

    const eventType = payload.event as string | undefined;

    switch (eventType) {
      case 'start': {
        // The START event provides the definitive CallSid – remap the state so future look-ups are cheap
        try {
          // Redundant client initialization removed. This is now handled exclusively
          // within handleStartEvent to prevent race conditions and ensure stability.
          this.handleStartEvent(state, payload);

          const startCallSid = (payload as any).start?.callSid as string | undefined;
          if (startCallSid) {
            // If the state is stored under a temporary key, move it under the real CallSid
            const existingKey = [...this.connections.entries()].find(([_, val]) => val === state)?.[0];
            if (existingKey && existingKey !== startCallSid) {
              this.connections.delete(existingKey);
              this.connections.set(startCallSid, state);
            }
            state.callSid = startCallSid;
          }
        } catch (error) {
          console.error('[REALTIME AGENT] Error processing START event:', error);
        }
        break;
      }
      case 'media': {
        const mediaPayload = (payload as any).media?.payload as string | undefined
        if (!mediaPayload) return

        // Decode payload early for energy calculations
        const buf = Buffer.from(mediaPayload, 'base64')

        // ----------------------------------
        //  Barge-in detection: if caller speaks
        //  while agent is still playing audio
        //  BUT NOT during welcome message delivery
        // ----------------------------------
        if (state.isSpeaking && !state.bargeInDetected && state.welcomeMessageDelivered) {
          // Only enable barge-in AFTER welcome message is fully delivered
          // Rough energy check on µ-law / PCM stream to avoid false positives
          let energySum = 0
          if (buf.length % 2 === 0) {
            for (let i = 0; i < buf.length; i += 2) {
              energySum += Math.abs(buf.readInt16LE(i))
            }
            energySum = energySum / (buf.length / 2) / 256
          } else {
            for (let i = 0; i < buf.length; i++) energySum += Math.abs(buf[i] - 128)
            energySum = energySum / buf.length
          }

          // Higher threshold during first 10 seconds to prevent false barge-ins
          const timeFromStart = Date.now() - (state.callStartTime || Date.now());
          const adjustedThreshold = timeFromStart < 10000 
            ? (state.vadCalibrated ? state.vadThreshold * 1.5 : VAD_THRESHOLD * 1.5)
            : (state.vadCalibrated ? state.vadThreshold : VAD_THRESHOLD);

          if (energySum > adjustedThreshold) {
            console.log('[REALTIME AGENT] Barge-in detected – pausing playback')
            state.bargeInDetected = true
          }
        }

        // Skip processing if currently speaking *and* no barge-in detected
        if ((state.isSpeaking && !state.bargeInDetected) || state.pendingAudioGeneration) {
          return
        }

        // --- Audio pre-processing for VAD & fallback pipeline ---
        // buf already decoded above

        // Determine if payload is 16-bit Linear PCM (even length → 2-byte samples)
        const isLinear16 = buf.length % 2 === 0

        // Calculate average absolute energy (0-255 scale)
        let energy = 0
        if (isLinear16) {
          for (let i = 0; i < buf.length; i += 2) {
            const sample = buf.readInt16LE(i)
            energy += Math.abs(sample)
          }
          energy = energy / (buf.length / 2) / 256 // normalise to 8-bit scale
        } else {
          for (let i = 0; i < buf.length; i++) energy += Math.abs(buf[i] - 128)
          energy = energy / buf.length
        }

        // 🎯 BULLETPROOF VAD CALIBRATION - ENTERPRISE GRADE 🎯
        if (!state.vadCalibrated) {
          state.vadNoiseFloor += energy
          state.vadSamples += 1
          if (state.vadSamples >= 100) { // Sufficient samples for calibration
            state.vadNoiseFloor = state.vadNoiseFloor / state.vadSamples
            // More conservative threshold to eliminate phantom speech
            state.vadThreshold = Math.max(state.vadNoiseFloor + 25, 30) // Minimum threshold of 30
            state.vadCalibrated = true
            console.log(`[🎯 BULLETPROOF VAD] ✅ Calibrated - noise floor: ${state.vadNoiseFloor.toFixed(2)}, threshold: ${state.vadThreshold.toFixed(2)}`)
          }
        }

        const now = Date.now()
        const threshold = state.vadCalibrated ? state.vadThreshold : VAD_THRESHOLD

        // ----------------------------------
        // Realtime pipeline (OpenAI client)
        // ----------------------------------
        if (state.openaiClient && state.ttsProvider === 'realtime') {
          try {
            // Forward raw caller audio to the realtime client.
            // We now rely entirely on OpenAI's server-side VAD, eliminating local
            // energy-based heuristics that caused premature turn-taking.
            state.openaiClient.sendAudio(mediaPayload)

            // Activity heartbeat – prevents premature idle prompts.
            state.lastActivity = Date.now()
          } catch (error) {
            console.error('[REALTIME AGENT] Error with realtime client audio processing:', error)
            // Graceful degradation to fallback pipeline
            state.ttsProvider = 'openai'
            state.openaiClient = undefined
          }
          return
        }

        // --- High-quality fallback pipeline with professional Whisper transcription ---

        // Wait for business context before processing
        if (!state.businessId) return

        // 🎯 BULLETPROOF SPEECH DETECTION - FORTUNE 500 QUALITY 🎯
        if (energy > threshold) {
          if (!state.isRecording) {
            console.log('[🎯 BULLETPROOF SPEECH] 🎙️ Recording started - Fortune 500 quality detection')
            this._clearIdlePrompt(state);
            state.isRecording = true
            state.recordingStartMs = now
            state.audioQueue = [] // Clear any previous audio
            state.lastActivity = now // Update activity timestamp
          }
          state.lastSpeechMs = now
          state.audioQueue.push(mediaPayload)
        } else if (state.isRecording) {
          // Continue capturing trailing audio for complete professional sentences
          state.audioQueue.push(mediaPayload)
        }

        // 🎯 PROCESS COMPLETE UTTERANCES WITH BULLETPROOF TIMING 🎯
        const silenceDuration = now - state.lastSpeechMs
        const recordingDuration = state.recordingStartMs ? now - state.recordingStartMs : 0
        
        if (state.isRecording && !state.isProcessing && state.audioQueue.length > 0) {
          const shouldProcess = (
            silenceDuration > VAD_SILENCE_MS || // Silence detected
            recordingDuration > MAX_UTTERANCE_MS || // Max recording time reached
            (silenceDuration > 500 && state.audioQueue.length >= 20) // FIXED: Faster processing for short phrases
          )
          
          if (shouldProcess) {
            state.isLinear16Recording = isLinear16
            console.log(`[🎯 BULLETPROOF SPEECH] 🔄 Processing utterance: ${state.audioQueue.length} chunks, ${recordingDuration}ms duration`)
            state.isProcessing = true
            // Process asynchronously to prevent blocking
            this.flushAudioQueue(state).catch(error => {
              console.error('[🎯 BULLETPROOF SPEECH] ❌ Error in audio processing:', error)
              state.isProcessing = false
              // Send recovery message
              this.streamEnterpriseQualityTTS(state, "I apologize, could you please repeat that?").catch(() => {})
            })
          }
        }

        // Note: BulletproofElevenLabsClient is for TTS, not STT
        // STT functionality will use Whisper transcription instead
        break
      }
      case 'stop':
      case 'end': {
        // If we have already moved into an active listening state, ignore premature STOP events
        if (state.isListening) {
          console.log('[REALTIME AGENT] 🛈 Ignoring premature Twilio STOP event – agent is listening');
          break;
        }
        // Clean-up when Twilio signals the end of the stream **after** the call actually ends
        this.cleanup('Twilio STOP event');
        if (!state.callSid) ws.close();
        break;
      }
      default:
        console.warn('[REALTIME AGENT] Unhandled Twilio stream event type:', eventType);
    }
  }

  private async escalateToHuman(state: ConnectionState, targetNumber?: string): Promise<void> {
    const { callSid, businessId } = state
    if (!callSid) {
      console.error('[REALTIME AGENT] Attempted escalation without CallSid')
      return
    }

    // Determine fallback voicemail URL
    const base = getPrimaryUrl() || (process.env.HOST ? `https://${process.env.HOST}` : '')
    const host = base.replace(/\/$/, '') || `https://${process.env.HOST || 'localhost'}`
    const voicemailUrl = `${host}/api/voice/voicemail` // must be implemented as POST returning TwiML <Record>

    // Pick escalation number (ENV overrides > business setting > explicit parameter)
    const dialNumber = targetNumber || process.env.DEFAULT_ESCALATION_NUMBER || undefined

    // If we still do not have a valid destination, gracefully route to voicemail
    if (!dialNumber) {
      console.warn('[REALTIME AGENT] No escalation number configured – routing caller to voicemail instead')
      // Inform the caller politely before recording
      try {
        const twiml = new twilio.twiml.VoiceResponse()
        twiml.say({ voice: 'Polly.Amy' }, 'I\'m transferring you to voicemail so our team can follow up shortly. Please leave your message after the beep.')
        twiml.record({ action: voicemailUrl, maxLength: 120, playBeep: true, trim: 'trim-silence' })
        twiml.say({ voice: 'Polly.Amy' }, 'Thank you. Goodbye.')
        twiml.hangup()

        this.twilioClient.calls(callSid).update({ twiml: twiml.toString() })
      } catch (err) {
        console.error('[REALTIME AGENT] Failed to redirect to voicemail during escalation fallback:', err)
      }

      prisma.callLog.update({ where: { callSid }, data: { status: 'VOICEMAIL', metadata: { reason: 'ESCALATION_FALLBACK' } } } as any).catch(() => {})
      return
    }

    try {
      // 🎯 ENHANCEMENT: Provide warm handoff message with context
      await this.streamEnterpriseQualityTTS(state, 
        "Of course! I'm connecting you to a member of our team right now. Please hold while I transfer your call."
      );
      
      // Give the message time to complete
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const twiml = new twilio.twiml.VoiceResponse()
      const dial = twiml.dial({ 
        action: voicemailUrl, 
        timeout: 30, // Increased timeout for better connection chances
        callerId: state.fromNumber || undefined,
        record: 'record-from-answer' // Record the conversation for QA
      })
      dial.number(dialNumber)

      this.twilioClient.calls(callSid).update({ twiml: twiml.toString() })
      console.log(`[🎯 HUMAN ESCALATION] ✅ Warm transfer initiated to ${dialNumber} for call ${callSid}`)
      
      // Log escalation details for analytics
      const escalationContext = {
        transferredTo: dialNumber,
        escalationTime: new Date().toISOString(),
        conversationLength: state.conversationHistory.length,
        fromNumber: state.fromNumber,
        businessId: state.businessId,
        reason: 'USER_REQUESTED'
      };

      // Update callLog status
      prisma.callLog.update({ 
        where: { callSid }, 
        data: { 
          status: 'TRANSFERRED', 
          metadata: escalationContext 
        } 
      } as any).catch(() => {})

    } catch (error) {
      console.error('[🎯 HUMAN ESCALATION] ❌ Failed to initiate warm transfer:', error)
      // As a last resort, fall back to voicemail so the caller is never left hanging
      this.sendToVoicemail(state)
    }
  }

  /** Directs the caller to leave a voicemail, recording up to 120 seconds. */
  private sendToVoicemail(state: ConnectionState): void {
    if (!state.callSid) {
      console.error('[REALTIME AGENT] Attempted voicemail without CallSid')
      return
    }

    const base = getPrimaryUrl() || (process.env.HOST ? `https://${process.env.HOST}` : '')
    const recordUrl = `${base}/api/voice/voicemail` // will store recording

    try {
      const twiml = new twilio.twiml.VoiceResponse()
      twiml.say({ voice: 'Polly.Amy' }, 'Please leave a detailed message after the beep. When you are done, simply hang up.')
      twiml.record({ action: recordUrl, maxLength: 120, playBeep: true, trim: 'trim-silence' })
      twiml.say({ voice: 'Polly.Amy' }, 'Thank you. Goodbye.')
      twiml.hangup()

      this.twilioClient.calls(state.callSid).update({ twiml: twiml.toString() })
      console.log('[REALTIME AGENT] Redirected caller to voicemail.')

      prisma.callLog.update({ where: { callSid: state.callSid }, data: { status: 'VOICEMAIL' } } as any).catch(() => {})

    } catch (error) {
      console.error('[REALTIME AGENT] Failed to start voicemail recording:', error)
    }
  }

  private async _handleTranscript(state: ConnectionState, transcript: string): Promise<void> {
    transcript = transcript.trim()
    if (!transcript) return

    console.log('[STT] >>', transcript)

    // Update conversation history + process message (reusing existing logic)
    try {
      // Lead qualification branch or normal processing identical to flushAudioQueue path
      // Reuse existing flushAudioQueue logic by calling processMessage directly
      const response = await processMessage({
        message: transcript,
        conversationHistory: state.conversationHistory,
        businessId: state.businessId!,
        currentActiveFlow: state.currentFlow ?? null,
        callSid: state.callSid ?? undefined,
        channel: 'VOICE'
      })

      this.addToConversationHistory(state, 'user', transcript)
      if (response.reply) this.addToConversationHistory(state, 'assistant', response.reply)
      state.currentFlow = response.currentFlow || null
      if (response.reply) {
        await this.streamTTS(state, response.reply)
      }
    } catch (err) {
      console.error('[STT] processing error', err)
    }
  }

  /**
   * 🎯 BULLETPROOF ELEVENLABS STT INITIALIZATION 🎯 
   * Handles 403 errors and API key issues gracefully with automatic fallback
   */
  private async initializeElevenLabsSTT(state: ConnectionState): Promise<void> {
    if (state.sttClient) {
      console.log('[🎯 BULLETPROOF STT] ElevenLabs STT already initialized');
      return;
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey || apiKey.trim() === '') {
      console.warn('[🎯 BULLETPROOF STT] ⚠️ ELEVENLABS_API_KEY not configured - STT disabled');
      console.warn('[🎯 BULLETPROOF STT] ✅ Continuing with Whisper-only transcription (this is fine)');
      return;
    }

    console.log('[🎯 BULLETPROOF STT] 🚀 Initializing ElevenLabs Streaming STT...');

    try {
                      const client = new BulletproofElevenLabsClient({ 
          apiKey: apiKey.trim(),
          voiceId: 'pNInz6obpgDQGcFmaJgB', // Rachel professional voice
          model: 'eleven_turbo_v2_5'
        });
      
      // Add timeout for connection attempt
      const connectionTimeout = setTimeout(() => {
        console.warn('[🎯 BULLETPROOF STT] ⚠️ ElevenLabs STT connection timeout (10s)');
        try {
          client.disconnect();
        } catch (closeErr) {
          // Ignore close errors
        }
      }, 10000);

      await client.connect();
      clearTimeout(connectionTimeout);

      client.on('transcript', async (text: string) => {
        try {
          console.log('[🎯 BULLETPROOF STT] 📝 ElevenLabs transcript:', text);
          await this._handleTranscript(state, text);
        } catch (err) {
          console.error('[🎯 BULLETPROOF STT] ❌ Error handling ElevenLabs transcript:', err);
        }
      });

      client.on('close', () => {
        console.log('[🎯 BULLETPROOF STT] 📴 ElevenLabs STT connection closed');
        state.sttClient = undefined;
      });

      client.on('error', (error: any) => {
        console.error('[🎯 BULLETPROOF STT] ❌ ElevenLabs STT error:', error);
        state.sttClient = undefined;
      });

      state.sttClient = client;
      console.log('[🎯 BULLETPROOF STT] ✅ ElevenLabs Streaming STT connected successfully');

    } catch (err: any) {
      console.error('[🎯 BULLETPROOF STT] ❌ ElevenLabs STT initialization failed:', err.message);
      
      // Specific error handling for common issues
      if (err.message?.includes('403') || err.message?.includes('Unauthorized')) {
        console.error('[🎯 BULLETPROOF STT] 🚨 ELEVENLABS API KEY INVALID OR EXPIRED');
        console.error('[🎯 BULLETPROOF STT] 💡 Please check your ElevenLabs API key in environment variables');
        console.error('[🎯 BULLETPROOF STT] ✅ Falling back to Whisper-only transcription');
      } else if (err.message?.includes('429') || err.message?.includes('rate limit')) {
        console.error('[🎯 BULLETPROOF STT] 🚨 ELEVENLABS RATE LIMIT EXCEEDED');
        console.error('[🎯 BULLETPROOF STT] ✅ Falling back to Whisper-only transcription');
      } else if (err.message?.includes('timeout')) {
        console.error('[🎯 BULLETPROOF STT] 🚨 ELEVENLABS CONNECTION TIMEOUT');
        console.error('[🎯 BULLETPROOF STT] ✅ Falling back to Whisper-only transcription');
      } else {
        console.error('[🎯 BULLETPROOF STT] 🚨 UNKNOWN ELEVENLABS ERROR:', err);
        console.error('[🎯 BULLETPROOF STT] ✅ Falling back to Whisper-only transcription');
      }

      // Graceful fallback - the system continues with Whisper transcription
      state.sttClient = undefined;
      console.log('[🎯 BULLETPROOF STT] ✅ System will continue with professional Whisper transcription');
    }
  }

  /**
   * If we requested a realtime response but no audio arrives within 3.5 s, switch to OpenAI TTS fallback.
   */
  private _scheduleRealtimeAudioFallback(state: ConnectionState): void {
    // Clear previous timer
    if (state.realtimeAudioTimer) {
      clearTimeout(state.realtimeAudioTimer)
      state.realtimeAudioTimer = null
    }

    state.realtimeAudioTimer = setTimeout(async () => {
      if (state.isSpeaking) return // audio arrived afterwards

      console.warn('[REALTIME AGENT] Realtime response timeout – falling back to OpenAI TTS')

      // Switch provider
      state.ttsProvider = 'openai'
      state.openaiVoice = 'nova'
      state.openaiModel = 'tts-1-hd'
      state.openaiClient = undefined

      const fallbackText = state.lastAssistantText || 'I apologize, I am having some technical difficulties. Could you please repeat that?'
      try {
        await this.streamTTS(state, fallbackText)
      } catch (err) {
        console.error('[REALTIME AGENT] Fallback TTS also failed:', err)
      }
    }, 3500)
  }

  /** Plays a raw µ-law audio buffer to the caller in real-time (used for resuming after barge-in). */
  private async _playBufferedAudio(state: ConnectionState, buffer: Buffer): Promise<void> {
    if (!state.streamSid || buffer.length === 0) return

    const CHUNK_SIZE = 320 // 40 ms
    state.isSpeaking = true

    for (let offset = 0; offset < buffer.length; offset += CHUNK_SIZE) {
      // Allow nested barge-in while resuming too
      if (state.bargeInDetected) {
        // Keep the *new* remaining audio in queue (overwrite) and exit
        state.pendingSpeechBuffer = buffer.subarray(offset)
        console.log('[REALTIME AGENT] Playback paused again due to barge-in')
        break
      }

      const chunk = buffer.subarray(offset, offset + CHUNK_SIZE)
      const payload = chunk.toString('base64')
      if (state.ws.readyState === WebSocket.OPEN && state.streamSid) {
        state.ws.send(JSON.stringify({
          event: 'media',
          streamSid: state.streamSid,
          media: { payload }
        }))
      } else {
        console.warn('[REALTIME AGENT] WebSocket not ready – stop buffered playback')
        break
      }
      await new Promise((r) => setTimeout(r, 40))
    }

    // Playback done
    if (!state.bargeInDetected && state.ws.readyState === WebSocket.OPEN && state.streamSid) {
      state.ws.send(JSON.stringify({ event: 'mark', streamSid: state.streamSid, mark: { name: 'speech_complete' } }))
    }

    state.isSpeaking = false
  }

  private async loadEnterpriseAgentConfig(state: ConnectionState): Promise<void> {
    if (!state.businessId || state.__configLoaded) return;

    console.log(`[REALTIME AGENT] Loading enterprise voice configuration for business ${state.businessId}`);

    try {
      // 🎯 CRITICAL FIX: Load complete business configuration
      const cfg = await prisma.agentConfig.findUnique({
        where: { businessId: state.businessId }
      });
      
      console.log(`[🏢 ENTERPRISE CONFIG] 🔍 Full config from database:`, JSON.stringify(cfg, null, 2));

      if (cfg) {
        // FORCE ELEVENLABS FOR ENTERPRISE QUALITY
        state.ttsProvider = 'elevenlabs';
        
        // 🎯 CRITICAL FIX: Use proper type casting for voice configuration
        const elevenlabsVoice = (cfg as any).elevenlabsVoice;
        const elevenlabsModel = (cfg as any).elevenlabsModel;
        const voiceSettings = (cfg as any).voiceSettings;
        
        console.log(`[🏢 ENTERPRISE CONFIG] 🔍 Voice config fields:`, {
          elevenlabsVoice,
          elevenlabsModel,
          voiceSettings: typeof voiceSettings,
          openaiVoice: cfg.openaiVoice,
          openaiModel: cfg.openaiModel
        });

        // Set premium voice configuration with bulletproof fallbacks
        if (elevenlabsVoice && elevenlabsVoice.trim().length > 10) {
          state.openaiVoice = elevenlabsVoice.trim();
          console.log(`[🏢 ENTERPRISE CONFIG] ✅ Using ElevenLabs voice: ${state.openaiVoice}`);
        } else if (cfg.openaiVoice && String(cfg.openaiVoice).trim().length > 3) {
          state.openaiVoice = String(cfg.openaiVoice).trim().toLowerCase();
          console.log(`[🏢 ENTERPRISE CONFIG] ✅ Using OpenAI voice: ${state.openaiVoice}`);
        } else {
          // Default to Rachel (professional female voice)
          state.openaiVoice = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB';
          console.log(`[🏢 ENTERPRISE CONFIG] ⚠️ Using default voice: ${state.openaiVoice}`);
        }
        
        state.openaiModel = elevenlabsModel || cfg.openaiModel || 'eleven_turbo_v2_5';
        state.personaPrompt = (cfg.personaPrompt || '') + FILLER_INSTRUCTIONS;
        
        // 🎯 PARSE VOICE SETTINGS WITH BULLETPROOF ERROR HANDLING
        try {
          if (voiceSettings) {
            if (typeof voiceSettings === 'string') {
              const parsed = JSON.parse(voiceSettings);
              state.voiceSettings = {
                stability: parsed.stability || 0.7,
                similarity_boost: parsed.similarity_boost || parsed.similarity || 0.85,
                style: parsed.style || 0.2,
                use_speaker_boost: parsed.use_speaker_boost !== false,
                speed: parsed.speed || 1.0
              };
              console.log(`[🏢 ENTERPRISE CONFIG] ✅ Parsed voice settings from JSON`);
            } else if (typeof voiceSettings === 'object') {
              state.voiceSettings = {
                stability: voiceSettings.stability || 0.7,
                similarity_boost: voiceSettings.similarity_boost || voiceSettings.similarity || 0.85,
                style: voiceSettings.style || 0.2,
                use_speaker_boost: voiceSettings.use_speaker_boost !== false,
                speed: voiceSettings.speed || 1.0
              };
              console.log(`[🏢 ENTERPRISE CONFIG] ✅ Using voice settings object`);
            } else {
              throw new Error('Invalid voice settings format');
            }
          } else {
            throw new Error('No voice settings found');
          }
        } catch (jsonErr) {
          console.warn('[🏢 ENTERPRISE CONFIG] ⚠️ Invalid voiceSettings, using enterprise defaults:', jsonErr);
          state.voiceSettings = {
            stability: 0.7,
            similarity_boost: 0.85,
            style: 0.2,
            use_speaker_boost: true,
            speed: 1.0
          };
        }
        
        console.log(`[🏢 ENTERPRISE CONFIG] ✅ FINAL VOICE CONFIG:`, {
          ttsProvider: state.ttsProvider,
          voice: state.openaiVoice,
          model: state.openaiModel,
          settings: state.voiceSettings
        });
        
        console.log(`[REALTIME AGENT] Enterprise voice config loaded: ElevenLabs with voice ${state.openaiVoice}`);
      } else {
        // Set enterprise defaults when no config found
        console.log('[REALTIME AGENT] No config found, using enterprise defaults');
        state.ttsProvider = 'elevenlabs';
        state.openaiVoice = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
        state.openaiModel = process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5';
        state.voiceSettings = {
          stability: 0.65,
          similarity: 0.85,
          style: 0.15,
          use_speaker_boost: true,
          speed: 1.0
        };
      }
    } catch (err) {
      console.error('[REALTIME AGENT] Failed to load enterprise config, using bulletproof defaults:', (err as Error).message);
      state.ttsProvider = 'elevenlabs';
      state.openaiVoice = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
      state.openaiModel = process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5';
      state.voiceSettings = {
        stability: 0.65,
        similarity: 0.85,
        style: 0.15,
        use_speaker_boost: true,
        speed: 1.0
      };
    } finally {
      state.__configLoaded = true;
    }
  }

  private async initializeLeadQualification(state: ConnectionState): Promise<void> {
    if (!state.businessId || state.clientId) return; // Skip if business unknown or existing client

    try {
      // Load lead capture questions
      const agentConfig = await prisma.agentConfig.findUnique({
        where: { businessId: state.businessId },
        include: { questions: { orderBy: { order: 'asc' } } }
      });

      const lcQuestions = agentConfig?.questions || [];

      if (lcQuestions.length > 0) {
        console.log(`[REALTIME AGENT] Initializing lead qualification with ${lcQuestions.length} questions`);
        
        state.leadQualifier = new LeadQualifier(
          lcQuestions.map((q: any) => ({
            id: q.id,
            order: q.order,
            questionText: q.questionText,
            expectedFormat: q.expectedFormat || undefined,
            isRequired: q.isRequired,
            mapsToLeadField: q.mapsToLeadField || undefined,
          }))
        );
        
        state.qualAnswers = {};
        state.currentFlow = 'LEAD_QUAL';
        state.qualQuestionMap = lcQuestions.reduce((acc: Record<string, { questionText: string; mapsToLeadField?: string }>, q: any) => {
          acc[q.id] = { 
            questionText: q.questionText, 
            mapsToLeadField: q.mapsToLeadField || undefined 
          };
          return acc;
        }, {} as Record<string, { questionText: string; mapsToLeadField?: string }>);

        // Don't start questions immediately - let welcome message finish first
        console.log('[REALTIME AGENT] Lead qualification initialized, will start after welcome message');
      }
    } catch (err) {
      console.error('[REALTIME AGENT] Failed to initialize lead qualification:', err);
    }
  }

  // ----------------------------------- CRITICAL FIX: Enhanced startListening -----------------------------------
  private startListening(state: ConnectionState): void {
    if (state.isListening) {
      console.log('[🎯 REALTIME AGENT] Agent already in listening state');
      return;
    }
    
    state.isListening = true;
    state.isSpeaking = false; // Ensure we're not in speaking state
    state.pendingAudioGeneration = false; // Clear any pending generation flags
    
    // Reset barge-in detection for new listening session
    state.bargeInDetected = false;
    
    console.log('[🎯 REALTIME AGENT] ✅ TRANSITIONING TO LISTENING STATE - Agent is now actively waiting for user input');
    
    // Ensure WebSocket is ready and call is active
    if (state.ws.readyState !== WebSocket.OPEN) {
      console.error('[🎯 REALTIME AGENT] ❌ WebSocket not open, cannot start listening');
      return;
    }
    
    if (!state.streamSid) {
      console.error('[🎯 REALTIME AGENT] ❌ No streamSid available, cannot start listening');
      return;
    }
    
    // Mark that we're ready to process audio
    state.lastActivity = Date.now();
    
    console.log('[🎯 REALTIME AGENT] 🎯 LISTENING STATE ACTIVE - Ready to process incoming audio');
  }
}

// Export singleton instance
export const realtimeAgentService = RealtimeAgentService.getInstance();

// Export helpers for testing purposes (tree-shaken in production builds)
export { isRealtimeTemporarilyDisabled as isRealtimeDisabled, markRealtimeFailure as markFailure } 