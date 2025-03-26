import { type Prisma } from '@prisma/client'
import { invariant } from '@epic-web/invariant'
import { cachified } from '#app/utils/cache.server'
import { lruCache } from '#app/utils/cache.server'
import { prisma } from '#app/utils/db.server'
import { getNearbyRestaurants } from '#app/utils/providers/google-places.server'

// Constants for caching
const CACHE_KEYS = {
  ALL_RESTAURANTS: 'all-restaurants',
}

// TTL for restaurant data (4 hours)
const RESTAURANTS_TTL = 1000 * 60 * 60 * 4

export interface RestaurantWithDetails {
  id: string
  name: string
  priceLevel?: number | null
  rating?: number | null
  lat: number
  lng: number
  photoRef?: string | null
  mapsUrl?: string | null
  distance: number // miles
  attendeeCount: number
  isUserAttending: boolean
}

function calculateDistance(
  lat1: number, 
  lng1: number, 
  lat2: number, 
  lng2: number
): number {
  // Haversine formula to calculate distance between two coordinates
  const R = 3958.8 // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLng/2) * Math.sin(dLng/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  const distance = R * c
  return parseFloat(distance.toFixed(1)) // Round to 1 decimal place
}

async function fetchAndUpsertRestaurants(
  lat: number, 
  lng: number, 
  radius: number
) {
  const restaurants = await getNearbyRestaurants({ lat, lng, radius })
  
  // Upsert restaurants in batches to avoid overwhelming the database
  const batchSize = 20
  for (let i = 0; i < restaurants.length; i += batchSize) {
    const batch = restaurants.slice(i, i + batchSize)
    await Promise.all(
      batch.map(restaurant => 
        prisma.restaurant.upsert({
          where: { id: restaurant.id },
          update: {
            name: restaurant.name,
            priceLevel: restaurant.priceLevel,
            rating: restaurant.rating,
            lat: restaurant.lat,
            lng: restaurant.lng,
            photoRef: restaurant.photoRef,
            mapsUrl: restaurant.mapsUrl,
            updatedAt: new Date(),
          },
          create: {
            id: restaurant.id,
            name: restaurant.name,
            priceLevel: restaurant.priceLevel,
            rating: restaurant.rating,
            lat: restaurant.lat,
            lng: restaurant.lng,
            photoRef: restaurant.photoRef,
            mapsUrl: restaurant.mapsUrl,
          },
        })
      )
    )
  }
  
  return restaurants
}

export async function getAllRestaurantDetails({
  lat,
  lng,
  radius = 8047, // 5 miles in meters by default
  userId,
}: {
  lat: number
  lng: number
  radius?: number
  userId?: string
}): Promise<RestaurantWithDetails[]> {
  // Fetch and cache restaurants
  const restaurants = await cachified({
    key: `${CACHE_KEYS.ALL_RESTAURANTS}:${lat}:${lng}:${radius}`,
    cache: lruCache,
    ttl: RESTAURANTS_TTL,
    getFreshValue: () => fetchAndUpsertRestaurants(lat, lng, radius),
  })
  
  // Get attendance data (not cached as it needs to be real-time)
  const dinnerGroups = await prisma.dinnerGroup.findMany({
    include: {
      _count: {
        select: { attendees: true },
      },
    },
  })
  
  // Get the user's attending restaurant, if any
  let userAttendingRestaurantId: string | null = null
  if (userId) {
    const userAttendee = await prisma.attendee.findUnique({
      where: { userId },
      include: { dinnerGroup: true },
    })
    if (userAttendee) {
      userAttendingRestaurantId = userAttendee.dinnerGroup.restaurantId
    }
  }
  
  // Combine data
  const restaurantsWithDetails: RestaurantWithDetails[] = restaurants.map(restaurant => {
    const dinnerGroup = dinnerGroups.find(dg => dg.restaurantId === restaurant.id)
    const attendeeCount = dinnerGroup?._count.attendees ?? 0
    
    return {
      ...restaurant,
      distance: calculateDistance(lat, lng, restaurant.lat, restaurant.lng),
      attendeeCount,
      isUserAttending: userAttendingRestaurantId === restaurant.id,
    }
  })
  
  return restaurantsWithDetails
}

export async function joinDinnerGroup(userId: string, restaurantId: string) {
  invariant(userId, 'userId is required')
  invariant(restaurantId, 'restaurantId is required')
  
  // First, check if the user is already in a group and remove them if so
  await leaveDinnerGroup(userId)
  
  // Get or create dinner group for this restaurant
  const dinnerGroup = await prisma.dinnerGroup.upsert({
    where: { restaurantId },
    update: {}, // No updates needed
    create: {
      restaurantId,
    },
  })
  
  // Add user to the dinner group
  await prisma.attendee.create({
    data: {
      userId,
      dinnerGroupId: dinnerGroup.id,
    },
  })
  
  return dinnerGroup
}

export async function leaveDinnerGroup(userId: string) {
  invariant(userId, 'userId is required')
  
  const attendee = await prisma.attendee.findUnique({
    where: { userId },
    include: { dinnerGroup: true },
  })
  
  if (!attendee) return null
  
  // Delete the attendee
  await prisma.attendee.delete({
    where: { userId },
  })
  
  // Check if this was the last attendee in the group
  const remainingAttendees = await prisma.attendee.count({
    where: { dinnerGroupId: attendee.dinnerGroupId },
  })
  
  // If no attendees left, delete the dinner group
  if (remainingAttendees === 0) {
    await prisma.dinnerGroup.delete({
      where: { id: attendee.dinnerGroupId },
    })
  }
  
  return attendee.dinnerGroup
} 