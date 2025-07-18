import { useEffect, useState } from 'react'
import { useBusiness } from '@/context/business-context'

export interface KnowledgeEntry {
  id: string
  title?: string
  content: string
  updatedAt: string
  category?: string
  usage?: number
  metadata?: any
  lastUpdated?: string
  projectId?: string
  project?: {
    id: string
    name: string
    client: {
      name: string
    }
  }
}

export interface Project {
  id: string
  name: string
  client: {
    name: string
  }
}

export function useKnowledgeBase() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { businessId } = useBusiness()

  const fetchEntries = async () => {
    try {
      setLoading(true)
      const url = `/api/knowledge-base${businessId ? `?businessId=${businessId}` : ''}`
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

  const fetchProjects = async () => {
    try {
      const res = await fetch('/api/projects', { credentials: 'include' })
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      setProjects(data)
    } catch (err) {
      console.error('Error fetching projects:', err)
    }
  }

  useEffect(() => {
    if (!businessId) return
    fetchEntries()
    fetchProjects()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId])

  async function addText(payload: { content: string; metadata?: any; projectId?: string }) {
    const res = await fetch(`/api/knowledge-base${businessId ? `?businessId=${businessId}` : ''}`, {
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

  async function uploadFile(file: File, projectId?: string) {
    const form = new FormData()
    form.append('file', file)
    if (projectId) {
      form.append('projectId', projectId)
    }
    const res = await fetch(`/api/knowledge-base/upload${businessId ? `?businessId=${businessId}` : ''}`, {
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
    const res = await fetch(`/api/knowledge-base/${id}${businessId ? `?businessId=${businessId}` : ''}`, {
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
    const res = await fetch(`/api/knowledge-base/${id}${businessId ? `?businessId=${businessId}` : ''}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (res.ok) {
      await fetchEntries()
      return true
    }
    throw new Error('Failed to delete')
  }

  return { entries, projects, loading, error, addText, uploadFile, updateEntry, deleteEntry, refetch: fetchEntries }
}

export function useKnowledgeStats(entries: KnowledgeEntry[]) {
  const categories = new Set(
    entries.map((e) => (e.metadata && e.metadata.category) || 'Uncategorized')
  )
  const mostUsed = Math.max(...entries.map((e: any) => e.usage || 0), 0)
  return { categories: categories.size, mostUsed }
}