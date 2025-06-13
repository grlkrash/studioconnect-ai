import { Request, Response, NextFunction } from 'express'
import { PlanTier } from '@prisma/client'
import { isAuthenticatedRequest } from '../api/authMiddleware'

const planHierarchy = {
  FREE: 0,
  BASIC: 1,
  PRO: 2,
  ENTERPRISE: 3
}

const features = {
  FREE: ['basic_chat'],
  BASIC: ['basic_chat', 'lead_capture'],
  PRO: ['basic_chat', 'lead_capture', 'knowledge_base', 'voice_calls'],
  ENTERPRISE: ['basic_chat', 'lead_capture', 'knowledge_base', 'voice_calls', 'project_management', 'integrations']
}

export class PlanManager {
  static isPlanSufficient(userPlan: PlanTier, requiredPlan: PlanTier): boolean {
    return planHierarchy[userPlan] >= planHierarchy[requiredPlan]
  }

  static canAccessVoiceFeatures(plan: PlanTier): boolean {
    return plan === PlanTier.PRO || plan === PlanTier.ENTERPRISE
  }

  static getAvailableFeatures(plan: PlanTier): string[] {
    return features[plan]
  }

  static shouldShowBranding(plan: PlanTier): boolean {
    return plan === PlanTier.PRO
  }
}

export function hasRequiredPlan(requiredPlan: PlanTier) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.business?.planTier) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const userPlan = req.user.business.planTier
    return planHierarchy[userPlan] >= planHierarchy[requiredPlan]
      ? next()
      : res.status(403).json({ error: 'Upgrade required' })
  }
}

export function hasFeature(feature: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.business?.planTier) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const plan = req.user.business.planTier
    return features[plan].includes(feature)
      ? next()
      : res.status(403).json({ error: 'Feature not available in your plan' })
  }
}

export const requirePlan = (requiredPlan: PlanTier) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isAuthenticatedRequest(req)) {
      res.status(401).json({ error: 'Unauthorized: No user found' })
      return
    }

    const userPlan = req.user.business.planTier
    
    if (!PlanManager.isPlanSufficient(userPlan, requiredPlan)) {
      res.status(403).json({
        error: 'Plan upgrade required',
        currentPlan: userPlan,
        requiredPlan: requiredPlan,
        upgradeUrl: '/admin/upgrade'
      })
      return
    }
    
    next()
  }
}

export const requireVoiceFeatures = (req: Request, res: Response, next: NextFunction): void => {
  if (!isAuthenticatedRequest(req)) {
    res.status(401).json({ error: 'Unauthorized: No user found' })
    return
  }

  const userPlan = req.user.business.planTier
  
  if (!PlanManager.canAccessVoiceFeatures(userPlan)) {
    res.status(403).json({
      error: 'Voice features require PRO plan',
      currentPlan: userPlan,
      upgradeUrl: '/admin/upgrade'
    })
    return
  }
  
  next()
}

export const addPlanContext = (req: Request, res: Response, next: NextFunction): void => {
  if (!isAuthenticatedRequest(req)) {
    res.status(401).json({ error: 'Unauthorized: No user found' })
    return
  }

  const planTier = req.user.business.planTier
  
  res.locals.planTier = planTier
  res.locals.availableFeatures = PlanManager.getAvailableFeatures(planTier)
  res.locals.canAccessVoice = PlanManager.canAccessVoiceFeatures(planTier)
  res.locals.showBranding = PlanManager.shouldShowBranding(planTier)
  
  next()
} 