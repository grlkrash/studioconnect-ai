'use client'

import { useEffect, useState } from "react"
import { AlertCard } from "@/components/alert-card"

interface FeedItem {
  id: string
  type: 'NEW_LEAD' | 'SCOPE_CREEP'
  title: string
  summary: string
  riskTags?: string[]
  projectId?: string | null
}

export default function Dashboard() {
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [loading, setLoading] = useState<boolean>(true)

  useEffect(() => {
    async function fetchFeed() {
      try {
        const res = await fetch('/api/feed')
        if (!res.ok) {
          throw new Error('Failed to fetch feed')
        }
        const json = await res.json()
        setFeed(json.feed || [])
      } catch (err) {
        console.error('[Dashboard] Error fetching feed:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchFeed()
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <h1 className="text-3xl font-bold mb-6">Unified Dashboard</h1>

      {loading ? (
        <p>Loading...</p>
      ) : feed.length === 0 ? (
        <p>No recent activity yet.</p>
      ) : (
        <div className="grid gap-4">
          {feed.map(item => (
            <AlertCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  )
} 