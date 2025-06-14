"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { BookOpen, Search, Plus, Edit, Trash2, FileText } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

const knowledgeItems = [
  {
    id: 1,
    title: "What services do we offer?",
    category: "Services",
    content:
      "We offer comprehensive branding and design services including logo design, brand identity, website design, print materials, and digital marketing assets.",
    lastUpdated: "2024-01-15",
    usage: 45,
  },
  {
    id: 2,
    title: "What are our pricing ranges?",
    category: "Pricing",
    content:
      "Our projects typically range from $5,000 for basic logo design to $50,000+ for complete brand overhauls. We provide custom quotes based on project scope.",
    lastUpdated: "2024-01-14",
    usage: 32,
  },
  {
    id: 3,
    title: "How long do projects take?",
    category: "Process",
    content:
      "Project timelines vary: Logo design (2-3 weeks), Brand identity (4-6 weeks), Website design (6-12 weeks). We provide detailed timelines in our proposals.",
    lastUpdated: "2024-01-13",
    usage: 28,
  },
  {
    id: 4,
    title: "What is our revision policy?",
    category: "Process",
    content:
      "We include 3 rounds of revisions in all our packages. Additional revisions are available at $150/hour. We work closely with clients to minimize revisions.",
    lastUpdated: "2024-01-12",
    usage: 19,
  },
  {
    id: 5,
    title: "Do we work with international clients?",
    category: "General",
    content:
      "Yes, we work with clients worldwide. We use digital collaboration tools and can accommodate different time zones for meetings and communication.",
    lastUpdated: "2024-01-11",
    usage: 15,
  },
]

const categories = ["All", "Services", "Pricing", "Process", "General"]

export default function KnowledgeBasePage() {
  const { toast } = useToast()
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedCategory, setSelectedCategory] = useState("All")
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [newItem, setNewItem] = useState({
    title: "",
    category: "General",
    content: "",
  })

  const filteredItems = knowledgeItems.filter((item) => {
    const matchesSearch =
      item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.content.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesCategory = selectedCategory === "All" || item.category === selectedCategory
    return matchesSearch && matchesCategory
  })

  const handleAddItem = () => {
    toast({
      title: "Knowledge item added",
      description: "Your new knowledge base item has been created successfully.",
    })
    setIsAddDialogOpen(false)
    setNewItem({ title: "", category: "General", content: "" })
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-gradient-to-br from-green-500 to-green-600 rounded-lg">
              <BookOpen className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Knowledge Base</h1>
              <p className="text-slate-600">Add and manage the information your AI agent uses to answer questions</p>
            </div>
          </div>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Add Article
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Add Knowledge Base Article</DialogTitle>
                <DialogDescription>
                  Create a new article for your AI agent to reference when answering questions.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="title">Question/Title</Label>
                  <Input
                    id="title"
                    placeholder="e.g., What are your payment terms?"
                    value={newItem.title}
                    onChange={(e) => setNewItem({ ...newItem, title: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="category">Category</Label>
                  <select
                    id="category"
                    className="w-full p-2 border border-slate-200 rounded-md"
                    value={newItem.category}
                    onChange={(e) => setNewItem({ ...newItem, category: e.target.value })}
                  >
                    <option value="General">General</option>
                    <option value="Services">Services</option>
                    <option value="Pricing">Pricing</option>
                    <option value="Process">Process</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="content">Answer/Content</Label>
                  <Textarea
                    id="content"
                    rows={6}
                    placeholder="Provide a detailed answer that your AI agent can use..."
                    value={newItem.content}
                    onChange={(e) => setNewItem({ ...newItem, content: e.target.value })}
                  />
                </div>
                <div className="flex justify-end space-x-2">
                  <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleAddItem}>Add Article</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Total Articles</p>
                  <p className="text-2xl font-bold text-slate-900">24</p>
                </div>
                <div className="p-2 bg-green-50 rounded-lg">
                  <FileText className="w-5 h-5 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Categories</p>
                  <p className="text-2xl font-bold text-slate-900">4</p>
                </div>
                <div className="p-2 bg-blue-50 rounded-lg">
                  <BookOpen className="w-5 h-5 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Most Used</p>
                  <p className="text-2xl font-bold text-slate-900">45</p>
                </div>
                <div className="p-2 bg-purple-50 rounded-lg">
                  <Search className="w-5 h-5 text-purple-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Last Updated</p>
                  <p className="text-2xl font-bold text-slate-900">2d</p>
                </div>
                <div className="p-2 bg-orange-50 rounded-lg">
                  <Edit className="w-5 h-5 text-orange-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search and Filter */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
              <div>
                <CardTitle>Knowledge Articles</CardTitle>
                <CardDescription>Manage your AI agent's knowledge base</CardDescription>
              </div>
              <div className="flex gap-2 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-64">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <Input
                    placeholder="Search articles..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* Category Filter */}
        <div className="flex gap-2 flex-wrap">
          {categories.map((category) => (
            <Button
              key={category}
              variant={selectedCategory === category ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedCategory(category)}
            >
              {category}
            </Button>
          ))}
        </div>

        {/* Knowledge Items */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredItems.map((item) => (
            <Card key={item.id} className="hover:shadow-lg transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1 flex-1">
                    <CardTitle className="text-lg">{item.title}</CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs">
                        {item.category}
                      </Badge>
                      <span className="text-xs text-slate-500">Used {item.usage} times</span>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon">
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-slate-600 line-clamp-3">{item.content}</p>
                <div className="flex justify-between items-center text-xs text-slate-500 pt-2 border-t">
                  <span>Last updated: {item.lastUpdated}</span>
                  <Button variant="outline" size="sm">
                    View Full
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
