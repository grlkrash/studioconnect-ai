"use client"

import { useBusiness } from '@/context/business-context'
import { Loader2 } from 'lucide-react'

interface BusinessGuardProps {
  children: React.ReactNode
}

export function BusinessGuard({ children }: BusinessGuardProps) {
  const { businessId, loading } = useBusiness()

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading business data...</p>
        </div>
      </div>
    )
  }

  if (!businessId) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="h-8 w-8 rounded-full bg-red-100 flex items-center justify-center">
            <span className="text-red-600 text-sm font-medium">!</span>
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Business Not Found</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Unable to load business data. Please check your configuration.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return <>{children}</>
} 