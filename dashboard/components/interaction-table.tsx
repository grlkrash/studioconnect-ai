import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Search, Phone, MessageCircle } from "lucide-react"

interface Interaction {
  id: string
  type: "voice" | "chat"
  from: string
  client?: string | null
  date: Date | string
  duration?: string | number | null
  status?: string | null
  conversationId: string
}

interface Props {
  interactions: Interaction[]
}

function getTypeBadge(type: Interaction["type"]) {
  return type === "voice" ? (
    <Badge className="bg-purple-50 text-purple-700 border-purple-200 flex items-center gap-1">
      <Phone className="w-3 h-3" /> Voice
    </Badge>
  ) : (
    <Badge className="bg-blue-50 text-blue-700 border-blue-200 flex items-center gap-1">
      <MessageCircle className="w-3 h-3" /> Chat
    </Badge>
  )
}

export default function InteractionTable({ interactions }: Props) {
  const [search, setSearch] = useState("")

  const filtered = interactions.filter((i) =>
    `${i.from} ${i.client ?? ""}`.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-4">
      <div className="relative w-full sm:w-64">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
        <Input
          placeholder="Search number or client…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24">Type</TableHead>
            <TableHead className="w-48">Caller</TableHead>
            <TableHead className="w-56">Client</TableHead>
            <TableHead className="w-48">Date & Time</TableHead>
            <TableHead className="w-32">Duration</TableHead>
            <TableHead className="w-32">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((item) => (
            <TableRow
              key={item.id}
              className="hover:bg-slate-50 cursor-pointer"
              onClick={() => {
                if (typeof window !== "undefined") {
                  window.location.href = `/interactions/${item.conversationId}`
                }
              }}
            >
              <TableCell>{getTypeBadge(item.type)}</TableCell>
              <TableCell>{item.from}</TableCell>
              <TableCell>{item.client ?? "—"}</TableCell>
              <TableCell>{new Date(item.date).toLocaleString()}</TableCell>
              <TableCell>{item.duration ?? "—"}</TableCell>
              <TableCell className="text-sky-600 underline">View</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
} 