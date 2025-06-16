"use client"

import React, { createContext, useContext } from 'react'
import useSWR from 'swr'

interface BusinessContextValue {
  businessId?: string
  loading: boolean
}

const BusinessContext = createContext<BusinessContextValue>({ loading: true })

function fetcher(url: string) {
  return fetch(url, { credentials: 'include' }).then((r) => r.json())
}

export function BusinessProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useSWR<{ businessId?: string }>('/api/auth/me', fetcher)

  const value: BusinessContextValue = {
    businessId: data?.businessId,
    loading: isLoading,
  }

  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>
}

export function useBusiness() {
  return useContext(BusinessContext)
} 