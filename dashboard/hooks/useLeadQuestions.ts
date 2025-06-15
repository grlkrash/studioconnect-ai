import { useEffect, useState } from 'react'

export interface LeadQuestion {
  id: string
  questionText: string
  expectedFormat: string
  order: number
  isRequired: boolean
  options?: string[]
}

export function useLeadQuestions() {
  const [questions, setQuestions] = useState<LeadQuestion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchQuestions = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/lead-questions', { credentials: 'include' })
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      setQuestions(data.questions)
    } catch (err) {
      console.error(err)
      setError('Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchQuestions()
  }, [])

  const addQuestion = async (payload: Partial<LeadQuestion>) => {
    const res = await fetch('/api/lead-questions', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) fetchQuestions()
  }

  async function updateQuestion(id: string, updates: Partial<LeadQuestion>) {
    const res = await fetch(`/api/lead-questions/${id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    if (res.ok) fetchQuestions()
  }

  async function deleteQuestion(id: string) {
    const res = await fetch(`/api/lead-questions/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (res.ok) fetchQuestions()
  }

  return { questions, loading, error, addQuestion, updateQuestion, deleteQuestion, refetch: fetchQuestions }
} 