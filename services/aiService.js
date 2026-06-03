const Mechanic = require('../models/Mechanic');
const { calculateHaversineDistance } = require('./mapService');

/**
 * Find and sort nearby online mechanics using an AI weighting score.
 * 
 * Score components:
 * 1. Distance (40%) - Up to 40 points (closer is higher)
 * 2. Average Rating (30%) - Up to 30 points (rating * 6)
 * 3. Specialization (20%) - 20 points if specialization matches customer's vehicle
 * 4. Experience/Workload (10%) - 10 points if currently offline-to-online and has zero active requests
 * 
 * @param {object} serviceRequest - ServiceRequest Mongoose document
 * @param {number} maxRadiusKm - Search boundary (default 10km)
 * @returns {Promise<Array<{mechanic: object, score: number, distanceKm: number}>>}
 */
const findOptimalMechanics = async (serviceRequest, maxRadiusKm = 10) => {
  const [custLon, custLat] = serviceRequest.customerLocation.coordinates;
  const vehicleType = serviceRequest.vehicleType; // 'car' or 'bike'

  // 1. Fetch online mechanics within a 2dsphere proximity radius
  // Exclude mechanics who already rejected this request
  const nearbyMechanics = await Mechanic.find({
    status: 'online',
    vehicleSpecializations: vehicleType,
    _id: { $nin: serviceRequest.rejectedBy || [] },
    activeRequestId: null,
    kycStatus: { $ne: 'pending' }, // Only approved mechanics
    location: {
      $nearSphere: {
        $geometry: {
          type: 'Point',
          coordinates: [custLon, custLat],
        },
        $maxDistance: maxRadiusKm * 1000, // in meters
      },
    },
  });

  if (!nearbyMechanics || nearbyMechanics.length === 0) {
    return [];
  }

  // 2. Compute matching scores
  const scoredMechanics = nearbyMechanics.map(mechanic => {
    const [mechLon, mechLat] = mechanic.location.coordinates;
    const distanceKm = calculateHaversineDistance(custLat, custLon, mechLat, mechLon);
    
    let score = 0;

    // Component A: Distance (40 points max)
    // 0km -> 40 pts, maxRadiusKm -> 0 pts
    const distanceScore = Math.max(0, (1 - distanceKm / maxRadiusKm) * 40);
    score += distanceScore;

    // Component B: Rating (30 points max)
    // Rating 5.0 -> 30 pts, Rating 1.0 -> 6 pts
    const ratingScore = (mechanic.averageRating || 5.0) * 6;
    score += ratingScore;

    // Component C: Specialization focus (20 points max)
    // If mechanic has ONLY this specialization, give full points (focus factor)
    // If they do both, give 10 points
    const specCount = mechanic.vehicleSpecializations.length;
    if (specCount === 1 && mechanic.vehicleSpecializations.includes(vehicleType)) {
      score += 20;
    } else {
      score += 10;
    }

    // Component D: Completion Rate / Acceptance (10 points max)
    // Higher average rating count represents more experience
    const experienceScore = Math.min(10, (mechanic.ratingsCount || 0) * 0.5);
    score += experienceScore;

    return {
      mechanic,
      score: parseFloat(score.toFixed(2)),
      distanceKm: parseFloat(distanceKm.toFixed(2))
    };
  });

  // Sort by highest score descending
  scoredMechanics.sort((a, b) => b.score - a.score);

  return scoredMechanics;
};

module.exports = {
  findOptimalMechanics
};
