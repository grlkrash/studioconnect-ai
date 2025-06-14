// Lightweight demo script to add a client via prompts
async function handleAddClient() {
  const name = prompt('Client name:')
  if (!name) return
  const email = prompt('Email (optional):')
  const phone = prompt('Phone (optional):')

  try {
    const res = await fetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, phone })
    })

    if (res.ok) {
      location.reload()
    } else {
      const data = await res.json()
      alert(data.error || 'Failed to add client')
    }
  } catch (err) {
    console.error(err)
    alert('Network error')
  }
}

document.getElementById('addClientBtn')?.addEventListener('click', handleAddClient) 