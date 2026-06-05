const mongoose = require('mongoose');

const requestSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    mechanicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Mechanic',
      default: null,
    },
    serviceType: {
      type: String,
      enum: ['tire_repair', 'battery', 'fuel_delivery', 'lock_out', 'towing', 'engine_repair', 'other'],
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        required: true,
      },
      address: String,
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'in_progress', 'completed', 'cancelled'],
      default: 'pending',
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
    },
    estimatedTime: Number,
    actualTime: Number,
    cost: {
      baseFare: Number,
      additionalCharges: Number,
      total: Number,
    },
    photos: [String],
    notes: String,
    rating: {
      score: {
        type: Number,
        min: 1,
        max: 5,
      },
      review: String,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    acceptedAt: Date,
    completedAt: Date,
  },
  { timestamps: true }
);

requestSchema.index({ 'location.coordinates': '2dsphere' });

module.exports = mongoose.model('Request', requestSchema);
