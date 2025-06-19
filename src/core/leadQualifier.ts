import z from 'zod'

/**
 * 🎯 BULLETPROOF ENTERPRISE LEAD QUALIFICATION SYSTEM 🎯
 * Designed for Fortune 50 quality client interactions with intelligent conversation flow
 */

interface LeadQuestion {
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
  private questions: LeadQuestion[]
  private currentQuestionIndex: number = 0

  constructor(questions: LeadQuestion[]) {
    // Sort questions by order to ensure proper sequence
    this.questions = questions.sort((a, b) => a.order - b.order)
    console.log(`[🎯 LEAD QUALIFIER] Initialized with ${this.questions.length} enterprise qualification questions`)
  }

  /**
   * 🎯 INTELLIGENT QUALIFICATION FLOW MANAGEMENT 🎯
   * Manages the conversation flow with Fortune 50 quality responses
   */
  getNextPrompt(answers: Record<string, string>): {
    nextPrompt: string | null
    finished: boolean
    missingKey: string | null
  } {
    console.log(`[🎯 LEAD QUALIFIER] Processing qualification step ${this.currentQuestionIndex + 1}/${this.questions.length}`)

    // Find the next unanswered required question
    for (let i = 0; i < this.questions.length; i++) {
      const question = this.questions[i]
      const hasAnswer = answers[question.id] && answers[question.id].trim().length > 0

      if (!hasAnswer && question.isRequired) {
        // Generate professional question with context
        const isFirstQuestion = Object.keys(answers).length === 0
        const nextPrompt = this.generateProfessionalPrompt(question, isFirstQuestion, i + 1)
        
        console.log(`[🎯 LEAD QUALIFIER] Generated question ${i + 1}: "${question.questionText}"`)
        
        return {
          nextPrompt,
          finished: false,
          missingKey: question.id
        }
      }
    }

    // All required questions answered
    console.log(`[🎯 LEAD QUALIFIER] ✅ Qualification completed successfully`)
    return {
      nextPrompt: null,
      finished: true,
      missingKey: null
    }
      }

  /**
   * 🎯 PROFESSIONAL PROMPT GENERATION 🎯
   * Creates Fortune 50 quality conversation prompts with natural flow
   */
  private generateProfessionalPrompt(
    question: LeadQuestion, 
    isFirstQuestion: boolean, 
    questionNumber: number
  ): string {
    let prompt = ''

    // Professional acknowledgment and transition
    if (isFirstQuestion) {
      prompt = "Perfect! I'll gather some key information so our team can provide you with the best possible service. "
    } else {
      const acknowledgments = [
        "Excellent, thank you. ",
        "Perfect, I've got that. ",
        "Outstanding, noted. ",
        "Great, thank you for that information. ",
        "Wonderful, I have that recorded. "
      ]
      prompt = acknowledgments[Math.floor(Math.random() * acknowledgments.length)]
    }

    // Add the actual question with professional context
    prompt += question.questionText

    // Add helpful context based on field type
    if (question.mapsToLeadField) {
      switch (question.mapsToLeadField.toLowerCase()) {
        case 'contactname':
        case 'name':
          prompt += " This helps us personalize our service for you."
          break
        case 'contactemail':
        case 'email':
          prompt += " We'll use this to send you project updates and proposals."
          break
        case 'contactphone':
        case 'phone':
          prompt += " This ensures we can reach you quickly for any urgent project matters."
          break
        case 'notes':
        case 'description':
          prompt += " Please provide as much detail as possible so we can understand your needs."
          break
      }
    }

    // Add professional closing for voice calls
    const progressIndicator = this.questions.length > 3 ? ` This is ${questionNumber} of ${this.questions.length} quick questions.` : ''
    
    return prompt + progressIndicator
  }

  /**
   * 🎯 QUALIFICATION COMPLETION ANALYSIS 🎯
   * Analyzes the quality and completeness of collected information
   */
  analyzeQualificationQuality(answers: Record<string, string>): {
    completeness: number
    missingCriticalInfo: string[]
    qualityScore: number
  } {
    const totalQuestions = this.questions.length
    const answeredQuestions = Object.keys(answers).filter(key => 
      answers[key] && answers[key].trim().length > 0
    ).length

    const completeness = totalQuestions > 0 ? (answeredQuestions / totalQuestions) * 100 : 0

    // Check for missing critical information
    const missingCriticalInfo: string[] = []
    const criticalFields = ['contactName', 'contactEmail', 'contactPhone', 'notes']
    
    this.questions.forEach(q => {
      if (q.mapsToLeadField && criticalFields.includes(q.mapsToLeadField)) {
        if (!answers[q.id] || answers[q.id].trim().length < 2) {
          missingCriticalInfo.push(q.mapsToLeadField)
        }
  }
    })

    // Calculate quality score based on completeness and answer quality
    let qualityScore = completeness
    
    // Boost score for detailed answers
    Object.values(answers).forEach(answer => {
      if (answer && answer.trim().length > 20) {
        qualityScore += 5 // Bonus for detailed responses
      }
    })

    // Cap at 100
    qualityScore = Math.min(qualityScore, 100)

    return {
      completeness,
      missingCriticalInfo,
      qualityScore: Math.round(qualityScore)
    }
  }

  /**
   * 🎯 EMERGENCY DETECTION SYSTEM 🎯
   * Detects urgent inquiries that need immediate escalation
   */
  detectUrgency(answers: Record<string, string>): {
    isUrgent: boolean
    urgencyLevel: 'low' | 'medium' | 'high' | 'critical'
    urgencyReasons: string[]
  } {
    const urgencyKeywords = {
      critical: ['emergency', 'urgent', 'asap', 'immediately', 'crisis', 'broken', 'down', 'stopped'],
      high: ['rush', 'deadline', 'tomorrow', 'today', 'urgent', 'priority', 'important'],
      medium: ['soon', 'quickly', 'fast', 'expedite', 'hurry', 'time-sensitive']
    }

    const urgencyReasons: string[] = []
    let urgencyLevel: 'low' | 'medium' | 'high' | 'critical' = 'low'

    // Analyze all answers for urgency indicators
    Object.values(answers).forEach(answer => {
      if (!answer) return
      
      const lowerAnswer = answer.toLowerCase()
      
      // Check for critical urgency
      urgencyKeywords.critical.forEach(keyword => {
        if (lowerAnswer.includes(keyword)) {
          urgencyLevel = 'critical'
          urgencyReasons.push(`Contains critical keyword: "${keyword}"`)
        }
      })

      // Check for high urgency
      if (urgencyLevel !== 'critical') {
        urgencyKeywords.high.forEach(keyword => {
          if (lowerAnswer.includes(keyword)) {
            urgencyLevel = 'high'
            urgencyReasons.push(`Contains high urgency keyword: "${keyword}"`)
          }
        })
      }

      // Check for medium urgency
      if (urgencyLevel === 'low') {
        urgencyKeywords.medium.forEach(keyword => {
          if (lowerAnswer.includes(keyword)) {
            urgencyLevel = 'medium'
            urgencyReasons.push(`Contains medium urgency keyword: "${keyword}"`)
          }
        })
      }
    })

    return {
      isUrgent: urgencyLevel !== 'low',
      urgencyLevel,
      urgencyReasons
    }
  }

  /**
   * 🎯 PROFESSIONAL COMPLETION MESSAGE 🎯
   * Generates appropriate completion message based on qualification results
   */
  generateCompletionMessage(answers: Record<string, string>): string {
    const qualityAnalysis = this.analyzeQualificationQuality(answers)
    const urgencyAnalysis = this.detectUrgency(answers)

    let message = "Thank you for providing that information. "

    if (urgencyAnalysis.isUrgent) {
      switch (urgencyAnalysis.urgencyLevel) {
        case 'critical':
          message += "I understand this is urgent. I'm immediately connecting you with our senior team who can provide immediate assistance. Please hold on."
          break
        case 'high':
          message += "I can see this is a priority for you. I'll have our project manager reach out to you within the next hour to discuss this in detail."
          break
        case 'medium':
          message += "I'll prioritize this and have someone from our team contact you today to move this forward quickly."
          break
      }
    } else {
      if (qualityAnalysis.qualityScore >= 80) {
        message += "Based on what you've shared, I can see this is an excellent fit for our creative capabilities. "
      }
      message += "Our team will review your requirements and follow up with a detailed proposal within 24 hours. "
    }

    message += "Is there anything else I can help clarify about our services or process?"

    return message
  }

  // Getter methods for external access
  getQuestions(): LeadQuestion[] {
    return [...this.questions]
  }

  getTotalQuestions(): number {
    return this.questions.length
  }

  getCurrentQuestionIndex(): number {
    return this.currentQuestionIndex
  }
} 