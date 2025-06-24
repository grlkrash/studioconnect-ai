"use client"

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2 } from 'lucide-react'

export default function LoginPage() {
  return (
    <div style={{ padding: '40px', fontFamily: 'Arial, sans-serif' }}>
      <h1>Login Page</h1>
      <p>This is the login page - if you can see this, routing is working!</p>
      <p>Path: /login</p>
      <p>Timestamp: {new Date().toISOString()}</p>
      
      <form style={{ marginTop: '20px' }}>
        <div style={{ marginBottom: '10px' }}>
          <label>Email:</label>
          <input type="email" style={{ marginLeft: '10px', padding: '5px' }} />
        </div>
        <div style={{ marginBottom: '10px' }}>
          <label>Password:</label>
          <input type="password" style={{ marginLeft: '10px', padding: '5px' }} />
        </div>
        <button type="submit" style={{ padding: '10px 20px', marginTop: '10px' }}>
          Login (Test)
        </button>
      </form>
    </div>
  )
} 