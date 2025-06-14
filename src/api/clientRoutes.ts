import { Router } from 'express'
import { prisma } from '../services/db'
import { authMiddleware } from './authMiddleware'

const router = Router()

// POST /api/clients – create a new client for the authenticated user's business
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, email, phone } = req.body

    if (!name) {
      res.status(400).json({ error: 'name is required' })
      return
    }

    const client = await prisma.client.create({
      data: {
        name,
        email,
        phone,
        businessId: req.user!.businessId
      }
    })

    res.status(201).json(client)
  } catch (error) {
    console.error('[CLIENT ROUTES] Failed to create client:', error)
    res.status(500).json({ error: 'failed to create client' })
  }
})

// PUT /api/clients/:id – update an existing client (partial update)
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params

    // Ensure an id is provided – this is our unique selector for Client
    if (!id) {
      res.status(400).json({ error: 'client id is required in the path' })
      return
    }

    // Destructure only the fields that are allowed to be updated
    const { name, email, phone } = req.body as {
      name?: string
      email?: string | null
      phone?: string | null
    }

    // Build the data object dynamically to avoid overwriting with undefined
    const data: Record<string, string | null | undefined> = {}
    if (typeof name !== 'undefined') data.name = name
    if (typeof email !== 'undefined') data.email = email
    if (typeof phone !== 'undefined') data.phone = phone

    if (Object.keys(data).length === 0) {
      res.status(400).json({ error: 'no valid fields provided for update' })
      return
    }

    const updatedClient = await prisma.client.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        updatedAt: true
      }
    })

    res.json(updatedClient)
  } catch (error) {
    console.error('[CLIENT ROUTES] Failed to update client:', error)
    res.status(500).json({ error: 'failed to update client' })
  }
})

// DELETE /api/clients/:id – delete a client by id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params

    if (!id) {
      res.status(400).json({ error: 'client id is required in the path' })
      return
    }

    await prisma.client.delete({ where: { id } })

    res.status(204).end()
  } catch (error) {
    console.error('[CLIENT ROUTES] Failed to delete client:', error)
    res.status(500).json({ error: 'failed to delete client' })
  }
})

export default router 