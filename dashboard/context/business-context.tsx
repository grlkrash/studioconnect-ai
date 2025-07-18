"use client"

import { createContext, useContext } from "react"
import { useRouter } from "next/navigation"
import useSWR from "swr"

interface BusinessContextValue {
  businessId?: string
  loading: boolean
  user?: any
  business?: any
}

const BusinessContext = createContext<BusinessContextValue>({ loading: true })

async function fetcher(url: string) {
  const response = await fetch(url, { credentials: 'include' })
  
  // If unauthorized, redirect to login
  if (response.status === 401) {
    window.location.href = '/login'
    throw new Error('Unauthorized')
  }
  
  if (!response.ok) {
    throw new Error('Failed to fetch user data')
  }
  
  return response.json()
}

export function BusinessProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { data, error, isLoading } = useSWR<{
    businessId: string
    userId: string
    role: string
    business: any
  }>('/api/auth/me', fetcher, {
    onError: (err) => {
      if (err.message === 'Unauthorized') {
        router.push('/login')
      }
    }
  })

  const value: BusinessContextValue = {
    businessId: data?.businessId,
    loading: isLoading,
    user: data,
    business: data?.business,
  }

  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>
}

export const useBusiness = () => {
  const context = useContext(BusinessContext)
  if (context === undefined) {
    throw new Error('useBusiness must be used within a BusinessProvider')
  }
  return context
} 