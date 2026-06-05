const mongoose = require('mongoose');

const mechanicSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    licenseNumber: {
      type: String,
      required: true,
      unique: true,
    },
    licenseExpiry: Date,
    certifications: [String],
    experience: {
      type: Number,
      required: true,
    },
    specializations: [String],
    serviceRadius: {
      type: Number,
      default: 10,
    },
    availabilityStatus: {
      type: String,
      enum: ['available', 'busy', 'offline'],
      default: 'offline',
    },
    currentLocation: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        default: [0, 0],
      },
    },
    rating: {
      average: {
        type: Number,
        default: 0,
        min: 0,
        max: 5,
      },
      totalReviews: {
        type: Number,
        default: 0,
      },
    },
    completedRequests: {
      type: Number,
      default: 0,
    },
    hourlyRate: {
      type: Number,
      required: true,
    },
    bankDetails: {
      accountHolder: String,
      accountNumber: String,
      ifscCode: String,
      bankName: String,
    },
    documents: {
      licenseImage: String,
      certificationImages: [String],
      identityProof: String,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

mechanicSchema.index({ currentLocation: '2dsphere' });

module.exports = mongoose.model('Mechanic', mechanicSchema);
