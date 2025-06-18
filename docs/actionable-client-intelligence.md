# Actionable Client Intelligence & Scope-Creep Guard – Implementation Guide

> This guide shows how to ship the **minimum-viable, production-ready** version of the new analytics & scope-creep features in ≤ 2 engineering days, using only services that already exist in the code-base.

---

## 0 · Prerequisites

* Node ≥ 20, PNPM & Docker compose
* PostgreSQL already running with pgvector extension (used elsewhere)
* OPENAI
àpi key already present (`process.env.OPENAI_API_KEY`)
* E-mail infra is set up via `notificationService.ts`

---

## 1 · Lightweight Intent Classifier *(adds one extra field per message)*

### 1.1 Add the new `MessageIntent` enum
```ts
// src/types/ai.ts (new)
export type MessageIntent =
  | 'status'        // project status update request
  | 'deadline'      // question about deadlines
  | 'scope_change'  // request that may expand scope / budget
  | 'billing'       // invoices / payments
  | 'greeting'      // small-talk, hello, etc.
  | 'other'         // fallback catch-all
```

### 1.2 Patch **processMessage**

Inside `src/core/aiHandler.ts` _after_ we already fetch GPT-4 for the reply:
```ts
// … existing code …
// STEP ➊ – quick JSON-mode classification (few-shot prompt)
const { choices } = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  response_format: { type: 'json_object' },
  max_tokens: 5,
  messages: [
    { role: 'system', content: 'Return the single best intent label "status | deadline | scope_change | billing | greeting | other" as JSON {"intent":"…"}' },
    { role: 'user',   content: message }
  ]
})

const intent = (JSON.parse(choices[0].message.content).intent ?? 'other') as MessageIntent

// include in the normal return object
return {
  …existingFields,
  intent,
}
```
> ⚠️ **No DB migration** – we just push `intent` into the `conversationHistory` array that already stores `{ role, content }`.  Add the field ad-hoc; existing JSON consumers ignore unknown keys.

---

## 2 · Aggregation Cron Job (nightly)

### 2.1 Prisma schema
```prisma
model DailyInsight {
  id          String   @id @default(uuid())
  businessId  String
  date        DateTime @default(now())
  insights    Json
  @@unique([businessId, date])
  Business    Business @relation(fields: [businessId], references: [id])
}
```
`pnpm prisma migrate dev --name add_daily_insights`

### 2.2 Implementation – `src/monitor/clientInsights.ts`
```ts
import { prisma } from '../services/db'
import { subDays, startOfToday } from 'date-fns'
import { sendInsightsDigest } from '../services/notificationService'

export async function runDailyClientInsights() {
  const since = subDays(startOfToday(), 1)

  const conversations = await prisma.conversation.findMany({
    where: { createdAt: { gte: since } },
    select: { businessId: true, messages: true },
  })

  const grouped = new Map<string, Record<string, number>>()

  for (const { businessId, messages } of conversations) {
    const tally = grouped.get(businessId) ?? {}
    for (const msg of messages as any[]) {
      if (msg.intent) tally[msg.intent] = (tally[msg.intent] ?? 0) + 1
    }
    grouped.set(businessId, tally)
  }

  for (const [businessId, tally] of grouped) {
    const payload = { topIntents: Object.entries(tally).sort((a,b)=>b[1]-a[1]).slice(0,5) }

    await prisma.dailyInsight.upsert({
      where: { businessId_date: { businessId, date: startOfToday() } },
      update: { insights: payload },
      create: { businessId, insights: payload },
    })

    await sendInsightsDigest(businessId, payload)
  }
}
```
### 2.3 Schedule
Add to `src/monitor/cron.ts`:
```ts
import { runDailyClientInsights } from './clientInsights'
// … existing jobs …
cron.schedule('0 3 * * *', () => runDailyClientInsights()) // 03:00 server time
```

---

## 3 · Daily Digest Email

Extend `notificationService.ts`:
```ts
export async function sendInsightsDigest(businessId: string, insights: any) {
  const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true, notificationEmails: true } })
  if (!biz?.notificationEmails?.length) return

  const html = `<h3>${biz.name} – Client Insights (yesterday)</h3>`+
    insights.topIntents.map((i:any)=>`<p><b>${i.intent}</b>: ${i.count}</p>`).join('')

  await transporter.sendMail({
    to: biz.notificationEmails as any,
    subject: '📈 StudioConnectAI – Daily Client Insights',
    html,
  })
}
```

---

## 4 · Real-Time Scope-Creep Alerts

Inside **realtimeAgentService.flushAudioQueue** (after we call `processMessage`):
```ts
if (response.intent === 'scope_change') {
  await notificationService.sendInstantAlert({
    businessId: state.businessId!,
    type: 'SCOPE_ALERT',
    message: `⚠️ Scope-creep request from ${state.fromNumber}: "${transcript.slice(0,120)}…"`,
  })
}
```
*Implementation of `sendInstantAlert` can mirror the existing SMS/e-mail helpers.*

---

## 5 · (Opt-In) Project Scope Guard

### 5.1 Prisma change
```prisma
model Project {
  …existingFields
  scopeSummary  String?  // short text description of agreed scope
  vectorScope   Vector?  @db.Vector(1536)
}
```
Fill `vectorScope` once at project creation with `openai.embeddings.create`.

### 5.2 Utility
```ts
export async function isInScope(projectId: string, query: string): Promise<boolean> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { vectorScope: true } })
  if (!project?.vectorScope) return true // no guard

  const [{ embedding }] = await openai.embeddings.create({ model: 'text-embedding-3-small', input: query })
  const [{ similarity }] = await prisma.$queryRawUnsafe<any[]>('
    SELECT 1 - (dot_product($1, vectorScope) / (||$1|| * ||vectorScope||)) AS similarity FROM "Project" WHERE id = $2',
    embedding, projectId)

  return similarity >= 0.25 // <0.25 means "far" ⇒ out of scope
}
```
Call `isInScope` inside the same block as §4; if `false`, trigger the scope alert.

---

## 6 · Deployment Steps
1. `pnpm prisma migrate deploy`
2. Restart API containers so cron job is registered.
3. Verify e-mail deliverability by tailing logs.
4. Smoke-test: place a call, say "Can you add two extra pages to the website?" – should trigger alert.

---

## 7 · Future Upgrades

| Upgrade | Benefit | Effort |
|---------|---------|--------|
| **Replace OpenAI classifier with a fine-tuned DistilBERT running in-house** | Cut per-message cost ~90 % | 3 days |
| Push `dailyInsight` rows into Supabase Realtime → dashboard chart on `/dashboard/analytics` | Live UI without polling e-mail | 1 day (front-end) |
| Slack / Teams webhooks in `sendInstantAlert` | Alerts where PMs actually live | 0.5 day |
| Per-business custom intent labels via dashboard settings | Tailored insights | 2 days |
| Multi-lingual classifier (OpenAI or NLLB) | Support global agencies | 1 week |
| Streaming ClickHouse for sub-minute analytics | Infinite scale | TBD |

---

## 8 · Appendix – Testing Snippets

```bash
# manual trigger of cron after seeding some conversations
node -e "require('./dist/monitor/clientInsights').runDailyClientInsights()"
```

```ts
// Jest unit test for the intent classifier
it('detects scope creep', async () => {
  const { intent } = await processMessage({
    message: 'We decided we also need a mobile app in addition to the site',
    conversationHistory: [],
    // …args
  })
  expect(intent).toBe('scope_change')
})
```

Happy shipping! 🚀 