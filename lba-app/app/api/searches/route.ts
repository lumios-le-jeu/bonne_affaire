import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/searches - List all searches
export async function GET() {
  try {
    const searches = await prisma.search.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { listings: true } },
        listings: {
          where: { status: 'active' },
          select: { price: true },
        },
        snapshots: {
          orderBy: { date: 'desc' },
          take: 30,
        },
      },
    })

    const formatted = searches.map((s) => {
      const prices = s.listings.map((l) => l.price)
      const avgPrice = prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0
      const minPrice = prices.length > 0 ? Math.min(...prices) : 0
      return {
        id: s.id,
        name: s.name,
        url: s.url,
        isTracking: s.isTracking,
        lastScraped: s.lastScraped,
        createdAt: s.createdAt,
        activeListings: s.listings.length,
        avgPrice,
        minPrice,
        snapshots: s.snapshots,
      }
    })

    return NextResponse.json(formatted)
  } catch (error) {
    console.error('Erreur lors de la récupération des recherches:', error)
    return NextResponse.json({ 
      error: 'Failed to fetch searches', 
      details: error instanceof Error ? error.message : String(error) 
    }, { status: 500 })
  }
}

// POST /api/searches - Create a new search
export async function POST(request: Request) {
  try {
    const { name, url } = await request.json()
    if (!name || !url) {
      return NextResponse.json({ error: 'name and url are required' }, { status: 400 })
    }

    // Checking if the URL already exists
    const existing = await prisma.search.findUnique({ where: { url } })
    if (existing) {
       return NextResponse.json({ error: 'Cette URL est déjà trackée !' }, { status: 409 })
    }

    const search = await prisma.search.create({
      data: { name, url, isTracking: true },
    })

    // Le scan initial est déclenché par le UI (NewSearchForm) qui poll ensuite le résultat
    return NextResponse.json(search, { status: 201 })
  } catch (error) {
    console.error('Erreur lors de la création de la recherche:', error)
    return NextResponse.json({ 
      error: 'Internal Server Error', 
      details: error instanceof Error ? error.message : String(error) 
    }, { status: 500 })
  }
}
