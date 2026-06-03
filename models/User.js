const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  name: {
    type: String,
    trim: true,
    default: '',
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    default: '',
  },
  avatar: {
    type: String,
    default: '',
  },
  city: {
    type: String,
    enum: ['Delhi','Mumbai','Bangalore','Hyderabad','Chennai','Pune','Kolkata','Ahmedabad','Jaipur','Gurugram'],
    required: true,
    default: 'Delhi'
  },
  otp: {
    type: String,
    default: null,
  },
  otpExpiry: {
    type: Date,
    default: null,
  },
  fcmToken: {
    type: String,
    default: null,
  },
  // GeoJSON field for last known coordinates
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
  emergencyContacts: [
    {
      name: { type: String, required: true },
      phone: { type: String, required: true }
    }
  ],
  isBlocked: {
    type: Boolean,
    default: false,
  }
}, {
  timestamps: true
});

// Create spatial index for 2D sphere queries
UserSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('User', UserSchema);
