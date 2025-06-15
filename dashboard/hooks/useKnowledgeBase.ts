import { useEffect, useState } from 'react'

export interface KnowledgeEntry {
  id: string
  title?: string
  content: string
  updatedAt: string
}

export function useKnowledgeBase() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchEntries = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/knowledge-base', { credentials: 'include' })
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      setEntries(data)
    } catch (err) {
      console.error(err)
      setError('Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchEntries()
  }, [])

  return { entries, loading, error, refetch: fetchEntries }
} 