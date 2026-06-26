// eslint-disable-next-line @typescript-eslint/no-var-requires
/** @type {import('axios').AxiosStatic} */
const axios = /** @type {any} */ (require('axios'));
// dotenv already loaded by entry point (server.js)

const MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

/**
 * Calculates Haversine distance in kilometers between two coordinate pairs.
 * Used for mock/fallback calculations.
 */
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Fetch directions and ETA from Google Maps API, with mathematical fallbacks.
 * @param {number[]} origin - [longitude, latitude]
 * @param {number[]} destination - [longitude, latitude]
 * @returns {Promise<{distanceKm: number, durationMins: number, polyline: string, address: string}>}
 */
const getRouteDetails = async (origin, destination) => {
  const [originLon, originLat] = origin;
  const [destLon, destLat] = destination;

  if (MAPS_API_KEY) {
    try {
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${originLat},${originLon}&destination=${destLat},${destLon}&key=${MAPS_API_KEY}`;
      const response = await axios.get(url);

      if (response.data.status === 'OK') {
        const route = response.data.routes[0];
        const leg = route.legs[0];
        return {
          distanceKm: parseFloat((leg.distance.value / 1000).toFixed(2)),
          durationMins: Math.ceil(leg.duration.value / 60),
          polyline: route.overview_polyline.points,
          address: leg.end_address || ''
        };
      } else {
        process.stderr.write(`[Map Service] Google API status: ${response.data.status}. Using Haversine fallback.\n`);
      }
    } catch (error) {
      process.stderr.write(`[Map Service] Google API error: ${error.message}\n`);
    }
  }

  // Haversine fallback calculations (Mock)
  const distanceKm = parseFloat(calculateHaversineDistance(originLat, originLon, destLat, destLon).toFixed(2));
  
  // Assume average urban speed is 25 km/h for ETA
  const averageSpeedKmh = 25;
  let durationMins = Math.ceil((distanceKm / averageSpeedKmh) * 60);
  
  // Add a minimum duration buffer if coordinates are very close
  if (durationMins < 2 && distanceKm > 0.05) {
    durationMins = 3;
  }

  // Mock static polyline representation (straight line)
  const polyline = 'mock_polyline_string';

  return {
    distanceKm,
    durationMins,
    polyline,
    address: `Mock Address near Lat: ${destLat.toFixed(4)}, Lon: ${destLon.toFixed(4)}`
  };
};

/**
 * Geocodes an address string to [longitude, latitude] coordinates.
 */
const geocodeAddress = async (address) => {
  if (!address) return null;
  const MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
  if (MAPS_API_KEY) {
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${MAPS_API_KEY}`;
      const response = await axios.get(url);
      if (response.data.status === 'OK' && response.data.results && response.data.results.length > 0) {
        const { lat, lng } = response.data.results[0].geometry.location;
        return [lng, lat]; // [longitude, latitude]
      } else {
        process.stderr.write(`[Map Service] Geocoding API status: ${response.data.status}\n`);
      }
    } catch (error) {
      process.stderr.write(`[Map Service] Geocoding API error: ${error.message}\n`);
    }
  }
  return null;
};

module.exports = {
  getRouteDetails,
  calculateHaversineDistance,
  geocodeAddress
};
