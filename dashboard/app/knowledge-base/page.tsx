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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { BookOpen, Search, Plus, Edit, Trash2, FileText, Upload, FolderOpen } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useKnowledgeBase } from "@/hooks/useKnowledgeBase"
import { useKnowledgeStats } from "@/hooks/useKnowledgeBase"

const categories = ["All", "Services", "Pricing", "Process", "General"]

export default function KnowledgeBasePage() {
  const { toast } = useToast()
  const { entries, projects, addText, uploadFile, deleteEntry, updateEntry } = useKnowledgeBase()
  const { categories: categoryCount, mostUsed } = useKnowledgeStats(entries)
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedCategory, setSelectedCategory] = useState("All")
  const [selectedProject, setSelectedProject] = useState("All")
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false)
  const [newItem, setNewItem] = useState({
    title: "",
    category: "General",
    content: "",
    projectId: "",
  })
  const [uploadData, setUploadData] = useState({
    file: null as File | null,
    projectId: "",
  })
  const [editing, setEditing] = useState<{id:string, content:string}|null>(null)

  const filteredItems = entries.filter((item) => {
    const matchesSearch =
      (item.title ?? "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.content.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesCategory = selectedCategory === "All" || item.category === selectedCategory
    const matchesProject = selectedProject === "All" || item.projectId === selectedProject
    return matchesSearch && matchesCategory && matchesProject
  })

  const handleAddItem = async () => {
    try {
      const payload = {
        content: `${newItem.title}\n${newItem.content}`,
        metadata: { category: newItem.category },
        projectId: newItem.projectId || undefined,
      }
      await addText(payload)
      toast({ title: 'Saved', description: 'Article added successfully' })
      setIsAddDialogOpen(false)
      setNewItem({ title: "", category: "General", content: "", projectId: "" })
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Could not add article', variant: 'destructive' })
    }
  }

  const handleFileUpload = async () => {
    if (!uploadData.file) return
    
    try {
      await uploadFile(uploadData.file, uploadData.projectId || undefined)
      toast({ title: 'Uploaded', description: `${uploadData.file.name} uploaded successfully` })
      setIsUploadDialogOpen(false)
      setUploadData({ file: null, projectId: "" })
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Upload failed', variant: 'destructive' })
    }
  }

  const projectOptions = [
    { id: "All", name: "All Projects" },
    { id: "", name: "General Knowledge (No Project)" },
    ...projects.map(project => ({
      id: project.id,
      name: `${project.name} (${project.client.name})`
    }))
  ]

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
          <div className="flex gap-2">
            <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Upload className="w-4 h-4 mr-2" />
                  Upload File
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Upload Knowledge File</DialogTitle>
                  <DialogDescription>
                    Upload PDF or text files to add to your knowledge base. Optionally associate with a project.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="file-upload">File</Label>
                    <Input
                      id="file-upload"
                      type="file"
                      accept=".pdf,.txt"
                      onChange={(e) => setUploadData({ ...uploadData, file: e.target.files?.[0] || null })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="upload-project">Project (Optional)</Label>
                    <Select value={uploadData.projectId} onValueChange={(value) => setUploadData({ ...uploadData, projectId: value })}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a project or leave blank for general knowledge" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">General Knowledge (No Project)</SelectItem>
                        {projects.map((project) => (
                          <SelectItem key={project.id} value={project.id}>
                            {project.name} ({project.client.name})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex justify-end space-x-2">
                    <Button variant="outline" onClick={() => setIsUploadDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleFileUpload} disabled={!uploadData.file}>
                      Upload File
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
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
                    <Label htmlFor="project">Project (Optional)</Label>
                    <Select value={newItem.projectId} onValueChange={(value) => setNewItem({ ...newItem, projectId: value })}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a project or leave blank for general knowledge" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">General Knowledge (No Project)</SelectItem>
                        {projects.map((project) => (
                          <SelectItem key={project.id} value={project.id}>
                            {project.name} ({project.client.name})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Total Articles</p>
                  <p className="text-2xl font-bold text-slate-900">{entries.length}</p>
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
                  <p className="text-2xl font-bold text-slate-900">{categoryCount}</p>
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
                  <p className="text-sm text-slate-600">Projects</p>
                  <p className="text-2xl font-bold text-slate-900">{projects.length}</p>
                </div>
                <div className="p-2 bg-purple-50 rounded-lg">
                  <FolderOpen className="w-5 h-5 text-purple-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Most Used</p>
                  <p className="text-2xl font-bold text-slate-900">{mostUsed}</p>
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
                <Select value={selectedProject} onValueChange={setSelectedProject}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {projectOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary" className="text-xs">
                        {item.category ?? "Uncategorized"}
                      </Badge>
                      {item.project && (
                        <Badge variant="outline" className="text-xs">
                          <FolderOpen className="w-3 h-3 mr-1" />
                          {item.project.name}
                        </Badge>
                      )}
                      <span className="text-xs text-slate-500">Used {item.usage ?? 0} times</span>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => setEditing({id:item.id, content:item.content})} aria-label="Edit">
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteEntry(item.id)} aria-label="Delete">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-slate-600 line-clamp-3">{item.content}</p>
                <div className="flex justify-between items-center text-xs text-slate-500 pt-2 border-t">
                  <span>Last updated: {item.lastUpdated ?? item.updatedAt}</span>
                  <Button variant="outline" size="sm">
                    View Full
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {filteredItems.length === 0 && (
          <Card>
            <CardContent className="p-8">
              <div className="text-center">
                <BookOpen className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-slate-900 mb-2">No knowledge articles found</h3>
                <p className="text-slate-500 mb-4">
                  {searchTerm || selectedCategory !== "All" || selectedProject !== "All"
                    ? "No articles match your search criteria." 
                    : "Create your first knowledge article to get started."}
                </p>
                {!searchTerm && selectedCategory === "All" && selectedProject === "All" && (
                  <Button onClick={() => setIsAddDialogOpen(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Article
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Edit Dialog */}
        {editing && (
          <Dialog open onOpenChange={() => setEditing(null)}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Edit Article</DialogTitle>
              </DialogHeader>
              <Textarea
                value={editing.content}
                onChange={(e)=>setEditing({...editing, content:e.target.value})}
                rows={10}
              />
              <div className="flex justify-end space-x-2 mt-2">
                <Button variant="outline" onClick={()=>setEditing(null)}>Cancel</Button>
                <Button onClick={async ()=>{
                  await updateEntry(editing.id, editing.content)
                  toast({title:'Updated'})
                  setEditing(null)
                }}>Save</Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  )
}
