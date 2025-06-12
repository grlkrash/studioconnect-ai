import { Request, Response, NextFunction } from 'express'
import { PlanTier } from '@prisma/client'
import { AuthenticatedRequest } from '../api/authMiddleware'

export class PlanManager {
  static isPlanSufficient(userPlan: PlanTier, requiredPlan: PlanTier): boolean {
    const planHierarchy = {
      FREE: 0,
      PRO: 1,
      ENTERPRISE: 2
    }
    return planHierarchy[userPlan] >= planHierarchy[requiredPlan]
  }

  static canAccessVoiceFeatures(plan: PlanTier): boolean {
    return plan === 'PRO' || plan === 'ENTERPRISE'
  }

  static getAvailableFeatures(plan: PlanTier): string[] {
    const features = {
      FREE: ['Basic Chat', 'Knowledge Base'],
      PRO: ['Basic Chat', 'Knowledge Base', 'Voice Calls', 'Custom Branding'],
      ENTERPRISE: ['Basic Chat', 'Knowledge Base', 'Voice Calls', 'Custom Branding', 'Project Management', 'API Access']
    }
    return features[plan]
  }

  static shouldShowBranding(plan: PlanTier): boolean {
    return plan === 'FREE'
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