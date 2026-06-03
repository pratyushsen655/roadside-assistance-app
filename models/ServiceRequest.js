const mongoose = require('mongoose');

const ServiceRequestSchema = new mongoose.Schema({
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  mechanic: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Mechanic',
    default: null,
  },
  vehicleType: {
    type: String,
    enum: ['car', 'bike'],
    required: true,
  },
  vehicleModel: {
    type: String,
    default: '',
  },
  issueDescription: {
    type: String,
    required: true,
  },
  imageUrl: {
    type: String,
    default: '',
  },
  customerLocation: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point',
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true,
    },
  },
  customerAddress: {
    type: String,
    default: '',
  },
  mechanicLocationAtAcceptance: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point',
    },
    coordinates: {
      type: [Number],
      default: null,
    },
  },
  status: {
    type: String,
    enum: [
      'pending',          // Request created, matching mechanics or waiting for admin assignment
      'assigned',         // Mechanic assigned manually by admin or via matching algorithm, waiting for mechanic response
      'accepted',         // Mechanic accepted the service
      'on_the_way',       // Mechanic is traveling to customer location
      'arrived',          // Mechanic reached customer location
      'work_in_progress', // Mechanic starts repairing vehicle
      'completed',        // Service completed successfully
      'cancelled'         // Request cancelled by customer, mechanic, or admin
    ],
    default: 'pending',
  },
  pricing: {
    baseFare: { type: Number, default: 0 },
    distanceFare: { type: Number, default: 0 },
    dynamicMultiplier: { type: Number, default: 1.0 },
    totalAmount: { type: Number, default: 0 },
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'failed'],
    default: 'pending',
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'upi', 'card'],
    default: 'cash',
  },
  bookingType: {
    type: String,
    enum: ['instant', 'scheduled'],
    default: 'instant',
  },
  scheduledTime: {
    type: Date,
    default: null,
  },
  // Mechanics who rejected this request (to avoid re-broadcasting to them)
  rejectedBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Mechanic',
  }],
  cancelledBy: {
    type: String,
    enum: ['customer', 'mechanic', 'admin', null],
    default: null,
  },
  cancellationReason: {
    type: String,
    default: '',
  },
  // PIN generated for secure verification when mechanic starts service
  startOTP: {
    type: String,
    required: true,
  },
  completedAt: {
    type: Date,
    default: null,
  }
}, {
  timestamps: true
});

// Spatial index for quick geospatial checks
ServiceRequestSchema.index({ customerLocation: '2dsphere' });

module.exports = mongoose.model('ServiceRequest', ServiceRequestSchema);
