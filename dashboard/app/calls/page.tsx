import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"

interface CallRecord {
  id: string
  caller: string
  date: string
  duration: string
  status: "completed" | "missed" | "voicemail"
}

const callRecords: CallRecord[] = [
  { id: "1", caller: "+1 (513) 555-0123", date: "2025-06-12 09:14", duration: "04:32", status: "completed" },
  { id: "2", caller: "+1 (859) 555-0987", date: "2025-06-12 08:03", duration: "02:18", status: "voicemail" },
  { id: "3", caller: "+1 (937) 555-0110", date: "2025-06-11 17:48", duration: "—", status: "missed" },
]

function getStatusBadge(status: CallRecord["status"]) {
  switch (status) {
    case "completed":
      return <Badge className="bg-green-50 text-green-700 border-green-200">Completed</Badge>
    case "missed":
      return <Badge className="bg-red-50 text-red-700 border-red-200">Missed</Badge>
    case "voicemail":
      return <Badge className="bg-yellow-50 text-yellow-700 border-yellow-200">Voicemail</Badge>
    default:
      return null
  }
}

export default function CallHistoryPage() {
  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center justify-between p-6">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
            Call History
          </h1>
          <p className="text-slate-600 mt-1">Review all inbound and outbound calls handled by your AI agent.</p>
        </div>
      </header>

      <main className="flex-1 p-6 overflow-auto">
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
            {callRecords.map((record) => (
              <TableRow key={record.id} className="hover:bg-slate-50">
                <TableCell>{record.caller}</TableCell>
                <TableCell>{record.date}</TableCell>
                <TableCell>{record.duration}</TableCell>
                <TableCell>{getStatusBadge(record.status)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </main>
    </div>
  )
} 