import { prisma } from '../services/db'
import { getEmbedding } from '../services/openai'

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
  limit: number = 3
): Promise<Array<{ id: string; content: string; sourceURL: string | null; similarity: number }>> => {
  try {
    // Generate embedding vector for the user's query
    const queryEmbeddingVector = await getEmbedding(userQuery)
    
    // Convert the embedding array to a string format for pgvector
    const vectorString = JSON.stringify(queryEmbeddingVector)
    
    // Perform vector similarity search using raw SQL with pgvector
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
      ORDER BY similarity DESC
      LIMIT ${limit}
    `
    
    // Optionally filter by minimum similarity threshold
    // For now, returning all results up to the limit
    
    console.log(`Found ${results.length} relevant knowledge entries for query: "${userQuery}"`)
    
    return results
  } catch (error) {
    console.error(`Error finding relevant knowledge for query "${userQuery}":`, error)
    throw error
  }
}

export default { generateAndStoreEmbedding, findRelevantKnowledge } 