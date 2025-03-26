import { invariant } from '@epic-web/invariant'

interface NearbySearchResponse {
  results: Array<{
    place_id: string
    name: string
    price_level?: number
    rating?: number
    geometry: {
      location: {
        lat: number
        lng: number
      }
    }
    vicinity: string
  }>
  status: string
}

interface PlaceDetailsResponse {
  result: {
    photos?: Array<{
      photo_reference: string
      width: number
      height: number
    }>
    url?: string
  }
  status: string
}

interface Restaurant {
  id: string
  name: string
  priceLevel?: number
  rating?: number
  lat: number
  lng: number
  photoRef?: string
  mapsUrl?: string
}

interface GetNearbyRestaurantsOptions {
  lat: number
  lng: number
  radius: number
}

export async function getNearbyRestaurants({
  lat,
  lng,
  radius
}: GetNearbyRestaurantsOptions): Promise<Restaurant[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  invariant(apiKey, 'GOOGLE_PLACES_API_KEY is required')

  // Fetch nearby restaurants
  const nearbySearchUrl = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json')
  nearbySearchUrl.searchParams.append('location', `${lat},${lng}`)
  nearbySearchUrl.searchParams.append('radius', radius.toString())
  nearbySearchUrl.searchParams.append('type', 'restaurant')
  nearbySearchUrl.searchParams.append('key', apiKey)

  const nearbyResponse = await fetch(nearbySearchUrl.toString())
  const nearbyData = await nearbyResponse.json() as NearbySearchResponse
  
  if (nearbyData.status !== 'OK' && nearbyData.status !== 'ZERO_RESULTS') {
    throw new Error(`Google Places API error: ${nearbyData.status}`)
  }
  
  if (nearbyData.status === 'ZERO_RESULTS' || !nearbyData.results.length) {
    return []
  }

  // Fetch details for each restaurant in parallel
  const restaurantsWithDetails = await Promise.all(
    nearbyData.results.map(async (place) => {
      const detailsUrl = new URL('https://maps.googleapis.com/maps/api/place/details/json')
      detailsUrl.searchParams.append('place_id', place.place_id)
      detailsUrl.searchParams.append('fields', 'photos,url')
      detailsUrl.searchParams.append('key', apiKey)

      const detailsResponse = await fetch(detailsUrl.toString())
      const detailsData = await detailsResponse.json() as PlaceDetailsResponse
      
      const photoRef = detailsData.result.photos?.[0]?.photo_reference

      const restaurant: Restaurant = {
        id: place.place_id,
        name: place.name,
        priceLevel: place.price_level,
        rating: place.rating,
        lat: place.geometry.location.lat,
        lng: place.geometry.location.lng,
        photoRef,
        mapsUrl: detailsData.result.url
      }

      return restaurant
    })
  )

  return restaurantsWithDetails
} 