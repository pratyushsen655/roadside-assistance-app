const mongoose = require('mongoose');

const CitySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  state: { type: String },
  // GeoJSON point for city centre, used for radius searches
  coordinates: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true
    }
  },
  // Default search radius (km) for mechanics within the city
  radiusKm: { type: Number, default: 10 },
  // Pricing configuration for the city
  pricing: {
    baseFare: { type: Number, required: true },
    perKm: { type: Number, required: true },
    surgeMultiplier: { type: Number, default: 1 }
  },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

// Geospatial index for $geoNear queries
CitySchema.index({ coordinates: '2dsphere' });

module.exports = mongoose.model('City', CitySchema);
