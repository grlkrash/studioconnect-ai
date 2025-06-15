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

  return { questions, loading, error, addQuestion, refetch: fetchQuestions }
} 