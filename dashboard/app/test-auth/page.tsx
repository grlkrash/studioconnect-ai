export default function TestAuthPage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Authentication Test Page</h1>
      <p>If you can see this page, authentication is working!</p>
      <p>Path: /test-auth</p>
      <p>Timestamp: {new Date().toISOString()}</p>
    </div>
  )
} 