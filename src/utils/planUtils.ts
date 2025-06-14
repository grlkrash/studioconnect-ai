import { PlanTier } from '@prisma/client'

export interface PlanFeature {
  id: string
  name: string
  description: string
  requiredPlan: PlanTier
}

export const PLAN_FEATURES: Record<string, PlanFeature> = {
  AI_CALL_ANSWERING: {
    id: 'ai_call_answering',
    name: 'AI Call Answering',
    description: '24/7 AI-powered call answering service',
    requiredPlan: 'PRO'
  },
  LEAD_QUALIFICATION: {
    id: 'lead_qualification_flow',
    name: 'Lead Qualification Flow',
    description: 'Customizable lead qualification questions and flow',
    requiredPlan: 'PRO'
  },
  CUSTOM_AI_PERSONA: {
    id: 'custom_ai_persona_voice',
    name: 'Custom AI Persona & Voice',
    description: 'Customize AI name and voice to match your brand',
    requiredPlan: 'PRO'
  },
  EMAIL_NOTIFICATIONS: {
    id: 'email_notifications_leads',
    name: 'Email Notifications for Leads',
    description: 'Receive email summaries and transcripts of calls',
    requiredPlan: 'PRO'
  },
  BASIC_ANALYTICS: {
    id: 'basic_call_analytics',
    name: 'Basic Call Analytics',
    description: 'Basic insights into call patterns and lead quality',
    requiredPlan: 'PRO'
  },
  PM_TOOL_INTEGRATION: {
    id: 'pm_tool_integration_one_way',
    name: 'PM Tool Integration (One-way)',
    description: 'Connect with project management tools for status updates',
    requiredPlan: 'ENTERPRISE'
  },
  REALTIME_STATUS: {
    id: 'realtime_project_status_lookup',
    name: 'Real-time Project Status Lookup',
    description: 'Instant project status updates via webhooks',
    requiredPlan: 'ENTERPRISE'
  },
  CLIENT_FAQ: {
    id: 'client_specific_faq',
    name: 'Client-specific FAQ',
    description: 'Build interactive FAQ for common client questions',
    requiredPlan: 'ENTERPRISE'
  },
  ADVANCED_ANALYTICS: {
    id: 'advanced_call_analytics',
    name: 'Advanced Call Analytics',
    description: 'Detailed analytics and insights for all interactions',
    requiredPlan: 'ENTERPRISE'
  },
  CLIENT_RECOGNITION: {
    id: 'client_recognition_by_phone',
    name: 'Client Recognition by Phone',
    description: 'Personalized experience for existing clients',
    requiredPlan: 'ENTERPRISE'
  }
}

type Feature = 'basic_chat' | 'lead_capture' | 'knowledge_base' | 'voice_calls' | 'project_management' | 'integrations'

export class PlanUtils {
  // Plan hierarchy where a higher numeric value unlocks all lower-tier features
  private static readonly PLAN_HIERARCHY = {
    PRO: 0,
    ENTERPRISE: 1
  } as const

  private static readonly FEATURES: Record<PlanTier, Feature[]> = {
    PRO: ['basic_chat', 'lead_capture', 'knowledge_base', 'voice_calls'],
    ENTERPRISE: ['basic_chat', 'lead_capture', 'knowledge_base', 'voice_calls', 'project_management', 'integrations']
  } as Record<PlanTier, Feature[]>

  static isPlanSufficient(userPlan: PlanTier, requiredPlan: PlanTier): boolean {
    return this.PLAN_HIERARCHY[userPlan] >= this.PLAN_HIERARCHY[requiredPlan]
  }

  static getAvailableFeatures(plan: PlanTier): Feature[] {
    return [...this.FEATURES[plan]]
  }

  static hasFeature(plan: PlanTier, feature: Feature): boolean {
    return this.FEATURES[plan].includes(feature)
  }

  /**
   * Branding is shown on the PRO plan and hidden on ENTERPRISE.
   */
  static shouldShowBranding(planTier: PlanTier): boolean {
    return planTier === 'PRO'
  }
} 