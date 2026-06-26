const PER_KM_RATE = 30;

const BASE_RATES = {
  car: {
    flat_tire: 350,
    battery_jump: 350,
    towing: 1000,
    fuel_delivery: 450,
    engine_repair: 600,
    other: 350
  },
  bike: {
    flat_tire: 150,
    battery_jump: 150,
    towing: 500,
    fuel_delivery: 150,
    engine_repair: 300,
    other: 150
  },
  auto: {
    flat_tire: 200,
    battery_jump: 200,
    towing: 800,
    fuel_delivery: 200,
    engine_repair: 400,
    other: 200
  },
  ev: {
    flat_tire: 250,
    battery_jump: 250,
    towing: 900,
    fuel_delivery: 250,
    engine_repair: 500,
    other: 250
  },
  other: {
    flat_tire: 300,
    battery_jump: 300,
    towing: 900,
    fuel_delivery: 300,
    engine_repair: 500,
    other: 300
  }
};

/**
 * Calculates the service price breakdown.
 * @param {string} vehicleType - Normalized vehicle type ('car', 'bike', etc.)
 * @param {string} serviceType - Normalized service type ('flat_tire', etc.)
 * @param {number} distanceKm - Calculated distance in kilometers
 * @returns {{ baseRate: number, distanceCharge: number, totalPrice: number }}
 */
function calculateServicePrice(vehicleType, serviceType, distanceKm = 0) {
  const vType = vehicleType || 'car';
  const sType = serviceType || 'other';

  const vehicleConfig = BASE_RATES[vType] || BASE_RATES.car;
  const baseRate = vehicleConfig[sType] || vehicleConfig.other || 350;

  const distanceCharge = Math.round(distanceKm * PER_KM_RATE);
  const totalPrice = baseRate + distanceCharge;

  return {
    baseRate,
    distanceCharge,
    totalPrice
  };
}

module.exports = {
  PER_KM_RATE,
  BASE_RATES,
  calculateServicePrice
};
