// Demo script to create a new project via prompts
async function handleAddProject() {
  const name = prompt('Project name:')
  if (!name) return
  const clientId = prompt('Client ID (paste from Clients list):')
  if (!clientId) return
  const status = prompt('Status (e.g., active, pending)', 'active')
  const details = prompt('Details (optional):')

  try {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, clientId, status, details })
    })

    if (res.ok) {
      location.reload()
    } else {
      const data = await res.json()
      alert(data.error || 'Failed to add project')
    }
  } catch (err) {
    console.error(err)
    alert('Network error')
  }
}

document.getElementById('addProjectBtn')?.addEventListener('click', handleAddProject) 