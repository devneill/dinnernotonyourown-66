import { type LoaderFunction, type ActionFunction, useLoaderData, useSearchParams } from 'react-router'
import { motion, AnimatePresence } from 'motion/react'
import { z } from 'zod'
import { invariantResponse } from '@epic-web/invariant'
import { getAllRestaurantDetails, joinDinnerGroup, leaveDinnerGroup, type RestaurantWithDetails } from '#app/utils/restaurants.server'
import { requireUserId } from '#app/utils/auth.server'
import { useFetcher } from 'react-router'
import { MapIcon, StarIcon, PinIcon } from 'lucide-react'
import { cn } from '#app/utils/misc'
import { StatusButton } from '#app/components/ui/status-button'
import { Button } from '#app/components/ui/button'
import { Toggle } from '#app/components/ui/toggle'
import { Card, CardContent, CardFooter, CardHeader } from '#app/components/ui/card'

// Hilton coordinates in Salt Lake City
const HILTON_COORDINATES = {
  lat: 40.7596,
  lng: -111.8867,
}

// Validation schema for action form data
const ActionSchema = z.object({
  intent: z.enum(['join', 'leave']),
  restaurantId: z.string().optional(),
})

export const loader: LoaderFunction = async ({ request }) => {
  const userId = await requireUserId(request)
  const url = new URL(request.url)

  // Extract filter parameters from the URL
  const distanceFilter = url.searchParams.get('distance') 
    ? parseInt(url.searchParams.get('distance') as string, 10) * 1609.34 // Convert miles to meters
    : 8047 // Default to 5 miles (8047 meters)
  
  const ratingFilter = url.searchParams.get('rating')
    ? parseFloat(url.searchParams.get('rating') as string)
    : undefined
  
  const priceFilter = url.searchParams.get('price')
    ? parseInt(url.searchParams.get('price') as string, 10)
    : undefined

  // Get all restaurant details from the service
  const allRestaurants = await getAllRestaurantDetails({
    lat: HILTON_COORDINATES.lat,
    lng: HILTON_COORDINATES.lng,
    radius: distanceFilter,
    userId,
  })

  // Split the restaurants into two lists
  const restaurantsWithAttendance = allRestaurants
    .filter(restaurant => restaurant.attendeeCount > 0)
    .sort((a, b) => b.attendeeCount - a.attendeeCount)

  const restaurantsNearby = allRestaurants
    .filter(restaurant => restaurant.attendeeCount === 0)
    .filter(restaurant => {
      // Apply distance filter (already applied at the API level, but double-check)
      if (distanceFilter && restaurant.distance > distanceFilter / 1609.34) return false
      
      // Apply rating filter
      if (ratingFilter && (!restaurant.rating || restaurant.rating < ratingFilter)) return false
      
      // Apply price filter
      if (priceFilter !== undefined && restaurant.priceLevel !== priceFilter) return false
      
      return true
    })
    .sort((a, b) => {
      // Sort by rating (descending)
      if (b.rating !== a.rating) {
        return (b.rating || 0) - (a.rating || 0)
      }
      // Use distance as tiebreaker (ascending)
      return a.distance - b.distance
    })
    .slice(0, 50) // Limit to top 50 results

  return {
    restaurantsWithAttendance,
    restaurantsNearby,
    filters: {
      distance: distanceFilter / 1609.34, // Convert back to miles for UI
      rating: ratingFilter,
      price: priceFilter,
    }
  }
}

export const action: ActionFunction = async ({ request }) => {
  const userId = await requireUserId(request)
  const formData = await request.formData()
  
  const result = ActionSchema.safeParse(Object.fromEntries(formData))
  
  if (!result.success) {
    return {
      status: 'error',
      errors: result.error.flatten().fieldErrors,
    }
  }
  
  const { intent, restaurantId } = result.data
  
  switch (intent) {
    case 'join': {
      invariantResponse(restaurantId, 'Restaurant ID is required when joining', { status: 400 })
      await joinDinnerGroup(userId, restaurantId)
      return { status: 'success' }
    }
    
    case 'leave': {
      await leaveDinnerGroup(userId)
      return { status: 'success' }
    }
    
    default: {
      return { status: 'error', message: `Unsupported intent: ${intent}` }
    }
  }
}

function RestaurantCard({ restaurant, isUserAttending }: { restaurant: RestaurantWithDetails, isUserAttending: boolean }) {
  const fetcher = useFetcher()
  const formId = `restaurant-form-${restaurant.id}`
  
  const isPending = fetcher.state !== 'idle'
  const isJoining = isPending && fetcher.formData?.get('intent') === 'join'
  const isLeaving = isPending && fetcher.formData?.get('intent') === 'leave'
  
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.2 }}
    >
      <Card className={cn(
        "h-full flex flex-col overflow-hidden", 
        isUserAttending && "ring-2 ring-primary"
      )}>
        <div className="relative aspect-video overflow-hidden">
          {restaurant.photoRef ? (
            <img 
              src={`/resources/maps/photo?photoRef=${restaurant.photoRef}`}
              alt={restaurant.name}
              className="object-cover w-full h-full"
            />
          ) : (
            <div className="w-full h-full bg-muted flex items-center justify-center">
              <span className="text-muted-foreground">No image</span>
            </div>
          )}
          
          <div className="absolute top-2 left-2 flex gap-2">
            {restaurant.rating ? (
              <div className="bg-black/70 text-white px-2 py-1 rounded-md text-xs flex items-center">
                <StarIcon className="w-3 h-3 text-yellow-400 mr-1" />
                {restaurant.rating.toFixed(1)}
              </div>
            ) : null}
            
            {restaurant.priceLevel ? (
              <div className="bg-black/70 text-white px-2 py-1 rounded-md text-xs">
                {'$'.repeat(restaurant.priceLevel)}
              </div>
            ) : null}
          </div>
        </div>
        
        <CardHeader className="pb-2">
          <h3 className="font-semibold line-clamp-1">{restaurant.name}</h3>
        </CardHeader>
        
        <CardContent className="pb-2 flex-grow">
          <div className="flex items-center text-sm text-muted-foreground mb-1">
            <PinIcon className="w-3 h-3 mr-1" />
            <span>{restaurant.distance} mi</span>
          </div>
          
          {restaurant.mapsUrl && (
            <a 
              href={restaurant.mapsUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-sm text-primary flex items-center hover:underline"
            >
              <MapIcon className="w-3 h-3 mr-1" />
              Directions
            </a>
          )}
          
          <div className="mt-2 text-sm">
            <span>{restaurant.attendeeCount} attending</span>
          </div>
        </CardContent>
        
        <CardFooter className="pt-2">
          <fetcher.Form method="post" className="w-full" id={formId}>
            <input type="hidden" name="restaurantId" value={restaurant.id} />
            
            {isUserAttending ? (
              <StatusButton
                type="submit" 
                name="intent" 
                value="leave"
                status={isLeaving ? 'pending' : 'idle'}
                className="w-full" 
                variant="destructive"
              >
                Leave
              </StatusButton>
            ) : (
              <StatusButton
                type="submit" 
                name="intent" 
                value="join"
                status={isJoining ? 'pending' : 'idle'}
                className="w-full"
              >
                Join
              </StatusButton>
            )}
          </fetcher.Form>
        </CardFooter>
      </Card>
    </motion.div>
  )
}

function Filters() {
  const [searchParams, setSearchParams] = useSearchParams()
  const distanceParam = searchParams.get('distance') || '5'
  const ratingParam = searchParams.get('rating')
  const priceParam = searchParams.get('price')
  
  const updateSearchParams = (key: string, value: string | null) => {
    const newParams = new URLSearchParams(searchParams)
    
    if (value === null) {
      newParams.delete(key)
    } else {
      newParams.set(key, value)
    }
    
    setSearchParams(newParams, { 
      preventScrollReset: true, 
      replace: true 
    })
  }
  
  return (
    <div className="space-y-3 p-3 bg-muted/30 rounded-lg">
      <div>
        <p className="text-sm font-medium mb-2">Distance</p>
        <div className="grid grid-cols-4 gap-2">
          {['1', '2', '5', '10'].map(distance => (
            <Toggle
              key={distance}
              pressed={distanceParam === distance}
              onPressedChange={(pressed) => {
                updateSearchParams('distance', pressed ? distance : '5')
              }}
              className="text-sm"
            >
              {distance} mi
            </Toggle>
          ))}
        </div>
      </div>
      
      <div>
        <p className="text-sm font-medium mb-2">Rating</p>
        <div className="grid grid-cols-4 gap-2">
          {['1', '2', '3', '4'].map(rating => (
            <Toggle
              key={rating}
              pressed={ratingParam === rating}
              onPressedChange={(pressed) => {
                updateSearchParams('rating', pressed ? rating : null)
              }}
              className="text-sm"
            >
              {'⭐'.repeat(parseInt(rating, 10))}
            </Toggle>
          ))}
        </div>
      </div>
      
      <div>
        <p className="text-sm font-medium mb-2">Price</p>
        <div className="grid grid-cols-4 gap-2">
          {['1', '2', '3', '4'].map(price => (
            <Toggle
              key={price}
              pressed={priceParam === price}
              onPressedChange={(pressed) => {
                updateSearchParams('price', pressed ? price : null)
              }}
              className="text-sm"
            >
              {'$'.repeat(parseInt(price, 10))}
            </Toggle>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function RestaurantsPage() {
  const { restaurantsWithAttendance, restaurantsNearby } = useLoaderData<{
    restaurantsWithAttendance: RestaurantWithDetails[];
    restaurantsNearby: RestaurantWithDetails[];
    filters: {
      distance: number;
      rating?: number;
      price?: number;
    };
  }>();
  
  const userAttendingRestaurant = restaurantsWithAttendance.find((r: RestaurantWithDetails) => r.isUserAttending)
  
  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-8">
      <header>
        <h1 className="text-3xl font-bold">
          {userAttendingRestaurant 
            ? "You've got dinner plans! 🎉" 
            : "You're having dinner on your own 🧘‍♂️"}
        </h1>
      </header>
      
      <section>
        {restaurantsWithAttendance.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <AnimatePresence>
              {restaurantsWithAttendance.map((restaurant: RestaurantWithDetails) => (
                <RestaurantCard 
                  key={restaurant.id} 
                  restaurant={restaurant} 
                  isUserAttending={restaurant.isUserAttending}
                />
              ))}
            </AnimatePresence>
          </div>
        ) : (
          <div className="border-2 border-dashed border-muted-foreground/20 rounded-lg p-6 h-64 flex items-center justify-center text-muted-foreground">
            <p>Everyone is having dinner on their own 🤷</p>
          </div>
        )}
      </section>
      
      <section>
        <h2 className="text-2xl font-bold mb-6">Restaurant List</h2>
        
        <Filters />
        
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <AnimatePresence>
            {restaurantsNearby.map((restaurant: RestaurantWithDetails) => (
              <RestaurantCard 
                key={restaurant.id} 
                restaurant={restaurant} 
                isUserAttending={restaurant.isUserAttending}
              />
            ))}
          </AnimatePresence>
        </div>
      </section>
    </div>
  )
} 