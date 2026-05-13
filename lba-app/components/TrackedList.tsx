"use client"

import { useEffect, useState } from 'react'

export interface SearchData {
  id: string
  name: string
  url: string
  isTracking: boolean
  lastScraped: string
  activeListings: number
  avgPrice: number
  minPrice: number
}

export default function TrackedList({ 
  refreshKey,
  scanningIds = [],
  scanStatus = {}
}: { 
  refreshKey: number
  scanningIds?: string[]
  scanStatus?: Record<string, { done: boolean }>
}) {
  const [searches, setSearches] = useState<SearchData[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/searches')
      .then(r => r.json())
      .then(data => {
        setSearches(data)
        setLoading(false)
      })
  }, [refreshKey])

  const handleToggle = async (e: React.MouseEvent, id: string, currentStatus: boolean) => {
    e.preventDefault()
    e.stopPropagation()
    const res = await fetch(`/api/searches/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isTracking: !currentStatus }),
    })
    if (res.ok) {
      setSearches(prev => prev.map(s => s.id === id ? { ...s, isTracking: !currentStatus } : s))
    }
  }

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm('Supprimer cette recherche ?')) return
    const res = await fetch(`/api/searches/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setSearches(prev => prev.filter(s => s.id !== id))
    }
  }

  if (loading) return <div>Chargement de vos cibles...</div>

  return (
    <div className="grid-cards" style={{ marginBottom: '3rem' }}>
      {searches.map(s => {
        const isCurrentlyScanning = scanningIds.includes(s.id) && !scanStatus[s.id]?.done
        const isJustDone = scanningIds.includes(s.id) && scanStatus[s.id]?.done

        return (
        <a href={`/search/${s.id}`} key={s.id} style={{ textDecoration: 'none' }}>
          <div className="glass-panel card-hover" style={{ padding: '1.5rem', cursor: 'pointer', height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, flex: 1, paddingRight: '2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {s.name}
                {isCurrentlyScanning && <span title="Scan en cours" style={{ animation: 'pulse 1s infinite' }}>⏳</span>}
                {isJustDone && <span title="Scan terminé">✅</span>}
              </h3>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <div onClick={(e) => handleToggle(e, s.id, s.isTracking)}>
                  {s.isTracking ? (
                    <span className="badge badge-success" style={{ cursor: 'pointer' }}>Actif</span>
                  ) : (
                    <span className="badge badge-danger" style={{ cursor: 'pointer' }}>En pause</span>
                  )}
                </div>
                <button 
                  onClick={(e) => handleDelete(e, s.id)}
                  style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '50%', width: '24px', height: '24px', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' }}
                  title="Supprimer"
                >
                  ✕
                </button>
              </div>
            </div>
            
            <p style={{ margin: '0 0 1rem 0', fontSize: '0.85rem' }} className="truncate-2-lines">
              {s.url}
            </p>
            
            <div style={{ marginTop: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Prix Moyen</span>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--foreground)' }}>
                  {s.avgPrice} €
                </div>
              </div>
              <div>
                <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Annonces</span>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--foreground)' }}>
                  {s.activeListings}
                </div>
              </div>
            </div>
          </div>
        </a>
        )
      })}
      {searches.length === 0 && (
        <div style={{ gridColumn: '1 / -1', padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
          Aucun produit tracké pour le moment.
        </div>
      )}
    </div>
  )
}
