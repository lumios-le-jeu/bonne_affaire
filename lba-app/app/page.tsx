"use client"

import { useState, useEffect, useRef } from 'react'
import NewSearchForm from '@/components/NewSearchForm'
import TrackedList from '@/components/TrackedList'
import BestSellers from '@/components/BestSellers'

export default function Home() {
  const [refreshKey, setRefreshKey] = useState(0)
  const [scanningIds, setScanningIds] = useState<string[]>([])
  const [scanStartTimes, setScanStartTimes] = useState<Record<string, number>>({})
  const [scanStatus, setScanStatus] = useState<Record<string, { done: boolean; count?: number }>>({})
  const pollRef = useRef<NodeJS.Timeout | null>(null)

  // Lance le polling pour chaque scan en cours
  useEffect(() => {
    if (scanningIds.length === 0) return
    if (pollRef.current) clearInterval(pollRef.current)

    pollRef.current = setInterval(async () => {
      for (const id of scanningIds) {
        if (scanStatus[id]?.done) continue
        try {
          const res = await fetch(`/api/scrape?id=${id}`)
          const data = await res.json()
          const startTime = scanStartTimes[id] || 0

          // Terminé = lastScraped existe ET est postérieur au début du scan ET plus dans la queue
          const lastScrapedTs = data.lastScraped ? new Date(data.lastScraped).getTime() : 0
          const isDone = lastScrapedTs > startTime && !data.inQueue

          if (isDone) {
            setScanStatus(prev => ({ ...prev, [id]: { done: true, count: data.count } }))
            setRefreshKey(prev => prev + 1)
          } else {
            setScanStatus(prev => ({
              ...prev,
              [id]: { ...prev[id], done: false, queuePos: data.queuePosition, inQueue: data.inQueue }
            }))
          }
        } catch { /* ignore */ }
      }

      // Tout terminé ?
      const allDone = scanningIds.every(id => scanStatus[id]?.done)
      if (allDone && pollRef.current) clearInterval(pollRef.current)
    }, 5000)

    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [scanningIds, scanStatus, scanStartTimes])

  // Déclenché par le bouton "Rafraîchir" — scanne toutes les recherches actives
  const handleRefresh = async () => {
    if (scanningIds.length > 0) return

    try {
      const res = await fetch('/api/searches')
      const searches = await res.json()
      const activeSearches = searches.filter((s: any) => s.isTracking)

      if (activeSearches.length === 0) {
        alert("Aucune recherche active à rafraîchir.")
        return
      }

      const now = Date.now()
      const ids: string[] = []
      const times: Record<string, number> = {}
      for (const s of activeSearches) {
        await fetch('/api/scrape', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ searchId: s.id }),
        })
        ids.push(s.id)
        times[s.id] = now
      }

      setScanStatus({})
      setScanStartTimes(times)
      setScanningIds(ids)
    } catch (err) {
      console.error("Erreur refresh:", err)
    }
  }

  // Déclenché depuis NewSearchForm après création d'une nouvelle recherche
  const handleNewSearchAdded = (newId?: string) => {
    setRefreshKey(prev => prev + 1)
    if (newId) {
      const now = Date.now()
      setScanStartTimes(prev => ({ ...prev, [newId]: now }))
      setScanningIds(prev => prev.includes(newId) ? prev : [...prev, newId])
    }
  }

  const isScanning = scanningIds.length > 0
  const doneScanCount = Object.values(scanStatus).filter(s => s.done).length

  return (
    <div className="animate-slide-down">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ margin: 0 }}>LBA-App</h1>
      </div>
      <NewSearchForm onSearchAdded={handleNewSearchAdded} />
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ margin: 0 }}>Éléments suivis 📊</h2>
        <button 
          onClick={handleRefresh} 
          className="btn-success" 
          style={{ fontSize: '0.8rem', minWidth: '160px', position: 'relative', overflow: 'hidden' }}
          disabled={isScanning}
        >
          {isScanning ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: '#4ade80', animation: 'pulse 1s infinite' }} />
              Scan en cours... {doneScanCount}/{scanningIds.length + doneScanCount}
            </span>
          ) : '🔄 Rafraîchir les stats'}
        </button>
      </div>

      {/* Bandeau de statut pendant le scan */}
      {isScanning && (
        <div style={{
          background: 'rgba(99,102,241,0.1)',
          border: '1px solid rgba(99,102,241,0.3)',
          borderRadius: '10px',
          padding: '0.9rem 1.2rem',
          marginBottom: '1.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          fontSize: '0.85rem',
          color: '#c4b5fd'
        }}>
          <span style={{ fontSize: '1.2rem' }}>⏳</span>
          <span>
            Scan en cours (<strong>{scanningIds.length}</strong> recherche{scanningIds.length > 1 ? 's' : ''}) — 
            la page se met à jour automatiquement dès que le scan est terminé.
          </span>
        </div>
      )}

      {/* Notifications de fin de scan */}
      {Object.entries(scanStatus).filter(([, s]) => s.done).map(([id, s]) => (
        <div key={id} style={{
          background: 'rgba(34,197,94,0.1)',
          border: '1px solid rgba(34,197,94,0.3)',
          borderRadius: '8px',
          padding: '0.6rem 1rem',
          marginBottom: '0.5rem',
          color: '#4ade80',
          fontSize: '0.82rem'
        }}>
          ✅ Scan terminé — <strong>{s.count} annonces</strong> enregistrées.
        </div>
      ))}
      
      <TrackedList refreshKey={refreshKey} />
      <BestSellers refreshKey={refreshKey} />
      
      <div style={{ marginTop: '4rem', padding: '1rem', borderTop: '1px solid var(--card-border)', color: '#64748b', fontSize: '0.8rem', textAlign: 'center' }}>
        Pour automatiser, configurez un cron OS pour appeler <code>POST /api/scrape</code> avec l'ID du produit.
      </div>
    </div>
  )
}
