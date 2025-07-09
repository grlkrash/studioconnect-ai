import { useEffect, useState } from 'react'
import { useBusiness } from '@/context/business-context'

export interface Project {
  id: string
  name: string
  status: string
  details: string | null
  createdAt: string
  client: {
    id: string
    name: string
    email: string | null
    phone: string | null
  }
  knowledgeBaseEntries: Array<{
    id: string
    content: string
    createdAt: string
  }>
}

export interface Client {
  id: string
  name: string
  email: string | null
  phone: string | null
  projects: Array<{ id: string; name: string; status: string }>
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { businessId } = useBusiness()

  const fetchProjects = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/projects', { credentials: 'include' })
      if (!response.ok) throw new Error('Failed to fetch projects')
      const data = await response.json()
      setProjects(data)
    } catch (err) {
      console.error('Error fetching projects:', err)
      setError('Failed to load projects')
    } finally {
      setLoading(false)
    }
  }

  const fetchClients = async () => {
    try {
      const response = await fetch('/api/clients', { credentials: 'include' })
      if (!response.ok) throw new Error('Failed to fetch clients')
      const data = await response.json()
      setClients(data)
    } catch (err) {
      console.error('Error fetching clients:', err)
      setError('Failed to load clients')
    }
  }

  useEffect(() => {
    if (!businessId) return
    fetchProjects()
    fetchClients()
  }, [businessId])

  async function createProject(projectData: {
    name: string
    clientId: string
    status: string
    details?: string
  }) {
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(projectData),
    })

    if (response.ok) {
      await fetchProjects()
      return true
    }
    
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error || 'Failed to create project')
  }

  async function updateProject(id: string, updateData: Partial<Project>) {
    const response = await fetch(`/api/projects/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(updateData),
    })

    if (response.ok) {
      await fetchProjects()
      return true
    }
    
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error || 'Failed to update project')
  }

  async function deleteProject(id: string) {
    const response = await fetch(`/api/projects/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    })

    if (response.ok) {
      await fetchProjects()
      return true
    }
    
    throw new Error('Failed to delete project')
  }

  return {
    projects,
    clients,
    loading,
    error,
    createProject,
    updateProject,
    deleteProject,
    refetch: fetchProjects,
  }
} 