import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

interface FeedItem {
  id: string
  type: 'NEW_LEAD' | 'SCOPE_CREEP'
  title: string
  summary: string
  riskTags?: string[]
  projectId?: string | null
}

export function AlertCard({ item }: { item: FeedItem }) {
  const tags = item.type === 'SCOPE_CREEP'
    ? [...(item.riskTags ?? []), '⚠️ Scope Creep Risk']
    : [...(item.riskTags ?? []), '🆕 New Lead']

  return (
    <Card>
      <CardHeader>
        <CardTitle>{item.title}</CardTitle>
        <p className="text-sm text-muted-foreground break-words whitespace-pre-wrap">{item.summary}</p>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {tags.map(tag => (
          <Badge key={tag} variant="secondary">
            {tag}
          </Badge>
        ))}
      </CardContent>
    </Card>
  )
} 