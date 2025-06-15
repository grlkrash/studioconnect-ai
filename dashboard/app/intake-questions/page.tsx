"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { MessageSquare, Plus, Edit, Trash2, GripVertical, Play } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useLeadQuestions } from "@/hooks/useLeadQuestions"

const questionTypes = [
  { value: "text", label: "Text Input" },
  { value: "contact", label: "Contact Info" },
  { value: "multiple-choice", label: "Multiple Choice" },
  { value: "yes-no", label: "Yes/No" },
]

export default function IntakeQuestionsPage() {
  const { toast } = useToast()
  const { questions, addQuestion, deleteQuestion, updateQuestion } = useLeadQuestions()
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [newQuestion, setNewQuestion] = useState({
    question: "",
    type: "text",
    required: true,
    followUp: "",
    options: [""],
  })
  const [editingQ, setEditingQ] = useState<{id:string, text:string}|null>(null)

  const handleAddQuestion = async () => {
    await addQuestion({ questionText: newQuestion.question, expectedFormat: 'TEXT', isRequired: newQuestion.required })
    toast({ title: 'Saved', description: 'Question added' })
    setIsAddDialogOpen(false)
    setNewQuestion({ question: '', type: 'text', required: true, followUp: '', options: [''] })
  }

  const handleTestFlow = () => {
    toast({
      title: "Test flow started",
      description: "A test call will be initiated to test your question flow.",
    })
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-gradient-to-br from-red-500 to-red-600 rounded-lg">
              <MessageSquare className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Client Intake Questions</h1>
              <p className="text-slate-600">
                Set up the questions your AI agent will ask to capture client information
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleTestFlow}>
              <Play className="w-4 h-4 mr-2" />
              Test Flow
            </Button>
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Question
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Add New Question</DialogTitle>
                  <DialogDescription>
                    Create a new question for your AI agent to ask potential clients.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="question">Question</Label>
                    <Textarea
                      id="question"
                      placeholder="What question should the AI ask?"
                      value={newQuestion.question}
                      onChange={(e) => setNewQuestion({ ...newQuestion, question: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="type">Question Type</Label>
                      <Select
                        value={newQuestion.type}
                        onValueChange={(value) => setNewQuestion({ ...newQuestion, type: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {questionTypes.map((type) => (
                            <SelectItem key={type.value} value={type.value}>
                              {type.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Required</Label>
                      <div className="flex items-center space-x-2 pt-2">
                        <input
                          type="checkbox"
                          checked={newQuestion.required}
                          onChange={(e) => setNewQuestion({ ...newQuestion, required: e.target.checked })}
                        />
                        <span className="text-sm">This question is required</span>
                      </div>
                    </div>
                  </div>
                  {(newQuestion.type === "multiple-choice" || newQuestion.type === "yes-no") && (
                    <div className="space-y-2">
                      <Label>Options</Label>
                      {newQuestion.options.map((option, index) => (
                        <Input
                          key={index}
                          placeholder={`Option ${index + 1}`}
                          value={option}
                          onChange={(e) => {
                            const newOptions = [...newQuestion.options]
                            newOptions[index] = e.target.value
                            setNewQuestion({ ...newQuestion, options: newOptions })
                          }}
                        />
                      ))}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setNewQuestion({ ...newQuestion, options: [...newQuestion.options, ""] })}
                      >
                        Add Option
                      </Button>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="followUp">Follow-up Response</Label>
                    <Textarea
                      id="followUp"
                      placeholder="What should the AI say after getting the answer?"
                      value={newQuestion.followUp}
                      onChange={(e) => setNewQuestion({ ...newQuestion, followUp: e.target.value })}
                    />
                  </div>
                  <div className="flex justify-end space-x-2">
                    <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleAddQuestion}>Add Question</Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Total Questions</p>
                  <p className="text-2xl font-bold text-slate-900">{questions.length}</p>
                </div>
                <div className="p-2 bg-red-50 rounded-lg">
                  <MessageSquare className="w-5 h-5 text-red-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Required</p>
                  <p className="text-2xl font-bold text-slate-900">{questions.filter((q) => q.required).length}</p>
                </div>
                <div className="p-2 bg-orange-50 rounded-lg">
                  <MessageSquare className="w-5 h-5 text-orange-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">Avg. Completion</p>
                  <p className="text-2xl font-bold text-slate-900">87%</p>
                </div>
                <div className="p-2 bg-green-50 rounded-lg">
                  <MessageSquare className="w-5 h-5 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Question Flow */}
        <Card>
          <CardHeader>
            <CardTitle>Question Flow</CardTitle>
            <CardDescription>
              Drag and drop to reorder questions. Your AI agent will ask these in sequence.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {questions
                .sort((a, b) => a.order - b.order)
                .map((question, index) => (
                  <div key={question.id} className="border border-slate-200 rounded-lg p-4 bg-white">
                    <div className="flex items-start space-x-4">
                      <div className="flex items-center space-x-2">
                        <GripVertical className="w-4 h-4 text-slate-400 cursor-move" />
                        <div className="w-6 h-6 bg-slate-100 rounded-full flex items-center justify-center text-sm font-medium">
                          {index + 1}
                        </div>
                      </div>
                      <div className="flex-1 space-y-2">
                        <div className="flex items-start justify-between">
                          <div className="space-y-1">
                            <h3 className="font-medium text-slate-900">{question.question}</h3>
                            <div className="flex items-center space-x-2">
                              <Badge variant="outline" className="text-xs">
                                {questionTypes.find((t) => t.value === question.type)?.label}
                              </Badge>
                              {question.required && (
                                <Badge variant="secondary" className="text-xs bg-red-50 text-red-700 border-red-200">
                                  Required
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="flex space-x-1">
                            <Button variant="ghost" size="icon" onClick={() => setEditingQ({id:question.id, text:question.questionText})} aria-label="Edit question">
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => deleteQuestion(question.id)} aria-label="Delete question">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>

                        {question.options && (
                          <div className="text-sm text-slate-600">
                            <span className="font-medium">Options: </span>
                            {question.options.join(", ")}
                          </div>
                        )}

                        {question.followUp && (
                          <div className="text-sm text-slate-600 bg-slate-50 rounded p-2">
                            <span className="font-medium">AI Response: </span>"{question.followUp}"
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>

        {/* Preview */}
        <Card>
          <CardHeader>
            <CardTitle>Conversation Preview</CardTitle>
            <CardDescription>Here's how the conversation might flow with a potential client</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 max-h-96 overflow-y-auto">
              <div className="flex items-start space-x-3">
                <div className="w-8 h-8 bg-gradient-to-br from-red-500 to-red-600 rounded-full flex items-center justify-center">
                  <MessageSquare className="w-4 h-4 text-white" />
                </div>
                <div className="bg-slate-100 rounded-lg p-3 max-w-md">
                  <p className="text-sm">
                    Hello! I'm Aurora Assistant from Aurora Branding & Co. I'd love to learn more about your project.
                    What's your name and company?
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-3 justify-end">
                <div className="bg-blue-500 text-white rounded-lg p-3 max-w-md">
                  <p className="text-sm">Hi! I'm Sarah Johnson from TechStart Inc.</p>
                </div>
                <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                  <span className="text-white text-xs font-medium">SJ</span>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <div className="w-8 h-8 bg-gradient-to-br from-red-500 to-red-600 rounded-full flex items-center justify-center">
                  <MessageSquare className="w-4 h-4 text-white" />
                </div>
                <div className="bg-slate-100 rounded-lg p-3 max-w-md">
                  <p className="text-sm">
                    Thank you Sarah! And what's the best way to reach you? Could you share your phone number and email
                    address?
                  </p>
                </div>
              </div>

              <div className="text-center text-sm text-slate-500 py-2">
                ... conversation continues through all {questions.length} questions ...
              </div>
            </div>
          </CardContent>
        </Card>

        {editingQ && (
          <Dialog open onOpenChange={()=>setEditingQ(null)}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Edit Question</DialogTitle>
              </DialogHeader>
              <Textarea value={editingQ.text} onChange={(e)=>setEditingQ({...editingQ, text:e.target.value})} />
              <div className="flex justify-end space-x-2 mt-2">
                <Button variant="outline" onClick={()=>setEditingQ(null)}>Cancel</Button>
                <Button onClick={async()=>{await updateQuestion(editingQ.id,{questionText:editingQ.text});toast({title:'Updated'});setEditingQ(null)}}>Save</Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  )
}
