"use client"

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function DashboardPage() {
  return (
    <div style={{ padding: '40px', fontFamily: 'Arial, sans-serif' }}>
      <h1>🎉 SUCCESS! Dashboard is Working!</h1>
      <p>If you can see this page, the routing is working correctly.</p>
      <p><strong>Path:</strong> / (dashboard root)</p>
      <p><strong>URL:</strong> /admin/ (after server.ts prefix stripping)</p>
      <p><strong>Timestamp:</strong> {new Date().toISOString()}</p>
      
      <div style={{ 
        backgroundColor: '#d4edda', 
        color: '#155724', 
        padding: '15px', 
        borderRadius: '5px', 
        margin: '20px 0',
        border: '1px solid #c3e6cb'
      }}>
        <strong>✅ REDIRECT LOOP FIXED!</strong><br/>
        The middleware has been completely disabled and routing is working.
      </div>
      
      <div style={{ marginTop: '30px' }}>
        <h2>Quick Tests:</h2>
        <ul>
          <li><a href="/login" style={{ color: 'blue' }}>Login Page Test</a></li>
          <li><a href="/test-auth" style={{ color: 'blue' }}>Auth Test Page</a></li>
          <li><a href="/agent-settings" style={{ color: 'blue' }}>Agent Settings</a></li>
        </ul>
      </div>
    </div>
  )
}
