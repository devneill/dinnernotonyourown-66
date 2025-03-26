import { invariantResponse } from '@epic-web/invariant'
import { type LoaderFunction } from 'react-router'

export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url)
  const photoRef = url.searchParams.get('photoRef')
  
  invariantResponse(photoRef, 'Photo reference is required', { status: 400 })
  
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  invariantResponse(apiKey, 'Google Places API key is required', { status: 500 })
  
  const photoUrl = new URL('https://maps.googleapis.com/maps/api/place/photo')
  photoUrl.searchParams.append('maxwidth', '400')
  photoUrl.searchParams.append('photoreference', photoRef)
  photoUrl.searchParams.append('key', apiKey)
  
  const response = await fetch(photoUrl.toString())
  
  if (!response.ok) {
    return new Response('Failed to fetch photo', { status: response.status })
  }
  
  // Get the original headers to preserve content type, etc.
  const headers = new Headers()
  response.headers.forEach((value, key) => {
    headers.set(key, value)
  })
  
  // Add caching headers to improve performance
  headers.set('Cache-Control', 'public, max-age=86400') // Cache for 24 hours
  
  return new Response(response.body, { 
    status: response.status,
    headers
  })
} 