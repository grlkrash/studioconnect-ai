import { Request, Response, NextFunction } from 'express'
import { PlanTier } from '@prisma/client'

interface AuthenticatedRequest extends Request {
  user: {
    id: string
    businessId: string
    business: {
      planTier: PlanTier
    }
  }
}

export class PlanManager {
  static readonly PLAN_HIERARCHY = {
    PRO: 1,
    ENTERPRISE: 2
  }

  static isPlanSufficient(userPlan: PlanTier, requiredPlan: PlanTier): boolean {
    return this.PLAN_HIERARCHY[userPlan] >= this.PLAN_HIERARCHY[requiredPlan]
  }

  static getAvailableFeatures(planTier: PlanTier): string[] {
    switch (planTier) {
      case 'PRO':
        return [
          'chat_widget',
          'voice_agent',
          'premium_voices',
          'emergency_voice_calls',
          'basic_analytics',
          'session_management',
          'voice_configuration',
          'priority_support'
        ]
      
      case 'ENTERPRISE':
        return [
          'all_pro_features',
          'project_management_integration',
          'client_management',
          'advanced_analytics',
          'branding_removal',
          'custom_integrations',
          'dedicated_support',
          'team_collaboration'
        ]
      
      default:
        return []
    }
  }

  static canAccessVoiceFeatures(planTier: PlanTier): boolean {
    return planTier === 'PRO' || planTier === 'ENTERPRISE'
  }

  static shouldShowBranding(planTier: PlanTier): boolean {
    return planTier !== 'ENTERPRISE'
  }
}

export const requirePlan = (requiredPlan: PlanTier) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userPlan = req.user.business.planTier
    
    if (!PlanManager.isPlanSufficient(userPlan, requiredPlan)) {
      return res.status(403).json({
        error: 'Plan upgrade required',
        currentPlan: userPlan,
        requiredPlan: requiredPlan,
        upgradeUrl: '/admin/upgrade'
      })
    }
    
    next()
  }
}

export const requireVoiceFeatures = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const userPlan = req.user.business.planTier
  
  if (!PlanManager.canAccessVoiceFeatures(userPlan)) {
    return res.status(403).json({
      error: 'Voice features require PRO plan',
      currentPlan: userPlan,
      upgradeUrl: '/admin/upgrade'
    })
  }
  
  next()
}

export const addPlanContext = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const planTier = req.user.business.planTier
  
  res.locals.planTier = planTier
  res.locals.availableFeatures = PlanManager.getAvailableFeatures(planTier)
  res.locals.canAccessVoice = PlanManager.canAccessVoiceFeatures(planTier)
  res.locals.showBranding = PlanManager.shouldShowBranding(planTier)
  
  next()
} 