import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    // Obtenir toutes les recherches avec leurs annonces vendues
    const searches = await prisma.search.findMany({
      where: {
        listings: {
          some: {
            status: 'sold',
            daysToSell: { not: null }
          }
        }
      },
      include: {
        listings: {
          where: {
            status: 'sold',
            daysToSell: { not: null }
          },
          select: {
            price: true,
            daysToSell: true,
            title: true
          }
        }
      }
    })

    const analyzed = searches.map(search => {
      const soldListings = search.listings;
      const count = soldListings.length;
      
      const avgDays = count > 0 
        ? Math.round(soldListings.reduce((sum, l) => sum + (l.daysToSell || 0), 0) / count)
        : 0;
        
      const avgPrice = count > 0
        ? Math.round(soldListings.reduce((sum, l) => sum + l.price, 0) / count)
        : 0;

      return {
        id: search.id,
        name: search.name,
        soldCount: count,
        avgDaysToSell: avgDays,
        avgPriceSold: avgPrice,
        // Échantillon pour montrer quel type d'annonce s'est vendue vite
        fastestSale: soldListings.sort((a, b) => (a.daysToSell || 0) - (b.daysToSell || 0))[0]
      }
    });

    // Trier par ceux qui se vendent le plus vite (avgDaysToSell croissant)
    // Pour que ce soit pertinent, on peut filtrer ceux qui ont au moins 1 vente
    const bestSellers = analyzed
      .filter(s => s.soldCount > 0)
      .sort((a, b) => a.avgDaysToSell - b.avgDaysToSell)
      .slice(0, 5); // Prendre le top 5

    return NextResponse.json(bestSellers)
  } catch (error) {
    console.error("Error fetching best sellers:", error)
    return NextResponse.json({ error: "Failed to fetch best sellers" }, { status: 500 })
  }
}
