/**
 * Dynamic Pricing Service
 */

// Base constants
const PRICING_CONFIG = {
  car: {
    baseFare: 300,        // Base fee in local currency (e.g., INR)
    ratePerKm: 30,        // Charging rate per km
  },
  bike: {
    baseFare: 150,
    ratePerKm: 15,
  },
  auto: {
    baseFare: 200,
    ratePerKm: 20,
  },
  'e-vehicle': {
    baseFare: 180,
    ratePerKm: 18,
  },
  other: {
    baseFare: 250,
    ratePerKm: 25,
  }
};

/**
 * Calculates dynamic service fare
 * @param {string} vehicleType - 'car' or 'bike'
 * @param {number} distanceKm - distance from mechanic to customer in km
 * @param {number} nearbyRequestsCount - active requests in the area (to gauge demand)
 * @param {number} activeMechanicsCount - active mechanics in the area (to gauge supply)
 */
const calculateFare = (vehicleType, distanceKm = 0, nearbyRequestsCount = 1, activeMechanicsCount = 1) => {
  const config = PRICING_CONFIG[vehicleType.toLowerCase()] || PRICING_CONFIG.bike;
  
  const baseFare = config.baseFare;
  const distanceFare = parseFloat((distanceKm * config.ratePerKm).toFixed(2));
  
  // 1. Demand multiplier (Surge pricing)
  let surgeMultiplier = 1.0;
  if (activeMechanicsCount === 0) {
    surgeMultiplier = 1.5; // High demand surcharge when no mechanics are free
  } else {
    const ratio = nearbyRequestsCount / activeMechanicsCount;
    if (ratio > 2.0) {
      surgeMultiplier = 1.4;
    } else if (ratio > 1.2) {
      surgeMultiplier = 1.2;
    }
  }

  // 2. Night surcharge (11 PM - 5 AM)
  const currentHour = new Date().getHours();
  let timeMultiplier = 1.0;
  if (currentHour >= 23 || currentHour < 5) {
    timeMultiplier = 1.25; // 25% night surcharge
  }

  // Combine multipliers (capped at 2.0x max)
  const finalMultiplier = parseFloat(Math.min(surgeMultiplier * timeMultiplier, 2.0).toFixed(2));

  // Compute final rounded amount
  const rawTotal = (baseFare + distanceFare) * finalMultiplier;
  const totalAmount = Math.round(rawTotal);

  return {
    baseFare,
    distanceFare,
    dynamicMultiplier: finalMultiplier,
    totalAmount
  };
};

module.exports = {
  calculateFare
};
