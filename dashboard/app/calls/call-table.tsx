"use client"

import { useState } from "react"
import { CallLog } from "@prisma/client"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Search } from "lucide-react"

interface Props {
  calls: CallLog[]
}

function getStatusBadge(status: CallLog["status"]) {
  switch (status) {
    case "COMPLETED":
      return <Badge className="bg-green-50 text-green-700 border-green-200">Completed</Badge>
    case "NO_ANSWER":
    case "BUSY":
    case "FAILED":
      return <Badge className="bg-red-50 text-red-700 border-red-200">{status.replace("_", " ")}</Badge>
    case "IN_PROGRESS":
      return <Badge className="bg-yellow-50 text-yellow-700 border-yellow-200">In-Progress</Badge>
    default:
      return <Badge variant="secondary">{status}</Badge>
  }
}

export default function CallTable({ calls }: Props) {
  const [search, setSearch] = useState("")

  const filtered = calls.filter((c) =>
    `${c.from} ${c.to}`.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-4">
      <div className="relative w-full sm:w-64">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
        <Input
          placeholder="Search number…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-48">Caller</TableHead>
            <TableHead className="w-48">Date & Time</TableHead>
            <TableHead className="w-32">Duration</TableHead>
            <TableHead className="w-32">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((call) => (
            <TableRow key={call.id} className="hover:bg-slate-50">
              <TableCell>{call.from}</TableCell>
              <TableCell>{new Date(call.createdAt).toLocaleString()}</TableCell>
              <TableCell>
                {call.metadata && (call.metadata as any).duration
                  ? (call.metadata as any).duration
                  : "—"}
              </TableCell>
              <TableCell>{getStatusBadge(call.status)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
} 