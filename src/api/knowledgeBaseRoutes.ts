import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'

import { prisma } from '../services/db'
import { authMiddleware } from './authMiddleware'
import { generateAndStoreEmbedding } from '../core/ragService'

// Ensure tmp uploads directory exists
const uploadsDir = path.join(process.cwd(), 'tmp', 'uploads')
if (!existsSync(uploadsDir)) {
  mkdirSync(uploadsDir, { recursive: true })
}

const router = Router()

// Multer setup – store files in tmp dir first
const upload = multer({ dest: uploadsDir })

/*
 * POST /api/knowledge-base
 * Creates a plain-text knowledge base record (optionally linked to a project)
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { content, sourceURL, projectId, metadata } = req.body

    if (!content || content.trim() === '') {
      res.status(400).json({ error: 'content is required' })
      return
    }

    const newEntry = await prisma.knowledgeBase.create({
      data: {
        content,
        sourceURL,
        projectId: projectId || null,
        businessId: req.user!.businessId,
        metadata: metadata ? JSON.parse(metadata) : undefined
      }
    })

    // Fire-and-forget embedding generation
    generateAndStoreEmbedding(newEntry.id).catch(console.error)

    res.status(201).json(newEntry)
  } catch (error) {
    console.error('[KB ROUTES] Failed to create KB entry:', error)
    res.status(500).json({ error: 'failed to create knowledge base entry' })
  }
})

/*
 * POST /api/knowledge-base/upload
 * Accepts a PDF/TXT file and ingests its text into KB
 */
router.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'file is required' })
      return
    }

    const { projectId } = req.body
    const tmpFilePath = req.file.path
    const ext = path.extname(req.file.originalname).toLowerCase()

    let extractedText = ''

    if (ext === '.pdf') {
      const pdfParse = await import('pdf-parse').then(m => m.default)
      const dataBuffer = await fs.readFile(tmpFilePath)
      const parsed = await pdfParse(dataBuffer)
      extractedText = parsed.text
    } else if (ext === '.txt') {
      extractedText = await fs.readFile(tmpFilePath, 'utf-8')
    } else {
      res.status(400).json({ error: 'unsupported file type. Only PDF and TXT are supported for now.' })
      return
    }

    // Clean up tmp file
    fs.unlink(tmpFilePath).catch(() => {})

    if (!extractedText || extractedText.trim() === '') {
      res.status(400).json({ error: 'failed to extract text from document' })
      return
    }

    const entry = await prisma.knowledgeBase.create({
      data: {
        content: extractedText,
        sourceURL: req.file.originalname,
        projectId: projectId || null,
        businessId: req.user!.businessId
      }
    })

    generateAndStoreEmbedding(entry.id).catch(console.error)

    res.status(201).json({ id: entry.id })
  } catch (error) {
    console.error('[KB ROUTES] Document ingestion error:', error)
    res.status(500).json({ error: 'document ingestion failed' })
  }
})

// GET list (optional project filter via query)
router.get('/', authMiddleware, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' })
    const { projectId } = req.query
    const where: any = { businessId: req.user.businessId }
    if (projectId) where.projectId = projectId

    const entries = await prisma.knowledgeBase.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    })
    res.json(entries)
  } catch (err) {
    console.error('[KB ROUTES] list', err)
    res.status(500).json({ error: 'failed to fetch knowledge base' })
  }
})

// GET stats
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' })
    const [articles, categoriesAgg] = await Promise.all([
      prisma.knowledgeBase.count({ where: { businessId: req.user.businessId } }),
      prisma.knowledgeBase.groupBy({
        by: ['metadata'],
        where: { businessId: req.user.businessId },
        _count: { _all: true },
      }),
    ])
    const categories = categoriesAgg.length
    res.json({ articles, categories })
  } catch (err) {
    console.error('[KB ROUTES] stats', err)
    res.status(500).json({ error: 'failed to fetch stats' })
  }
})

// UPDATE entry
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params
    const { content, metadata } = req.body
    const updated = await prisma.knowledgeBase.update({
      where: { id },
      data: { content, metadata },
    })
    res.json(updated)
  } catch (err) {
    console.error('[KB ROUTES] update', err)
    res.status(500).json({ error: 'failed to update entry' })
  }
})

// DELETE entry
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params
    await prisma.knowledgeBase.delete({ where: { id } })
    res.status(204).end()
  } catch (err) {
    console.error('[KB ROUTES] delete', err)
    res.status(500).json({ error: 'failed to delete entry' })
  }
})

export default router 