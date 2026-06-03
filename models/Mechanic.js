const mongoose = require('mongoose');

const MechanicSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  avatar: {
    type: String,
    default: '',
  },
  vehicleSpecializations: {
    type: [String],
    enum: ['car', 'bike'],
    default: ['car', 'bike'],
  },
  kyc: {
    docType: {
      type: String,
      enum: ['driver_license', 'national_id', 'business_permit'],
      default: 'driver_license'
    },
    docUrl: {
      type: String,
      default: ''
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },
    rejectionReason: {
      type: String,
      default: ''
    }
  },
  status: {
    type: String,
    enum: ['online', 'offline', 'busy'],
    default: 'offline',
  },
  socketId: {
    type: String,
    default: null,
  },
  fcmToken: {
    type: String,
    default: null,
  },
  // GeoJSON coordinate
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point',
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      default: [0, 0],
    },
  },
  activeRequestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ServiceRequest',
    default: null,
  },
  averageRating: {
    type: Number,
    default: 5.0,
    min: 1.0,
    max: 5.0,
  },
  ratingsCount: {
    type: Number,
    default: 0,
  },
  earnings: {
    total: {
      type: Number,
      default: 0,
    },
    withdrawn: {
      type: Number,
      default: 0,
    }
  },
  otp: {
    type: String,
    default: null,
  },
  otpExpiry: {
    type: Date,
    default: null,
  },
  isBlocked: {
    type: Boolean,
    default: false,
  }
}, {
  timestamps: true
});

// Create spatial index for tracking nearby mechanics
MechanicSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Mechanic', MechanicSchema);
