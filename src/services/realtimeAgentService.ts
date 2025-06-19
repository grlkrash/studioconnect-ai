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
import { ElevenLabsStreamingClient } from './elevenlabsStreamingClient'
import { formatForSpeech } from '../utils/ssml';
import RedisManager from '../config/redis';
import ENTERPRISE_VOICE_CONFIG, { validateEnterpriseConfig, getEnterpriseVoiceSettings, getEnterpriseVADSettings, getEnterprisePhantomFilter, getEnterpriseErrorMessages } from '../config/enterpriseDefaults';

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
  sttClient?: ElevenLabsStreamingClient;
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
      voiceSettings: { ...ENTERPRISE_DEFAULTS.voiceSettings }
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
        
        // Set premium voice configuration with bulletproof fallbacks
        if (cfg.elevenlabsVoice && cfg.elevenlabsVoice.trim()) {
          state.openaiVoice = cfg.elevenlabsVoice.trim();
          console.log(`[🏢 ENTERPRISE CONFIG] 🎙️ Using configured ElevenLabs voice: ${state.openaiVoice}`);
        } else if (cfg.openaiVoice && cfg.openaiVoice.trim()) {
          state.openaiVoice = cfg.openaiVoice.trim();
          console.log(`[🏢 ENTERPRISE CONFIG] 🎙️ Using fallback voice: ${state.openaiVoice}`);
        } else {
          state.openaiVoice = ENTERPRISE_DEFAULTS.voiceId;
          console.log(`[🏢 ENTERPRISE CONFIG] 🎙️ Using enterprise default voice: ${state.openaiVoice}`);
        }
        
        // Set model with fallback
        state.openaiModel = cfg.elevenlabsModel || cfg.openaiModel || ENTERPRISE_DEFAULTS.modelId;
        console.log(`[🏢 ENTERPRISE CONFIG] 🔧 Using model: ${state.openaiModel}`);
        
        // Set persona prompt
        state.personaPrompt = (cfg.personaPrompt || '') + FILLER_INSTRUCTIONS;
        
        // 🎯 PARSE VOICE SETTINGS WITH BULLETPROOF ERROR HANDLING 🎯
        try {
          if (cfg.voiceSettings) {
            if (typeof cfg.voiceSettings === 'string') {
              state.voiceSettings = JSON.parse(cfg.voiceSettings);
              console.log(`[🏢 ENTERPRISE CONFIG] ✅ Parsed voice settings from JSON string`);
            } else if (typeof cfg.voiceSettings === 'object') {
              state.voiceSettings = cfg.voiceSettings;
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
    console.log(`[🏢 ENTERPRISE WELCOME] 🎯 Generating welcome message...`);
    
    // 🎯 LAYER 1: Business-specific welcome message
    if (state.businessId) {
      try {
        const business = await prisma.business.findUnique({
          where: { id: state.businessId },
          select: { name: true }
        });

        const agentConfig = await prisma.agentConfig.findUnique({
          where: { businessId: state.businessId },
          select: { 
            welcomeMessage: true, 
            voiceGreetingMessage: true 
          }
        });

        let welcomeMessage = '';
        
        if (agentConfig?.voiceGreetingMessage && agentConfig.voiceGreetingMessage.trim()) {
          welcomeMessage = agentConfig.voiceGreetingMessage.trim();
          console.log(`[🏢 ENTERPRISE WELCOME] ✅ Using voice greeting message`);
        } else if (agentConfig?.welcomeMessage && agentConfig.welcomeMessage.trim()) {
          welcomeMessage = agentConfig.welcomeMessage.trim();
          console.log(`[🏢 ENTERPRISE WELCOME] ✅ Using welcome message`);
        } else {
          const businessName = business?.name || 'this premier creative agency';
          welcomeMessage = `Good day! Thank you for calling ${businessName}. I'm your dedicated AI Account Manager, here to provide immediate assistance with your creative projects and strategic initiatives. How may I help you today?`;
          console.log(`[🏢 ENTERPRISE WELCOME] ✅ Using generated Fortune 500 business message`);
        }

        // Personalize for existing clients
        if (state.clientId) {
          welcomeMessage = `Welcome back! ${welcomeMessage}`;
          console.log(`[🏢 ENTERPRISE WELCOME] ✅ Personalized for existing client`);
        }

        return welcomeMessage;
      } catch (error) {
        console.error(`[🏢 ENTERPRISE WELCOME] ⚠️ Error getting business welcome message:`, error);
        // Fall through to Layer 2
      }
    }

    // 🎯 LAYER 2: Generic Fortune 500 professional welcome
    const genericMessage = 'Good day! Thank you for calling StudioConnect AI. I\'m your dedicated AI Account Manager, ready to provide immediate assistance with your creative projects and strategic business initiatives. How may I help you today?';
    console.log(`[🏢 ENTERPRISE WELCOME] ✅ Using generic Fortune 500 professional message`);
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
      // Ensure enterprise configuration is loaded
      if (!state.__configLoaded) {
        await this.loadEnterpriseVoiceConfiguration(state);
      }

      // 🎯 FORCE ELEVENLABS FOR ENTERPRISE QUALITY 🎯
      if (state.ttsProvider !== 'elevenlabs') {
        console.log(`[🏢 ENTERPRISE TTS] 🎯 FORCING ELEVENLABS FOR ENTERPRISE QUALITY (was: ${state.ttsProvider})`);
        state.ttsProvider = 'elevenlabs';
        state.openaiVoice = ENTERPRISE_DEFAULTS.voiceId;
        state.openaiModel = ENTERPRISE_DEFAULTS.modelId;
      }

      // Validate ElevenLabs voice ID
      const voiceIdPattern = /^[a-zA-Z0-9_-]{20,}$/;
      if (!voiceIdPattern.test(state.openaiVoice)) {
        console.warn(`[🏢 ENTERPRISE TTS] ⚠️ Invalid ElevenLabs voice ID "${state.openaiVoice}", using enterprise default`);
        state.openaiVoice = ENTERPRISE_DEFAULTS.voiceId;
      }

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

      // 🎯 BULLETPROOF FALLBACK SYSTEM 🎯
      if (!mp3Path) {
        console.warn(`[🏢 ENTERPRISE TTS] ⚠️ ElevenLabs failed, initiating fallback sequence...`);

        // Fallback 1: OpenAI TTS HD
        console.log(`[🏢 ENTERPRISE TTS] 🔄 Fallback 1: OpenAI TTS HD`);
        mp3Path = await generateSpeechFromText(cleanText, 'nova', 'tts-1-hd', 'openai');
        
        if (!mp3Path) {
          // Fallback 2: OpenAI TTS Standard
          console.log(`[🏢 ENTERPRISE TTS] 🔄 Fallback 2: OpenAI TTS Standard`);
          mp3Path = await generateSpeechFromText(cleanText, 'nova', 'tts-1', 'openai');
        }

        if (!mp3Path) {
          // Fallback 3: Amazon Polly
          console.log(`[🏢 ENTERPRISE TTS] 🔄 Fallback 3: Amazon Polly`);
          mp3Path = await generateSpeechFromText(cleanText, 'Amy', 'tts-1', 'polly');
        }

        if (!mp3Path) {
          console.error('[🏢 ENTERPRISE TTS] 🚨 CRITICAL: All TTS providers failed');
          return;
        }
      }

      // Mark as speaking before streaming
      state.isSpeaking = true;
      console.log(`[🏢 ENTERPRISE TTS] 🎵 Starting audio stream...`);

      // Convert MP3 to µ-law for Twilio with enterprise-grade settings
      const ulawPath = path.join(os.tmpdir(), `${path.basename(mp3Path, path.extname(mp3Path))}.ulaw`);

      await execFileAsync(ffmpegPath as string, [
        '-y',
        '-i', mp3Path,
        '-ar', '8000',
        '-ac', '1',
        '-f', 'mulaw',
        '-af', 'volume=0.85,highpass=f=100,lowpass=f=3400', // Professional audio processing
        ulawPath
      ]);

      const ulawBuffer = await fs.promises.readFile(ulawPath);
      const CHUNK_SIZE = 320; // 40ms of audio at 8kHz µ-law

      // Stream audio in real-time with professional pacing
      for (let offset = 0; offset < ulawBuffer.length; offset += CHUNK_SIZE) {
        // Check for barge-in
        if (state.bargeInDetected) {
          state.pendingSpeechBuffer = ulawBuffer.subarray(offset);
          console.log('[🏢 ENTERPRISE TTS] 🛑 Playback paused due to barge-in');
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
        } else {
          console.warn('[🏢 ENTERPRISE TTS] ⚠️ WebSocket not ready, stopping audio stream');
          break;
        }

        // Professional timing for natural speech
        await new Promise((resolve) => setTimeout(resolve, 40));
      }

      // Signal end of message
      if (!state.bargeInDetected && state.ws.readyState === WebSocket.OPEN && state.streamSid) {
        state.ws.send(JSON.stringify({ 
          event: 'mark', 
          streamSid: state.streamSid, 
          mark: { name: 'speech_complete' } 
        }));
      }

      console.log('[🏢 ENTERPRISE TTS] ✅ ENTERPRISE QUALITY TTS DELIVERED SUCCESSFULLY');

      // Clean up temp files
      await cleanupTempFile(mp3Path);
      await cleanupTempFile(ulawPath);

    } catch (error) {
      console.error('[🏢 ENTERPRISE TTS] 🚨 CRITICAL ERROR:', error);
      
      // Emergency fallback with simple message
      try {
        console.log('[🏢 ENTERPRISE TTS] 🚨 EMERGENCY FALLBACK ACTIVATED');
        const emergencyMp3 = await generateSpeechFromText(
          "I apologize, I am having technical difficulties. Please hold while I reconnect.", 
          'nova', 'tts-1', 'openai'
        );
        
        if (emergencyMp3 && state.ws.readyState === WebSocket.OPEN && state.streamSid) {
          const buffer = await fs.promises.readFile(emergencyMp3);
          const payload = buffer.toString('base64');
          state.ws.send(JSON.stringify({
            event: 'media',
            streamSid: state.streamSid,
            media: { payload }
          }));
          await cleanupTempFile(emergencyMp3);
          console.log('[🏢 ENTERPRISE TTS] ✅ Emergency message delivered');
        }
      } catch (emergencyError) {
        console.error('[🏢 ENTERPRISE TTS] 🚨 Emergency fallback also failed:', emergencyError);
      }
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
          try { state.sttClient.close() } catch {}
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
      console.log(`[REALTIME AGENT] Processing ${audioToProcess.length} audio chunks for transcription`)

      const rawBuffers = audioToProcess.map((b64) => Buffer.from(b64, 'base64'))
      const isLinear16 = state.isLinear16Recording ?? false
      const rawData = Buffer.concat(rawBuffers)

      // Enhanced duration check for professional quality
      const MIN_DURATION_MS = 300 // Increased minimum for better accuracy
      const bytesPerMs = isLinear16 ? 32 : 8 // adjust for codec
      const durationMs = rawData.length / bytesPerMs

      if (durationMs < MIN_DURATION_MS) {
        console.log(`[REALTIME AGENT] Audio too short (${durationMs.toFixed(0)}ms), skipping transcription`)
        return
      }

      console.log(`[REALTIME AGENT] Processing ${durationMs.toFixed(0)}ms of audio`)

      const baseName = `${state.callSid || 'unknown'}_${Date.now()}`
      rawPath = path.join(os.tmpdir(), `${baseName}.ulaw`)
      wavPath = path.join(os.tmpdir(), `${baseName}.wav`)

      await fs.promises.writeFile(rawPath, rawData)

      // Enhanced audio conversion with noise reduction
      const inputFormat = isLinear16 ? 's16le' : 'mulaw'
      const inputRate = isLinear16 ? '16000' : '8000'
      await execFileAsync(ffmpegPath as string, [
        '-y',
        '-f', inputFormat,
        '-ar', inputRate,
        '-ac', '1',
        '-i', rawPath,
        '-af', 'highpass=f=80,lowpass=f=3400,volume=1.2',
        '-ar', '16000',
        wavPath
      ])

      console.log('[REALTIME AGENT] Starting professional transcription...')
      
      // 🎯 BULLETPROOF TRANSCRIPTION WITH MULTIPLE FALLBACKS 🎯
      let transcriptRaw: string | null = null;
      let attempts = 0;
      const maxAttempts = 3;

      while (!transcriptRaw && attempts < maxAttempts) {
        attempts++;
        console.log(`[REALTIME AGENT] Transcription attempt ${attempts}/${maxAttempts}`);
        
        try {
          transcriptRaw = await getTranscription(wavPath);
          if (transcriptRaw && transcriptRaw.trim()) {
            console.log(`[REALTIME AGENT] ✅ Transcription SUCCESS on attempt ${attempts}`);
            break;
          }
        } catch (transcriptError) {
          console.error(`[REALTIME AGENT] ❌ Transcription attempt ${attempts} failed:`, transcriptError);
          
          if (attempts === maxAttempts) {
            console.error(`[REALTIME AGENT] 🚨 ALL TRANSCRIPTION ATTEMPTS FAILED`);
            // Send recovery message instead of failing silently
            try {
              await this.streamEnterpriseQualityTTS(state, "I'm sorry, I didn't catch that. Could you please repeat what you said?");
            } catch (recoveryError) {
              console.error('[REALTIME AGENT] Recovery message also failed:', recoveryError);
            }
            return;
          }
          
          // Wait briefly before retry
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      if (!transcriptRaw || transcriptRaw.trim().length === 0) {
        console.log('[REALTIME AGENT] No transcription received after all attempts')
        return
      }

      const transcript = transcriptRaw.trim()
      console.log(`[REALTIME AGENT] ✅ FINAL TRANSCRIPT: "${transcript}"`)

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
            state.currentMissingQuestionId = missingKey
            if (nextPrompt) await this.streamTTS(state, nextPrompt)
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
              console.error('[REALTIME AGENT] Failed to process lead qualification completion:', err)
            }

            // Clear qualifier and continue normal flow
            state.leadQualifier = undefined
            state.currentMissingQuestionId = undefined
            state.currentFlow = null
            // Continue to AI processing if user said something else
          }
        } catch (err) {
          console.error('[REALTIME AGENT] Lead qualification error:', err)
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
        console.log(`[🎯 BULLETPROOF FILTER] Eliminated phantom transcription: "${transcript}" (VAD false positive - Fortune 500 quality maintained)`)
        return
      }

      const callSid = state.callSid ?? 'UNKNOWN_CALLSID'

      console.log('[REALTIME AGENT] Processing message with AI handler...')
      const response = await processMessage({
        message: transcript,
        conversationHistory: state.conversationHistory,
        businessId: state.businessId!,
        currentActiveFlow: state.currentFlow ?? null,
        callSid,
        channel: 'VOICE'
      })

      // Update conversation history
      this.addToConversationHistory(state, 'user', transcript)
      if (response.reply) {
        this.addToConversationHistory(state, 'assistant', response.reply)
      }
      state.currentFlow = response.currentFlow || null
      
      // Manage conversation history size
      if (state.conversationHistory.length > MAX_CONVERSATION_HISTORY) {
        state.conversationHistory = state.conversationHistory.slice(-MAX_CONVERSATION_HISTORY)
      }

      if (response.reply) {
        console.log(`[REALTIME AGENT] AI Response: "${response.reply.substring(0, 100)}..."`)
        await this.streamTTS(state, response.reply)
      }

      // Handle escalation request (warm transfer)
      if (response.nextAction === 'TRANSFER') {
        console.log('[REALTIME AGENT] AI requested live escalation – initiating warm transfer')
        // Use business notification phone if available
        let targetNum: string | undefined
        if (state.businessId) {
          const biz = await prisma.business.findUnique({ where: { id: state.businessId }, select: { notificationPhoneNumber: true } })
          targetNum = biz?.notificationPhoneNumber || undefined
        }
        this.escalateToHuman(state, targetNum)
      } else if (response.nextAction === 'VOICEMAIL') {
        console.log('[REALTIME AGENT] AI requested voicemail – redirecting caller')
        this.sendToVoicemail(state)
      }

    } catch (error) {
      console.error('[REALTIME AGENT] Critical error in audio processing pipeline:', error)
      
      // 🎯 BULLETPROOF ENTERPRISE ERROR RECOVERY 🎯
      const enterpriseErrors = getEnterpriseErrorMessages();
      const randomMessage = enterpriseErrors.RECOVERY[Math.floor(Math.random() * enterpriseErrors.RECOVERY.length)]
      
      try {
        await this.streamEnterpriseQualityTTS(state, randomMessage) // Use enterprise TTS for recovery
      } catch (fallbackError) {
        console.error('[🎯 BULLETPROOF RECOVERY] Even enterprise error recovery failed:', fallbackError)
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
          console.error('[REALTIME AGENT] Failed to resume queued speech:', err)
        }
      }
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
          await this.deliverBulletproofWelcomeMessage(state);
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
        await redis.connect().catch(() => {})
      }
      if (redis.isClientConnected()) {
        const key = `persona:${state.businessId}`
        const cachedPersona = await redis.getClient().get(key)
        if (cachedPersona) {
          state.personaPrompt = cachedPersona + FILLER_INSTRUCTIONS
        }
      }
    } catch (err) {
      console.warn('[RealtimeAgent] Redis persona cache unavailable', (err as Error).message)
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
          if (!redis.isClientConnected()) await redis.connect().catch(() => {})
          if (redis.isClientConnected() && state.personaPrompt) {
            await redis.getClient().setEx(`persona:${state.businessId}`, 3600, cfg.personaPrompt || '')
          }
        } catch (err) {
          console.warn('[RealtimeAgent] Failed to store persona in Redis', (err as Error).message)
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
        // ----------------------------------
        if (state.isSpeaking && !state.bargeInDetected) {
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

          if (energySum > (state.vadCalibrated ? state.vadThreshold : VAD_THRESHOLD)) {
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

        // BULLETPROOF noise-floor calibration - FORTUNE 500 QUALITY
        if (!state.vadCalibrated) {
          state.vadNoiseFloor += energy
          state.vadSamples += 1
          if (state.vadSamples >= 200) { // INCREASED - More samples for bulletproof calibration
            state.vadNoiseFloor = state.vadNoiseFloor / state.vadSamples
            state.vadThreshold = state.vadNoiseFloor + 35 // INCREASED - Eliminates phantom speech completely
            state.vadCalibrated = true
            console.log(`[🎯 BULLETPROOF VAD] Calibrated - noise floor: ${state.vadNoiseFloor.toFixed(2)}, threshold: ${state.vadThreshold.toFixed(2)}`)
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

        // BULLETPROOF speech detection - FORTUNE 500 QUALITY
        if (energy > threshold) {
          if (!state.isRecording) {
            console.log('[🎯 BULLETPROOF SPEECH] Recording started - Fortune 500 quality detection')
            this._clearIdlePrompt(state);
            state.isRecording = true
            state.recordingStartMs = now
            state.audioQueue = [] // Clear any previous audio
          }
          state.lastSpeechMs = now
          state.audioQueue.push(mediaPayload)
        } else if (state.isRecording) {
          // Continue capturing trailing audio for complete professional sentences
          state.audioQueue.push(mediaPayload)
        }

        // Process complete utterances with BULLETPROOF timing
        if (state.isRecording && !state.isProcessing && (now - state.lastSpeechMs > VAD_SILENCE_MS || (state.recordingStartMs && now - state.recordingStartMs > MAX_UTTERANCE_MS)) && state.audioQueue.length > 0) {
          state.isLinear16Recording = isLinear16
          console.log('[🎯 BULLETPROOF SPEECH] Processing complete utterance via enterprise Whisper pipeline')
          state.isProcessing = true
          this.flushAudioQueue(state)
        }

        // inside case 'media' after buf defined and before VAD detection
        if (state.sttClient && state.sttClient.isReady()) {
          try {
            state.sttClient.sendAudio(buf)
          } catch {}
        }
        break
      }
      case 'stop':
      case 'end': {
        // Clean-up when Twilio signals the end of the stream.
        this.cleanup('Twilio STOP event');
        if (!state.callSid) ws.close();
        break;
      }
      default:
        console.warn('[REALTIME AGENT] Unhandled Twilio stream event type:', eventType);
    }
  }

  private escalateToHuman(state: ConnectionState, targetNumber?: string): void {
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
      const twiml = new twilio.twiml.VoiceResponse()
      const dial = twiml.dial({ action: voicemailUrl, timeout: 20, callerId: state.fromNumber || undefined })
      dial.number(dialNumber)
      twiml.say({ voice: 'Polly.Amy' }, 'Connecting you now, please hold.')

      this.twilioClient.calls(callSid).update({ twiml: twiml.toString() })
      console.log(`[REALTIME AGENT] Warm transfer initiated to ${dialNumber} for call ${callSid}`)

      // Update callLog status
      prisma.callLog.update({ where: { callSid }, data: { status: 'TRANSFERRED', metadata: { transferredTo: dialNumber } } } as any).catch(() => {})

    } catch (error) {
      console.error('[REALTIME AGENT] Failed to initiate warm transfer:', error)
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
      const client = new ElevenLabsStreamingClient({ 
        apiKey: apiKey.trim(),
        modelId: 'eleven_multilingual_v2'
      });
      
      // Add timeout for connection attempt
      const connectionTimeout = setTimeout(() => {
        console.warn('[🎯 BULLETPROOF STT] ⚠️ ElevenLabs STT connection timeout (10s)');
        try {
          client.close();
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
      // Load business configuration with comprehensive error handling
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
        // FORCE ELEVENLABS FOR ENTERPRISE QUALITY
        state.ttsProvider = 'elevenlabs';
        
        // Set premium voice configuration
        if (cfg.elevenlabsVoice) {
          state.openaiVoice = cfg.elevenlabsVoice;
        } else if (cfg.openaiVoice) {
          state.openaiVoice = cfg.openaiVoice;
        } else {
          // Default to Rachel (professional female voice)
          state.openaiVoice = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
        }
        
        state.openaiModel = cfg.elevenlabsModel || cfg.openaiModel || 'eleven_turbo_v2_5';
        state.personaPrompt = (cfg.personaPrompt || '') + FILLER_INSTRUCTIONS;
        
        // Parse voice settings with error handling
        try {
          if (cfg.voiceSettings) {
            if (typeof cfg.voiceSettings === 'string') {
              state.voiceSettings = JSON.parse(cfg.voiceSettings);
            } else {
              state.voiceSettings = cfg.voiceSettings;
            }
          }
        } catch (jsonErr) {
          console.warn('[REALTIME AGENT] Invalid voiceSettings JSON, using enterprise defaults');
          state.voiceSettings = {
            stability: 0.65,
            similarity: 0.85,
            style: 0.15,
            use_speaker_boost: true,
            speed: 1.0
          };
        }
        
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
}

// Export singleton instance
export const realtimeAgentService = RealtimeAgentService.getInstance();

// Export helpers for testing purposes (tree-shaken in production builds)
export { isRealtimeTemporarilyDisabled as isRealtimeDisabled, markRealtimeFailure as markFailure } 