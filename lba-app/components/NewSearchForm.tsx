"use client"

import { useState } from 'react'

export default function NewSearchForm({ onSearchAdded }: { onSearchAdded: (newId?: string) => void }) {
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccess('')

    try {
      const res = await fetch('/api/searches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, name })
      })
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || 'Erreur lors de la création')
      }

      const data = await res.json()
      const newId: string = data.id

      // Déclencher le scan initial via /api/scrape
      await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searchId: newId }),
      })

      setUrl('')
      setName('')
      setSuccess('✅ Recherche ajoutée ! Scan en cours...')
      onSearchAdded(newId) // passe l'ID pour que le parent puisse poller
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem' }}>
      <h2>Tracker un nouveau produit</h2>
      <p style={{ marginBottom: '1.5rem' }}>Entrez l'URL d'une recherche Leboncoin avec les filtres désirés.</p>
      
      {error && <div className="badge badge-danger" style={{ marginBottom: '1rem', display: 'block' }}>{error}</div>}
      {success && <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)', borderRadius: '8px', color: '#4ade80', fontSize: '0.9rem' }}>{success}</div>}
      
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '1rem' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500, color: 'var(--foreground)' }}>Nom de la recherche (ex: Mac Mini M4 Nord)</label>
          <input 
            type="text" 
            required 
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="glass-input" 
            style={{ width: '100%' }}
            placeholder="Nom personnalisé"
          />
        </div>
        
        <div>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500, color: 'var(--foreground)' }}>URL de recherche Leboncoin</label>
          <input 
            type="url" 
            required 
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="glass-input" 
            style={{ width: '100%' }}
            placeholder="https://www.leboncoin.fr/recherche?text=Apple%20Mac%20mini%20M4..."
          />
        </div>
        
        <button type="submit" disabled={loading} className="btn-primary" style={{ justifySelf: 'start', marginTop: '0.5rem' }}>
          {loading ? 'Création en cours...' : 'Lancer le Tracking 🎯'}
        </button>
      </form>
    </div>
  )
}
