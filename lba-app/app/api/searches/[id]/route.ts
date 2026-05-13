import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/searches/[id] - Get a single search with all data
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const search = await prisma.search.findUnique({
    where: { id },
    include: {
      listings: {
        orderBy: { price: 'asc' },
        include: {
          history: {
            orderBy: { date: 'asc' },
          },
        },
      },
      snapshots: {
        orderBy: { date: 'asc' },
        take: 90,
      },
    },
  })

  if (!search) {
    return NextResponse.json({ error: 'Search not found' }, { status: 404 })
  }

  // Compute "good deal" threshold: avg price - 15%
  const activeListings = search.listings.filter((l) => l.status === 'active')
  const prices = activeListings.map((l) => l.price)
  const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0
  const goodDealThreshold = avgPrice * 0.85

  const enrichedListings = search.listings.map((l) => ({
    ...l,
    isGoodDeal: l.price <= goodDealThreshold && l.status === 'active',
    score: avgPrice > 0 ? Math.round(((avgPrice - l.price) / avgPrice) * 100) : 0,
  }))

  return NextResponse.json({
    ...search,
    listings: enrichedListings,
    stats: {
      avgPrice: Math.round(avgPrice),
      minPrice: prices.length > 0 ? Math.min(...prices) : 0,
      maxPrice: prices.length > 0 ? Math.max(...prices) : 0,
      activeCount: activeListings.length,
      soldCount: search.listings.filter((l) => l.status === 'sold').length,
      goodDealThreshold: Math.round(goodDealThreshold),
    },
  })
}

// PATCH /api/searches/[id] - Update tracking status
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()

  const search = await prisma.search.update({
    where: { id },
    data: { isTracking: body.isTracking },
  })

  return NextResponse.json(search)
}

// DELETE /api/searches/[id]
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  await prisma.search.delete({ where: { id } })

  return NextResponse.json({ success: true })
}
