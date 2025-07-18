import { useEffect, useState } from 'react'
import { useBusiness } from '@/context/business-context'

export interface LeadQuestion {
  id: string
  questionText: string
  expectedFormat: string
  order: number
  isRequired: boolean
  options?: string[]
  question?: string
  type?: string
  required?: boolean
  followUp?: string
}

export function useLeadQuestions() {
  const [questions, setQuestions] = useState<LeadQuestion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { businessId } = useBusiness()

  const fetchQuestions = async () => {
    try {
      setLoading(true)
      const url = `/api/lead-questions${businessId ? `?businessId=${businessId}` : ''}`
      const res = await fetch(url, { credentials: 'include' })
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      // Normalize to the UI shape
      const mapped = data.questions.map((q: any) => ({
        id: q.id,
        questionText: q.questionText,
        question: q.questionText,
        expectedFormat: q.expectedFormat,
        type: q.expectedFormat?.toLowerCase() || 'text',
        order: q.order,
        isRequired: q.isRequired,
        required: q.isRequired,
      }))
      setQuestions(mapped)
    } catch (err) {
      console.error(err)
      setError('Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!businessId) return
    fetchQuestions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId])

  const addQuestion = async (payload: Partial<LeadQuestion>) => {
    const res = await fetch(`/api/lead-questions${businessId ? `?businessId=${businessId}` : ''}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      await fetchQuestions()
      return true
    }
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || 'Failed to add question')
  }

  async function updateQuestion(id: string, updates: Partial<LeadQuestion>) {
    const res = await fetch(`/api/lead-questions/${id}${businessId ? `?businessId=${businessId}` : ''}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    if (res.ok) fetchQuestions()
  }

  async function deleteQuestion(id: string) {
    const res = await fetch(`/api/lead-questions/${id}${businessId ? `?businessId=${businessId}` : ''}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (res.ok) fetchQuestions()
  }

  return { questions, loading, error, addQuestion, updateQuestion, deleteQuestion, refetch: fetchQuestions }
} 