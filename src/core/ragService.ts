import { prisma } from '../services/db'
import { Prisma } from '@prisma/client'
import { getEmbedding } from '../services/openai'
import { getChatCompletion } from '../services/openai'

interface SearchContext {
  isExistingClient?: boolean
  clientId?: string
  intent?: string
  projectId?: string
}

/**
 * Extracts project keywords from a user query
 */
const extractProjectKeywords = async (userQuery: string): Promise<string> => {
  const projectSearchQuery = `Extract the project name or keywords from: "${userQuery}". Respond with only the key phrase.`
  const extractedKeywords = await getChatCompletion(projectSearchQuery, "You are a project keyword extraction expert.")
  return extractedKeywords || 'UNCLEAR'
}

/**
 * Searches for project-specific information
 */
const searchProjectData = async (
  clientId: string,
  projectKeywords: string
): Promise<Array<{ id: string; content: string; sourceURL: string | null; similarity: number }> | null> => {
  try {
    const relevantProjects = await prisma.project.findMany({
      where: {
        clientId,
        OR: [
          { name: { contains: projectKeywords, mode: 'insensitive' } },
          { details: { contains: projectKeywords, mode: 'insensitive' } }
        ]
      },
      orderBy: { lastSyncedAt: 'desc' },
      take: 1
    })

    if (relevantProjects.length > 0) {
      const project = relevantProjects[0]
      console.log(`[RAG Service] Found relevant project: ${project.name}`)
      return [{
        id: project.id,
        content: `Project Name: ${project.name}. Current Status: ${project.status}. Last Updated: ${project.lastSyncedAt?.toLocaleString() || 'N/A'}. Details: ${project.details || 'No additional details provided.'}`,
        sourceURL: null,
        similarity: 1.0
      }]
    }
    return null
  } catch (error) {
    console.error('[RAG Service] Error searching project data:', error)
    return null
  }
}

/**
 * Generates an embedding vector for a knowledge base entry and stores it in the database.
 * @param knowledgeBaseId The ID of the knowledge base entry to process
 */
export const generateAndStoreEmbedding = async (knowledgeBaseId: string): Promise<void> => {
  try {
    // Fetch the KnowledgeBase record from the database
    const knowledgeBaseEntry = await prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId }
    })

    // Check if the record exists
    if (!knowledgeBaseEntry) {
      console.error(`Knowledge base entry not found: ${knowledgeBaseId}`)
      return
    }

    // Check if content is not empty
    if (!knowledgeBaseEntry.content || knowledgeBaseEntry.content.trim() === '') {
      console.log(`Content is empty for KB entry: ${knowledgeBaseId}, skipping embedding.`)
      return
    }

    // Generate the embedding vector
    const embeddingVector = await getEmbedding(knowledgeBaseEntry.content)

    // Update the KnowledgeBase record with the embedding using raw SQL
    // Since embedding is a pgvector type, we need to use raw SQL
    await prisma.$executeRaw`
      UPDATE knowledge_base 
      SET embedding = ${embeddingVector}::vector, 
          "updatedAt" = NOW()
      WHERE id = ${knowledgeBaseId}
    `

    console.log(`Successfully generated and stored embedding for KB entry: ${knowledgeBaseId}`)
  } catch (error) {
    console.error(`Error processing embedding for KB entry ${knowledgeBaseId}:`, error)
    throw error
  }
}

/**
 * Finds relevant knowledge base entries based on semantic similarity to a user query.
 * @param userQuery The user's question or search query
 * @param businessId The ID of the business to search within
 * @param limit Maximum number of results to return (default: 3)
 * @returns Array of relevant knowledge base entries with similarity scores
 */
export const findRelevantKnowledge = async (
  userQuery: string,
  businessId: string,
  limit: number = 3,
  context?: SearchContext
): Promise<Array<{ id: string; content: string; sourceURL: string | null; similarity: number }>> => {
  try {
    // Priority 1: Search for project status if intent is 'PROJECT_STATUS_INQUIRY' and client is known
    if (context?.isExistingClient && context?.clientId && context?.intent === 'PROJECT_STATUS_INQUIRY') {
      const projectKeywords = await extractProjectKeywords(userQuery)
      
      if (projectKeywords && projectKeywords !== 'UNCLEAR') {
        const projectResults = await searchProjectData(context.clientId, projectKeywords)
        if (projectResults) return projectResults
      }
    }

    // Priority 2: Search general or project-scoped knowledge base
    const queryEmbeddingVector = await getEmbedding(userQuery)
    const vectorString = JSON.stringify(queryEmbeddingVector)

    // Prepare optional project filter to avoid nested template literals within the main query
    const projectFilter = context?.projectId
      ? Prisma.sql` AND "projectId" = ${context.projectId}`
      : Prisma.sql``

    const results = await prisma.$queryRaw<
      Array<{ id: string; content: string; sourceURL: string | null; similarity: number }>
    >`
      SELECT 
        id, 
        content, 
        "sourceURL", 
        1 - (embedding <=> ${vectorString}::vector) AS similarity
      FROM knowledge_base
      WHERE "businessId" = ${businessId}
        AND embedding IS NOT NULL
        ${projectFilter}
      ORDER BY similarity DESC
      LIMIT ${limit}
    `

    return results
  } catch (error) {
    console.error('[RAG Service] Error finding relevant knowledge:', error)
    return []
  }
}

export default { generateAndStoreEmbedding, findRelevantKnowledge }