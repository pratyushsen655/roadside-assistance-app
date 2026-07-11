const mongoose = require('mongoose');

const PricingConfigSchema = new mongoose.Schema({
  serviceType: {
    type: String,
    required: true,
    unique: true
  },
  baseFare: {
    type: Number,
    required: true
  },
  perKmRate: {
    type: Number,
    required: true
  },
  minCharge: {
    type: Number,
    default: 0
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  updatedBy: {
    type: String
  }
}, { timestamps: true });

module.exports = mongoose.model('PricingConfig', PricingConfigSchema);
