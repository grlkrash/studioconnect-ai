import { Router, Request, Response } from 'express'
import { authMiddleware } from './authMiddleware'
import { integrationService } from '../services/integrationService'
import { randomUUID } from 'crypto'
import RedisManager from '../config/redis'
import axios from 'axios'
import { generateCodeVerifier, deriveCodeChallenge } from '../utils/pkce'

const router = Router()

// ======== OAuth 2.0 (Asana) routes ========

/**
 * Step 1 – Initiate OAuth flow (PKCE) for a provider.
 * Redirects the user agent to the provider's authorization URL.
 * Cache {state, code_verifier, businessId} in Redis for 10 minutes.
 */
router.get('/:provider/oauth-start', authMiddleware, async (req: Request, res: Response) => {
  try {
    const provider = req.params.provider.toUpperCase()
    if (provider !== 'ASANA') return res.status(400).json({ error: 'Only Asana OAuth is supported right now.' })
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' })

    const clientId = process.env.ASANA_CLIENT_ID
    const appBaseUrl = process.env.APP_BASE_URL
    if (!clientId || !appBaseUrl) {
      return res.status(500).json({ error: 'Server missing ASANA_CLIENT_ID or APP_BASE_URL env vars.' })
    }

    const state = randomUUID()
    const verifier = generateCodeVerifier()
    const challenge = deriveCodeChallenge(verifier)

    // Persist temporary auth state in Redis (10 minutes TTL)
    const redis = RedisManager.getInstance()
    if (!redis.isClientConnected()) await redis.connect()
    await redis.getClient().setEx(`oauth:${state}`, 600, JSON.stringify({ verifier, businessId: req.user.businessId, provider }))

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: `${appBaseUrl}/api/integrations/asana/oauth-callback`,
      state,
      scope: 'default', // Asana uses full scope when omitted – keep minimal.
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })

    const authUrl = `https://app.asana.com/-/oauth_authorize?${params.toString()}`
    res.redirect(authUrl)
  } catch (err: any) {
    console.error('[integrationRoutes] oauth-start error:', err)
    res.status(500).json({ error: 'Failed to start OAuth flow' })
  }
})

/**
 * Step 2 – OAuth callback. Exchanges the authorization code for access & refresh tokens.
 * Then stores credentials via IntegrationService and redirects back to dashboard.
 */
router.get('/:provider/oauth-callback', async (req: Request, res: Response) => {
  try {
    const provider = req.params.provider.toUpperCase()
    if (provider !== 'ASANA') return res.status(400).send('Unsupported provider')

    const { code, state } = req.query as { code?: string; state?: string }
    if (!code || !state) return res.status(400).send('Missing code or state')

    // Retrieve PKCE verifier + businessId from Redis
    const redis = RedisManager.getInstance()
    if (!redis.isClientConnected()) await redis.connect()
    const saved = await redis.getClient().get(`oauth:${state}`)
    if (!saved) return res.status(400).send('Invalid or expired state')

    await redis.getClient().del(`oauth:${state}`) // one-time use
    const { verifier, businessId } = JSON.parse(saved) as { verifier: string; businessId: string }

    const clientId = process.env.ASANA_CLIENT_ID
    const clientSecret = process.env.ASANA_CLIENT_SECRET
    const appBaseUrl = process.env.APP_BASE_URL
    if (!clientId || !clientSecret || !appBaseUrl) {
      return res.status(500).send('Server missing Asana OAuth env vars')
    }

    // Exchange code → tokens
    const tokenResp = await axios.post('https://app.asana.com/-/oauth_token', new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${appBaseUrl}/api/integrations/asana/oauth-callback`,
      code: code as string,
      code_verifier: verifier,
    }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })

    const { access_token, refresh_token, expires_in } = tokenResp.data

    // Fetch default workspace GID for this user
    const userResp = await axios.get('https://app.asana.com/api/1.0/users/me', {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    const firstWorkspace = userResp.data?.data?.workspaces?.[0]
    const workspaceGid = firstWorkspace?.gid ?? ''

    // Persist via existing integration service
    await integrationService.connectProvider(businessId, 'ASANA', {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresIn: expires_in,
      workspaceGid,
    })

    // Redirect back to dashboard
    const redirectTarget = process.env.DASHBOARD_URL || '/integrations?connected=asana'
    res.redirect(redirectTarget)
  } catch (err: any) {
    console.error('[integrationRoutes] oauth-callback error:', err.response?.data || err.message)
    res.status(500).send('OAuth callback failed')
  }
})

// ======== Existing credential-based endpoints remain below ========

// Connect / update credentials for a provider
router.post('/:provider/connect', authMiddleware, async (req: Request, res: Response) => {
  try {
    const provider = req.params.provider
    const credentials = req.body || {}
    if (!provider) return res.status(400).json({ error: 'Provider is required in path.' })
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' })

    await integrationService.connectProvider(req.user.businessId, provider, credentials)
    res.json({ status: 'connected' })
  } catch (err: any) {
    console.error('[integrationRoutes] connect error:', err)
    res.status(400).json({ error: err.message || 'Failed to connect provider' })
  }
})

// Disconnect provider
router.delete('/:provider', authMiddleware, async (req: Request, res: Response) => {
  try {
    const provider = req.params.provider
    if (!provider) return res.status(400).json({ error: 'Provider is required in path.' })
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' })

    await integrationService.disconnectProvider(req.user.businessId, provider)
    res.json({ status: 'disconnected' })
  } catch (err: any) {
    console.error('[integrationRoutes] disconnect error:', err)
    res.status(400).json({ error: err.message || 'Failed to disconnect provider' })
  }
})

// Get status of all integrations
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' })
    const data = await integrationService.getIntegrationStatus(req.user.businessId)
    res.json({ integrations: data })
  } catch (err: any) {
    console.error('[integrationRoutes] status error:', err)
    res.status(500).json({ error: 'Failed to fetch integrations' })
  }
})

export default router 