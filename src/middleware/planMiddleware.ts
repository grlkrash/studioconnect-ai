import { Request, Response, NextFunction } from 'express'
import { PlanTier } from '@prisma/client'
import { isAuthenticatedRequest } from '../api/authMiddleware'

export class PlanManager {
  static isPlanSufficient(userPlan: PlanTier, requiredPlan: PlanTier): boolean {
    const planHierarchy = {
      [PlanTier.PRO]: 0,
      [PlanTier.ENTERPRISE]: 1
    }
    return planHierarchy[userPlan] >= planHierarchy[requiredPlan]
  }

  static canAccessVoiceFeatures(plan: PlanTier): boolean {
    return plan === PlanTier.PRO || plan === PlanTier.ENTERPRISE
  }

  static getAvailableFeatures(plan: PlanTier): string[] {
    const features = {
      [PlanTier.PRO]: ['Basic Chat', 'Knowledge Base', 'Voice Calls', 'Custom Branding'],
      [PlanTier.ENTERPRISE]: ['Basic Chat', 'Knowledge Base', 'Voice Calls', 'Custom Branding', 'Project Management', 'API Access']
    }
    return features[plan]
  }

  static shouldShowBranding(plan: PlanTier): boolean {
    return plan === PlanTier.PRO
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