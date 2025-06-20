import { Router, Request, Response } from 'express'
import { authMiddleware } from './authMiddleware'
import { integrationService } from '../services/integrationService'
import { randomUUID } from 'crypto'
import RedisManager from '../config/redis'
import axios from 'axios'
import { generateCodeVerifier, deriveCodeChallenge } from '../utils/pkce'
import { isProviderEnabled, getMissingKeys } from '../config/providerEnv'
import { getAppBaseUrl } from '../utils/env'

const router = Router()

// ======== OAuth 2.0 (Asana) routes ========

/**
 * Step 1 – Initiate OAuth flow (PKCE) for a provider.
 * Redirects the user agent to the provider's authorization URL.
 * Cache {state, code_verifier, businessId} in Redis for 10 minutes.
 */
router.get('/:provider/oauth-start', authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' })
    const provider = req.params.provider.toUpperCase()
    const state = randomUUID()
    const redis = RedisManager.getInstance()
    if (!redis.isClientConnected()) {
      try {
        await redis.connect()
      } catch (redisError) {
        console.error('[OAuth] Redis connection failed:', redisError)
        return res.status(500).json({ error: 'Session storage unavailable. Please try again.' })
      }
    }

    if (provider === 'ASANA') {
      if (!isProviderEnabled('ASANA')) {
        const missing = getMissingKeys('ASANA').join(', ')
        return res.status(500).json({ error: `Asana integration disabled – missing ${missing}` })
      }
      const clientId = process.env.ASANA_CLIENT_ID!
      const appBaseUrl = getAppBaseUrl()
      if (!appBaseUrl) return res.status(500).json({ error: 'Base URL env var missing (APP_BASE_URL or ADMIN_CUSTOM_DOMAIN_URL)' })

      const verifier = generateCodeVerifier()
      const challenge = deriveCodeChallenge(verifier)

      await redis.getClient().setEx(`oauth:${state}`, 600, JSON.stringify({ provider, verifier, businessId: req.user.businessId }))

      const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: `${appBaseUrl}/api/integrations/asana/oauth-callback`,
        state,
        scope: 'users:read workspaces:read tasks:read projects:read',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      })
      return res.redirect(`https://app.asana.com/-/oauth_authorize?${params.toString()}`)
    }

    if (provider === 'MONDAY') {
      if (!isProviderEnabled('MONDAY')) {
        const missing = getMissingKeys('MONDAY').join(', ')
        return res.status(500).json({ error: `Monday integration disabled – missing ${missing}` })
      }
      const clientId = process.env.MONDAY_CLIENT_ID!
      const appBaseUrl = getAppBaseUrl()
      if (!appBaseUrl) return res.status(500).json({ error: 'Base URL env var missing (APP_BASE_URL or ADMIN_CUSTOM_DOMAIN_URL)' })

      await redis.getClient().setEx(`oauth:${state}`, 600, JSON.stringify({ provider, businessId: req.user.businessId }))

      const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: `${appBaseUrl}/api/integrations/monday/oauth-callback`,
        state,
      })
      return res.redirect(`https://auth.monday.com/oauth2/authorize?${params.toString()}`)
    }

    if (provider === 'JIRA') {
      if (!isProviderEnabled('JIRA')) {
        const missing = getMissingKeys('JIRA').join(', ')
        return res.status(500).json({ error: `Jira integration disabled – missing ${missing}` })
      }
      const clientId = process.env.JIRA_CLIENT_ID!
      const appBaseUrl = getAppBaseUrl()
      if (!appBaseUrl) return res.status(500).json({ error: 'Base URL env var missing (APP_BASE_URL or ADMIN_CUSTOM_DOMAIN_URL)' })

      const verifier = generateCodeVerifier()
      const challenge = deriveCodeChallenge(verifier)

      await redis.getClient().setEx(`oauth:${state}`, 600, JSON.stringify({ provider, verifier, businessId: req.user.businessId }))

      const params = new URLSearchParams({
        audience: 'api.atlassian.com',
        client_id: clientId,
        scope: 'read:jira-work read:jira-user offline_access',
        redirect_uri: `${appBaseUrl}/api/integrations/jira/oauth-callback`,
        response_type: 'code',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        prompt: 'consent',
      })
      return res.redirect(`https://auth.atlassian.com/authorize?${params.toString()}`)
    }

    return res.status(400).json({ error: 'Unsupported provider for OAuth' })
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
    const { code, state } = req.query as { code?: string; state?: string }
    if (!code || !state) return res.status(400).send('Missing code or state')

    const redis = RedisManager.getInstance()
    if (!redis.isClientConnected()) {
      try {
        await redis.connect()
      } catch (redisError) {
        console.error('[OAuth Callback] Redis connection failed:', redisError)
        return res.status(500).send('Session storage unavailable. Please try again.')
      }
    }

    const saved = await redis.getClient().get(`oauth:${state}`)
    if (!saved) return res.status(400).send('Invalid or expired state')

    await redis.getClient().del(`oauth:${state}`)
    const savedObj = JSON.parse(saved) as any

    // Use businessId from saved state instead of requiring authenticated user
    const businessId = savedObj.businessId
    if (!businessId) return res.status(400).send('Missing business ID')

    if (provider === 'ASANA') {
      if (!isProviderEnabled('ASANA')) {
        const missing = getMissingKeys('ASANA').join(', ')
        return res.status(500).send(`Asana integration disabled – missing ${missing}`)
      }
      const { verifier } = savedObj
      const clientId = process.env.ASANA_CLIENT_ID!
      const clientSecret = process.env.ASANA_CLIENT_SECRET!
      const appBaseUrl = getAppBaseUrl()
      if (!appBaseUrl) return res.status(500).json({ error: 'Base URL env var missing (APP_BASE_URL or ADMIN_CUSTOM_DOMAIN_URL)' })

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
      return res.redirect(redirectTarget)
    }

    if (provider === 'MONDAY') {
      if (!isProviderEnabled('MONDAY')) {
        const missing = getMissingKeys('MONDAY').join(', ')
        return res.status(500).send(`Monday integration disabled – missing ${missing}`)
      }
      // businessId already extracted above
      const clientId = process.env.MONDAY_CLIENT_ID!
      const clientSecret = process.env.MONDAY_CLIENT_SECRET!
      const appBaseUrl = getAppBaseUrl()
      if (!appBaseUrl) return res.status(500).json({ error: 'Base URL env var missing (APP_BASE_URL or ADMIN_CUSTOM_DOMAIN_URL)' })

      const tokenResp = await axios.post('https://auth.monday.com/oauth2/token', new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code as string,
        redirect_uri: `${appBaseUrl}/api/integrations/monday/oauth-callback`,
      }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })

      const { access_token } = tokenResp.data

      await integrationService.connectProvider(businessId, 'MONDAY', {
        accessToken: access_token,
      })

      const redirectTarget = process.env.DASHBOARD_URL || '/integrations?connected=monday'
      return res.redirect(redirectTarget)
    }

    if (provider === 'JIRA') {
      if (!isProviderEnabled('JIRA')) {
        const missing = getMissingKeys('JIRA').join(', ')
        return res.status(500).send(`Jira integration disabled – missing ${missing}`)
      }
      const { verifier } = savedObj
      const clientId = process.env.JIRA_CLIENT_ID!
      const clientSecret = process.env.JIRA_CLIENT_SECRET!
      const appBaseUrl = getAppBaseUrl()
      if (!appBaseUrl) return res.status(500).json({ error: 'Base URL env var missing (APP_BASE_URL or ADMIN_CUSTOM_DOMAIN_URL)' })

      const tokenResp = await axios.post('https://auth.atlassian.com/oauth/token', {
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: `${appBaseUrl}/api/integrations/jira/oauth-callback`,
        code_verifier: verifier,
      })

      const { access_token } = tokenResp.data

      // Get cloudId
      const resAcc = await axios.get('https://api.atlassian.com/oauth/token/accessible-resources', { headers: { Authorization: `Bearer ${access_token}` } })
      const cloudId = resAcc.data?.[0]?.id
      if (!cloudId) return res.status(500).send('Unable to fetch Jira cloudId')

      await integrationService.connectProvider(businessId, 'JIRA', {
        accessToken: access_token,
        cloudId,
      })

      // Personal Data Reporting: store the current Atlassian accountId we have a token for
      try {
        const meResp = await axios.get('https://api.atlassian.com/me', {
          headers: { Authorization: `Bearer ${access_token}` },
        })
        const accountId = meResp.data?.account_id || meResp.data?.accountId
        if (accountId) {
          const { upsertAtlassianAccount } = await import('../services/atlassianAccountService')
          await upsertAtlassianAccount(businessId, accountId as string)
        }
      } catch (err) {
        console.warn('[integrationRoutes] Failed to fetch Atlassian accountId for PDR:', (err as any).response?.data || err)
      }

      const redirectTarget = process.env.DASHBOARD_URL || '/integrations?connected=jira'
      return res.redirect(redirectTarget)
    }

    return res.status(400).send('Unsupported provider')
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

// Trigger manual sync
router.post('/:provider/sync', authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' })
    const provider = req.params.provider
    const result = await integrationService.syncNow(req.user.businessId, provider)
    res.json({ status: 'ok', ...result })
  } catch (err: any) {
    console.error('[integrationRoutes] syncNow error:', err)
    res.status(500).json({ error: err.message || 'Sync failed' })
  }
})

// Test connectivity (lightweight)
router.post('/:provider/test', authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' })
    const provider = req.params.provider
    const ok = await integrationService.testConnection(req.user.businessId, provider)
    res.json({ ok })
  } catch (err: any) {
    console.error('[integrationRoutes] testConnection error:', err)
    res.status(500).json({ error: err.message || 'Test failed' })
  }
})

// Enable / disable provider notifications
router.patch('/:provider', authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' })
    const provider = req.params.provider
    const { isEnabled } = req.body as { isEnabled?: boolean }
    if (typeof isEnabled !== 'boolean') {
      return res.status(400).json({ error: 'isEnabled boolean required in body' })
    }

    await integrationService.setEnabled(req.user.businessId, provider, isEnabled)
    res.json({ status: 'ok', isEnabled })
  } catch (err: any) {
    console.error('[integrationRoutes] setEnabled error:', err)
    res.status(500).json({ error: err.message || 'Update failed' })
  }
})

export default router 