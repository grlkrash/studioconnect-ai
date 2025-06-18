import z from 'zod'

/**
 * Deterministic lead-qualification engine.
 * Keeps no internal mutable state – all state is derived from the answers map you pass in.
 *
 * Usage:
 *   const engine = new LeadQualifier(questions)
 *   const { nextPrompt, finished, missingKey } = engine.getNextPrompt(currentAnswers)
 */

export interface LeadQuestion {
  id: string
  order: number
  questionText: string
  // simple regex or zod prebuilt validator key (email, phone, etc.)
  expectedFormat?: string
  isRequired: boolean
  mapsToLeadField?: string
}

export interface AnswersMap {
  [questionId: string]: string
}

export class LeadQualifier {
  private ordered: LeadQuestion[]

  constructor(questions: LeadQuestion[]) {
    this.ordered = [...questions].sort((a, b) => a.order - b.order)
  }

  /** Returns next prompt or undefined when finished */
  getNextPrompt(answers: AnswersMap) {
    for (const q of this.ordered) {
      const given = answers[q.id]
      if (!given) {
        return { nextPrompt: q.questionText, missingKey: q.id, finished: false }
      }
      if (q.expectedFormat && !this.validate(given, q.expectedFormat)) {
        return { nextPrompt: `I just want to double-check – ${q.questionText}`, missingKey: q.id, finished: false }
      }
    }
    return { finished: true as const }
  }

  /** crude validation helpers – can extend as needed */
  private validate(val: string, format: string) {
    switch (format.toLowerCase()) {
      case 'email':
        return z.string().email().safeParse(val).success
      case 'phone':
        return /\+?\d{7,15}/.test(val)
      default:
        try {
          const re = new RegExp(format)
          return re.test(val)
        } catch {
          return true
        }
    }
  }
} 