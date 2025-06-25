"use client"

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function DashboardPage() {
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const router = useRouter()

  useEffect(() => {
    fetchUser()
  }, [])

  const fetchUser = async () => {
    try {
      const response = await fetch('/api/auth/me', { credentials: 'include' })
      if (response.ok) {
        const userData = await response.json()
        setUser(userData)
      } else {
        setError('Failed to fetch user data')
      }
    } catch (err) {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      })
      router.push('/login')
      router.refresh()
    } catch (error) {
      console.error('Logout error:', error)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '40px', fontFamily: 'Arial, sans-serif' }}>
        <h1>Loading Dashboard...</h1>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: '40px', fontFamily: 'Arial, sans-serif' }}>
        <h1>Error: {error}</h1>
        <button onClick={() => router.push('/login')} style={{ padding: '10px 20px', marginTop: '10px' }}>
          Go to Login
        </button>
      </div>
    )
  }

  return (
    <div style={{ padding: '40px', fontFamily: 'Arial, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <h1>StudioConnect AI Dashboard</h1>
        <button 
          onClick={handleLogout}
          style={{ 
            padding: '8px 16px', 
            backgroundColor: '#dc3545', 
            color: 'white', 
            border: 'none', 
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Logout
        </button>
      </div>
      
      {user && (
        <div style={{ backgroundColor: '#f8f9fa', padding: '20px', borderRadius: '8px', marginBottom: '20px' }}>
          <h2>Welcome!</h2>
          <p><strong>Business:</strong> {user.business?.name || 'Unknown'}</p>
          <p><strong>Email:</strong> {user.email || 'Unknown'}</p>
          <p><strong>Role:</strong> {user.role || 'Unknown'}</p>
          <p><strong>Business ID:</strong> {user.business?.id || 'Unknown'}</p>
        </div>
      )}
      
      <div style={{ marginTop: '20px' }}>
        <h2>Quick Navigation:</h2>
        <ul>
          <li><a href="/agent-settings" style={{ color: 'blue' }}>Agent Settings</a></li>
          <li><a href="/analytics" style={{ color: 'blue' }}>Analytics</a></li>
          <li><a href="/calls" style={{ color: 'blue' }}>Call History</a></li>
          <li><a href="/clients" style={{ color: 'blue' }}>Clients</a></li>
          <li><a href="/knowledge-base" style={{ color: 'blue' }}>Knowledge Base</a></li>
        </ul>
      </div>
      
      <div style={{ marginTop: '30px', fontSize: '12px', color: '#666' }}>
        <p>Path: / (dashboard root)</p>
        <p>Timestamp: {new Date().toISOString()}</p>
        <p>Authentication: ✅ Working</p>
      </div>
    </div>
  )
}
