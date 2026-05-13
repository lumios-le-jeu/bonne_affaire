"use client"

import { useEffect, useState } from 'react'

export interface BestSeller {
  id: string
  name: string
  soldCount: number
  avgDaysToSell: number
  avgPriceSold: number
  fastestSale?: {
    title: string
    price: number
    daysToSell: number
  }
}

export default function BestSellers({ refreshKey }: { refreshKey: number }) {
  const [bestSellers, setBestSellers] = useState<BestSeller[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/best-sellers')
      .then(r => r.json())
      .then(data => {
        setBestSellers(data)
        setLoading(false)
      })
  }, [refreshKey])

  if (loading) return <div>Analyse des ventes...</div>

  return (
    <div style={{ marginTop: '2rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
        <h2 style={{ margin: 0 }}>La Bonne Paye 💰</h2>
        <span className="badge badge-primary">Top Ventes Rapides</span>
      </div>
      
      {bestSellers.length === 0 ? (
        <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
          Pas encore assez de données de ventes pour établir un classement. Laissez tourner le tracker quelques jours !
        </div>
      ) : (
        <div className="grid-cards">
          {bestSellers.map((item, index) => (
            <div key={item.id} className="glass-panel" style={{ padding: '1.5rem', position: 'relative', overflow: 'hidden' }}>
              <div style={{ 
                position: 'absolute', 
                top: 0, 
                right: 0, 
                background: 'var(--primary)', 
                color: 'white', 
                padding: '0.25rem 1rem', 
                borderBottomLeftRadius: '12px',
                fontWeight: 'bold',
                boxShadow: '0 4px 10px rgba(139, 92, 246, 0.5)'
              }}>
                #{index + 1}
              </div>
              
              <h3 style={{ margin: '0 0 1rem 0', paddingRight: '2rem' }}>{item.name}</h3>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Vendus</span>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--foreground)' }}>
                    {item.soldCount}
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Temps moyen</span>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--success)' }}>
                    {item.avgDaysToSell} jours
                  </div>
                </div>
              </div>
              
              {item.fastestSale && (
                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.75rem', borderRadius: '8px', borderLeft: '3px solid var(--success)' }}>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.25rem' }}>Vente record ({item.fastestSale.daysToSell}j)</div>
                  <div style={{ fontSize: '0.9rem', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.fastestSale.title}
                  </div>
                  <div style={{ color: 'var(--success)', fontWeight: 'bold', fontSize: '1.1rem' }}>
                    {item.fastestSale.price} €
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
