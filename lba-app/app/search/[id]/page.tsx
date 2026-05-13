"use client"

import { useEffect, useState, use, useRef } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale,
  Filler,
} from 'chart.js'
import { Line, getElementAtEvent } from 'react-chartjs-2'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale,
  Filler,
)

export default function SearchDetail({ params }: { params: Promise<{ id: string }> }) {
  const unwrappedParams = use(params);
  const { id } = unwrappedParams;
  
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Date Filters
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const chartRef = useRef<any>(null)
  const modalChartRef = useRef<any>(null)

  const onChartClick = (event: React.MouseEvent<HTMLCanvasElement>, ref: any) => {
    if (!ref.current) return
    const elements = getElementAtEvent(ref.current, event)
    if (elements.length > 0) {
      const { datasetIndex, index } = elements[0]
      // Only handle clicks on the "Annonces individuelles" dataset
      if (datasetIndex === 1) { 
        const point = trendData.datasets[datasetIndex].data[index] as any
        if (point && point.url) {
          window.open(point.url, '_blank')
        }
      }
    }
  }

  const updateListingStatus = async (listingId: string, newStatus: string) => {
    if (newStatus === 'excluded' && !confirm('Exclure cette annonce des résultats et des statistiques ?')) return
    
    try {
      const res = await fetch(`/api/listings/${listingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      })
      
      if (res.ok) {
        setData((prev: any) => ({
          ...prev,
          listings: prev.listings.map((l: any) => 
            l.id === listingId ? { ...l, status: newStatus } : l
          )
        }))
      }
    } catch (err) {
      console.error(`Failed to update status to ${newStatus}:`, err)
    }
  }

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch(`/api/searches/${id}`)
        if (!res.ok) {
           const errText = await res.text()
           throw new Error(`API returned ${res.status}: ${errText}`)
        }
        const d = await res.json()
        setData(d)
        
        // Default filter: Last month to Tomorrow (to be inclusive of today's new items)
        const lastMonth = new Date()
        lastMonth.setDate(lastMonth.getDate() - 30)
        const tomorrow = new Date()
        tomorrow.setDate(tomorrow.getDate() + 1)
        
        setStartDate(lastMonth.toISOString().split('T')[0])
        setEndDate(tomorrow.toISOString().split('T')[0])

      } catch (err: any) {
        console.error('Failed to load search data:', err)
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    
    fetchData()
  }, [id])

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsModalOpen(false)
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [])

  if (loading) return (
    <div style={{ padding: '4rem', textAlign: 'center' }}>
       <div className="animate-spin" style={{ fontSize: '2rem', marginBottom: '1rem' }}>⌛</div>
       Chargement de l'analyse...
    </div>
  )
  
  if (error) return (
    <div style={{ padding: '4rem', textAlign: 'center' }}>
       <h2 style={{ color: 'var(--danger)' }}>Erreur d'Analyse</h2>
       <p>{error}</p>
       <a href="/" className="btn-primary" style={{ marginTop: '2rem', display: 'inline-block', textDecoration: 'none' }}>Retour au Dashboard</a>
    </div>
  )

  if (!data) return <div style={{ padding: '2rem', textAlign: 'center' }}>Aucune donnée disponible.</div>

  // Filtering Logic
  const start = startDate ? new Date(startDate) : new Date(0)
  const end = endDate ? new Date(endDate) : new Date()
  end.setHours(23, 59, 59, 999)

  // Snapshots Deduplication & Filtering
  const snapshotMap = new Map()
  data.snapshots.forEach((s: any) => {
    const dateStr = new Date(s.date).toLocaleDateString()
    const d = new Date(s.date)
    if (d >= start && d <= end) {
      snapshotMap.set(dateStr, s) // Keep the last one for the day
    }
  })
  const filteredSnapshots = Array.from(snapshotMap.values()).sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime())

  // Average Price trend from snapshots
  // Aggregate ALL unique dates from snapshots, listings, and history to ensure no points are missing
  const dateSet = new Set<string>()
  filteredSnapshots.forEach((s: any) => dateSet.add(new Date(s.date).toLocaleDateString('fr-FR')))
  data.listings.forEach((l: any) => {
    if (l.status === 'excluded') return
    dateSet.add(new Date(l.firstSeen).toLocaleDateString('fr-FR'))
    if (l.history) {
      l.history.forEach((h: any) => dateSet.add(new Date(h.date).toLocaleDateString('fr-FR')))
    }
  })

  // Sort labels chronologically
  const labels = Array.from(dateSet).sort((a, b) => {
    const [da, ma, ya] = a.split('/').map(Number)
    const [db, mb, yb] = b.split('/').map(Number)
    return new Date(ya, ma - 1, da).getTime() - new Date(yb, mb - 1, db).getTime()
  })
  
  const MAX_PRICE_THRESHOLD = 50000 // Defensive filter for the UI (safe for most items)
  
  const allListingPoints = data.listings
    .filter((l: any) => l.status !== 'excluded' && l.price < MAX_PRICE_THRESHOLD)
    .flatMap((l: any) => {
      const url = l.url || `https://www.leboncoin.fr/ad/${l.id}`
      const points = [{ x: new Date(l.firstSeen).toLocaleDateString('fr-FR'), y: l.price, url }]
      if (l.history) {
        l.history.forEach((h: any) => {
          if (h.price < MAX_PRICE_THRESHOLD) {
            points.push({ x: new Date(h.date).toLocaleDateString('fr-FR'), y: h.price, url })
          }
        })
      }
      return points
    })
    .filter((p: any) => labels.includes(p.x))

  const trendData = {
    labels: labels,
    datasets: [
      {
        label: 'Prix Moyen (€)',
        data: labels.map(label => {
          const snap = filteredSnapshots.find((s: any) => new Date(s.date).toLocaleDateString('fr-FR') === label)
          return snap && snap.avgPrice < MAX_PRICE_THRESHOLD ? snap.avgPrice : null
        }),
        borderColor: 'rgba(99, 102, 241, 1)',
        backgroundColor: 'rgba(99, 102, 241, 0.1)',
        borderWidth: 3,
        tension: 0.4,
        fill: true,
        pointRadius: 6,
        pointBackgroundColor: 'rgba(99, 102, 241, 1)',
        pointBorderColor: 'white',
        pointBorderWidth: 2,
        pointHoverRadius: 8,
        zIndex: 10
      },
      {
        label: 'Toutes les annonces',
        data: allListingPoints,
        backgroundColor: 'rgba(234, 179, 8, 0.4)',
        borderColor: 'rgba(234, 179, 8, 0.6)',
        borderWidth: 1,
        pointRadius: 4,
        pointHoverRadius: 6,
        showLine: false,
        type: 'line' as const
      },
      // Individual listing price histories
      ...data.listings
        .filter((l: any) => (l.status === 'active' || l.status === 'sold') && l.history && l.history.length > 1)
        .slice(0, 5)
        .map((l: any, idx: number) => {
           // Only history points within date range
           const points = l.history.filter((h: any) => {
              const d = new Date(h.date)
              return d >= start && d <= end
           })
           return {
              label: `${l.title.substring(0, 15)}...`,
              data: points.map((h: any) => h.price),
              borderColor: `hsl(${idx * 70}, 70%, 50%)`,
              borderWidth: 2,
              borderDash: [5, 5],
              tension: 0.1,
              hidden: true
           }
        })
    ]
  }

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom' as const, labels: { color: '#94a3b8', boxWidth: 10 } },
      tooltip: { mode: 'index' as const, intersect: false }
    },
    onHover: (event: any, chartElement: any) => {
      // datasetIndex 1 is "Toutes les annonces"
      event.native.target.style.cursor = chartElement[0]?.datasetIndex === 1 ? 'pointer' : 'default';
    },
    scales: {
      y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b' } },
      x: { grid: { display: false }, ticks: { color: '#64748b' } }
    }
  }

  // Active listings (non-excluded, seen in range)
  const activeListings = data.listings.filter((l: any) => 
    l.status === 'active' && 
    new Date(l.firstSeen) <= end && 
    (!startDate || new Date(l.lastSeen) >= start)
  )

  // Sold listings (sold in range)
  const soldListings = data.listings.filter((l: any) => 
    l.status === 'sold' && 
    l.soldAt && 
    new Date(l.soldAt) >= start && 
    new Date(l.soldAt) <= end
  )

  const excludedListings = data.listings.filter((l: any) => l.status === 'excluded')
  
  // Statistical Calculations for filtered data
  const prices = activeListings.map((l: any) => l.price).sort((a: number, b: number) => a - b)
  const min = prices[0] || 0
  const max = prices[prices.length - 1] || 0
  const median = prices[Math.floor(prices.length / 2)] || 0
  const q1 = prices[Math.floor(prices.length * 0.25)] || 0
  const q3 = prices[Math.floor(prices.length * 0.75)] || 0
  const avg = prices.length > 0 ? Math.round(prices.reduce((a: number, b: number) => a + b, 0) / prices.length) : 0
  
  const ListingCard = ({ l, type }: { l: any, type: 'active' | 'sold' | 'excluded' }) => (
    <div key={l.id} className="glass-panel" style={{ padding: '1.25rem', display: 'flex', gap: '1.25rem', alignItems: 'center', opacity: type === 'active' ? 1 : 0.7 }}>
      {l.thumb ? (
        <img src={l.thumb} alt={l.title} style={{ width: '100px', height: '100px', objectFit: 'cover', borderRadius: '8px' }} />
      ) : (
        <div style={{ width: '100px', height: '100px', background: 'var(--background)', borderRadius: '8px', display: 'grid', placeItems: 'center', color: '#64748b' }}>No Img</div>
      )}
      
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <h4 style={{ margin: 0, fontSize: '1rem' }}>{l.title}</h4>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: l.isGoodDeal && type === 'active' ? 'var(--success)' : 'var(--foreground)' }}>
            {l.price} €
          </div>
        </div>
        
        <p style={{ margin: '0.25rem 0 0.75rem 0', fontSize: '0.8rem', color: '#94a3b8' }}>{l.location}</p>
        
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {l.isGoodDeal && type === 'active' && <span className="badge badge-success">Top Deal 🔥</span>}
          {l.missingCount > 0 && type === 'active' && (
            <span className="badge" style={{ background: 'rgba(234, 179, 8, 0.2)', color: '#eab308', border: '1px solid #eab308' }}>
              Absent du scan ({l.missingCount}x) - 
              {Math.round((new Date().getTime() - new Date(l.lastSeen).getTime()) / (1000 * 60 * 60 * 24))} j.
            </span>
          )}
          {type === 'sold' && <span style={{fontSize: '0.75rem', color: 'var(--success)'}}>Vendu en {l.daysToSell} j.</span>}
          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Vu le {new Date(l.firstSeen).toLocaleDateString()}</span>
          
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            {type === 'active' ? (
              <button onClick={() => updateListingStatus(l.id, 'excluded')} className="btn-secondary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', opacity: 0.6 }}>Exclure</button>
            ) : type === 'excluded' ? (
              <button onClick={() => updateListingStatus(l.id, 'active')} className="btn-secondary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}>Ré-inclure</button>
            ) : null}
            <a href={l.url || `https://www.leboncoin.fr/ad/${l.id}`} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', textDecoration: 'none', fontSize: '0.85rem' }}>Voir</a>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="animate-slide-down">
      <a href="/" style={{ color: 'var(--primary)', textDecoration: 'none', marginBottom: '2rem', display: 'inline-block' }}>
        ← Retour au Dashboard
      </a>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ margin: 0 }}>{data.name}</h1>
        <a href={data.url} target="_blank" rel="noreferrer" className="btn-primary" style={{ textDecoration: 'none' }}>
          Ouvrir Leboncoin
        </a>
      </div>

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1.5rem', background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '12px' }}>
         <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
           <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Du</span>
           <input 
             type="date" 
             value={startDate} 
             onChange={(e) => setStartDate(e.target.value)}
             style={{ background: 'var(--background)', color: 'white', border: '1px solid rgba(255,255,255,0.1)', padding: '0.4rem', borderRadius: '6px' }}
           />
         </div>
         <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
           <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Au</span>
           <input 
             type="date" 
             value={endDate} 
             onChange={(e) => setEndDate(e.target.value)}
             style={{ background: 'var(--background)', color: 'white', border: '1px solid rgba(255,255,255,0.1)', padding: '0.4rem', borderRadius: '6px' }}
           />
         </div>
         <button className="btn-secondary" onClick={() => { setStartDate(''); setEndDate(''); }} style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>Réinitialiser</button>
      </div>

      <div className="glass-panel" style={{ padding: '1.25rem', marginBottom: '2rem', display: 'flex', justifyContent: 'space-around', alignItems: 'center', textAlign: 'center' }}>
        <div><span style={{color: '#94a3b8', fontSize: '0.75rem'}}>Prix Moyen</span> <br/><span style={{fontSize: '1.1rem', fontWeight: 'bold'}}>{avg} €</span></div>
        <div style={{width: '1px', height: '30px', background: 'rgba(255,255,255,0.1)'}} />
        <div><span style={{color: '#94a3b8', fontSize: '0.75rem'}}>Min / Max</span> <br/><span style={{fontSize: '1.1rem', fontWeight: 'bold'}}>{min} / {max} €</span></div>
        <div style={{width: '1px', height: '30px', background: 'rgba(255,255,255,0.1)'}} />
        <div><span style={{color: '#94a3b8', fontSize: '0.75rem'}}>Actifs</span> <br/><span style={{fontSize: '1.1rem', fontWeight: 'bold'}}>{activeListings.length}</span></div>
        <div style={{width: '1px', height: '30px', background: 'rgba(255,255,255,0.1)'}} />
        <div><span style={{color: '#94a3b8', fontSize: '0.75rem'}}>Vendus (Période)</span> <br/><span style={{fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--success)'}}>{soldListings.length}</span></div>
      </div>

      <div className="grid-cards" style={{ marginBottom: '2rem', gridTemplateColumns: '1.5fr 1fr', gap: '2rem' }}>
        <div className="glass-panel" style={{ padding: '1.5rem', position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h3 style={{ margin: 0, fontSize: '1rem' }}>Historique & Tendances</h3>
            <button 
              onClick={() => setIsModalOpen(true)}
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', padding: '0.25rem 0.6rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              <span>⛶</span> Plein écran
            </button>
          </div>
          <div style={{ height: '220px', cursor: 'pointer' }}>
             <Line 
               ref={chartRef}
               data={trendData} 
               options={chartOptions as any} 
               onClick={(e) => onChartClick(e, chartRef)}
             />
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem' }}>Distribution (Boîte à Moustaches)</h3>
          {activeListings.length >= 4 ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div style={{ padding: '0 1rem', height: '140px', position: 'relative', marginTop: '1rem' }}>
                {/* SVG BOXPLOT */}
                <svg width="100%" height="80" style={{ overflow: 'visible' }}>
                  {/* Range line (Whiskers base) */}
                  <line x1="0%" y1="40" x2="100%" y2="40" stroke="#475569" strokeWidth="1" strokeDasharray="4,2" />
                  
                  {/* Min whisker */}
                  <line x1="0%" y1="30" x2="0%" y2="50" stroke="#94a3b8" strokeWidth="2" />
                  {/* Max whisker */}
                  <line x1="100%" y1="30" x2="100%" y2="50" stroke="#94a3b8" strokeWidth="2" />

                  {/* Interquartile Range Box (Q1 to Q3) */}
                  <rect 
                    x={`${((q1-min)/(max-min))*100}%`} 
                    y="25" 
                    width={`${((q3-q1)/(max-min))*100}%`} 
                    height="30" 
                    fill="rgba(124, 58, 237, 0.2)" 
                    stroke="var(--primary)" 
                    strokeWidth="2" 
                  />

                  {/* Median Line */}
                  <line 
                    x1={`${((median-min)/(max-min))*100}%`} 
                    y1="25" 
                    x2={`${((median-min)/(max-min))*100}%`} 
                    y2="55" 
                    stroke="white" 
                    strokeWidth="3" 
                  />

                  {/* Labels on top */}
                  <text x="0%" y="20" fontSize="10" fill="#94a3b8" textAnchor="middle">{min}€</text>
                  <text x="100%" y="20" fontSize="10" fill="#94a3b8" textAnchor="middle">{max}€</text>
                  <text x={`${((median-min)/(max-min))*100}%`} y="75" fontSize="11" fill="white" fontWeight="bold" textAnchor="middle">Med: {median}€</text>
                  <text x={`${((q1-min)/(max-min))*100}%`} y="15" fontSize="9" fill="var(--primary)" textAnchor="middle">Q1: {q1}€</text>
                  <text x={`${((q3-min)/(max-min))*100}%`} y="15" fontSize="9" fill="var(--primary)" textAnchor="middle">Q3: {q3}€</text>
                </svg>
              </div>
              <p style={{ textAlign: 'center', fontSize: '0.75rem', color: '#64748b', marginTop: '1rem' }}>
                50% des prix entre {q1}€ et {q3}€
              </p>
            </div>
          ) : (
            <p style={{ textAlign: 'center', color: '#94a3b8', margin: 'auto' }}>Calcul impossible (min 4 annonces).</p>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '2rem' }}>
        <div>
          <h2 style={{ marginBottom: '1.5rem' }}>Annonces Actives ({activeListings.length})</h2>
          <div style={{ display: 'grid', gap: '1rem' }}>
            {activeListings.map((l: any) => <ListingCard key={l.id} l={l} type="active" />)}
          </div>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {soldListings.length > 0 && (
            <div>
              <h3 style={{ marginBottom: '1rem' }}>Vendus ({soldListings.length})</h3>
              <div style={{ display: 'grid', gap: '1rem' }}>
                {soldListings.map((l: any) => <ListingCard key={l.id} l={l} type="sold" />)}
              </div>
            </div>
          )}
          
          {excludedListings.length > 0 && (
            <div>
              <h3 style={{ marginBottom: '1rem' }}>Exclus ({excludedListings.length})</h3>
              <div style={{ display: 'grid', gap: '1rem' }}>
                {excludedListings.map((l: any) => <ListingCard key={l.id} l={l} type="excluded" />)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Fullscreen Modal */}
      {isModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background: 'rgba(15, 23, 42, 0.95)',
          backdropFilter: 'blur(10px)',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          padding: '2rem',
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
            <div>
              <h2 style={{ margin: 0 }}>{data.name}</h2>
              <p style={{ margin: '0.25rem 0 0 0', color: '#94a3b8' }}>Analyse complète de l'historique des prix</p>
            </div>
            <button 
              onClick={() => setIsModalOpen(false)}
              className="btn-secondary"
              style={{ padding: '0.6rem 1.2rem', borderRadius: '12px', fontWeight: 'bold' }}
            >
              Fermer [ESC]
            </button>
          </div>
          <div style={{ flex: 1, background: 'rgba(30, 41, 59, 0.5)', borderRadius: '16px', padding: '2rem', border: '1px solid rgba(255,255,255,0.05)' }}>
             <Line 
               ref={modalChartRef}
               data={trendData} 
               options={{ 
               ...chartOptions, 
               maintainAspectRatio: false,
               plugins: {
                 ...chartOptions.plugins,
                 legend: {
                   ...chartOptions.plugins.legend,
                   display: true,
                   position: 'bottom',
                   labels: { color: '#94a3b8', font: { size: 14 } }
                 }
               },
               onHover: (event: any, chartElement: any) => {
                 event.native.target.style.cursor = chartElement[0]?.datasetIndex === 1 ? 'pointer' : 'default';
               },
               scales: {
                 ...chartOptions.scales,
                 y: {
                   ...chartOptions.scales.y,
                   ticks: { ...chartOptions.scales.y.ticks, font: { size: 14 } }
                 },
                 x: {
                   ...chartOptions.scales.x,
                   ticks: { ...chartOptions.scales.x.ticks, font: { size: 14 } }
                 }
               }
             } as any} 
             onClick={(e) => onChartClick(e, modalChartRef)}
             />
          </div>
        </div>
      )}

      <style jsx global>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: scale(1.02); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  )
}
