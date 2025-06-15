import { useEffect, useState } from 'react'

export interface KnowledgeEntry {
  id: string
  title?: string
  content: string
  updatedAt: string
  category?: string
  usage?: number
  metadata?: any
  lastUpdated?: string
}

export function useKnowledgeBase() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchEntries = async () => {
    try {
      setLoading(true)
      const url = `/api/knowledge-base${process.env.NEXT_PUBLIC_BUSINESS_ID ? `?businessId=${process.env.NEXT_PUBLIC_BUSINESS_ID}` : ''}`
      const res = await fetch(url, { credentials: 'include' })
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

  async function addText(payload: { content: string; metadata?: any }) {
    const res = await fetch(`/api/knowledge-base${process.env.NEXT_PUBLIC_BUSINESS_ID ? `?businessId=${process.env.NEXT_PUBLIC_BUSINESS_ID}` : ''}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      await fetchEntries()
      return true
    }
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || 'Failed to add entry')
  }

  async function uploadFile(file: File) {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`/api/knowledge-base/upload${process.env.NEXT_PUBLIC_BUSINESS_ID ? `?businessId=${process.env.NEXT_PUBLIC_BUSINESS_ID}` : ''}`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    })
    if (res.ok) {
      await fetchEntries()
      return true
    }
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || 'Upload failed')
  }

  async function updateEntry(id: string, content: string) {
    const res = await fetch(`/api/knowledge-base/${id}${process.env.NEXT_PUBLIC_BUSINESS_ID ? `?businessId=${process.env.NEXT_PUBLIC_BUSINESS_ID}` : ''}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    if (res.ok) {
      await fetchEntries()
      return true
    }
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || 'Failed to update')
  }

  async function deleteEntry(id: string) {
    const res = await fetch(`/api/knowledge-base/${id}${process.env.NEXT_PUBLIC_BUSINESS_ID ? `?businessId=${process.env.NEXT_PUBLIC_BUSINESS_ID}` : ''}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (res.ok) {
      await fetchEntries()
      return true
    }
    throw new Error('Failed to delete')
  }

  return { entries, loading, error, addText, uploadFile, updateEntry, deleteEntry, refetch: fetchEntries }
}

export function useKnowledgeStats(entries: KnowledgeEntry[]) {
  const categories = new Set(
    entries.map((e) => (e.metadata && e.metadata.category) || 'Uncategorized')
  )
  const mostUsed = Math.max(...entries.map((e: any) => e.usage || 0), 0)
  return { categories: categories.size, mostUsed }
}