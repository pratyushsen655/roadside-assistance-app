const mongoose = require('mongoose');

const pricingConfigSchema = new mongoose.Schema({
  serviceType: {
    type: String,
    required: true,
    enum: ['towing', 'battery_jump', 'flat-tire', 'fuel-delivery', 'breakdown', 'engine-repair', 'oil-change', 'puncture-repair', 'other'],
  },
  vehicleType: {
    type: String,
    required: true,
    enum: ['car', 'bike', 'ev', 'auto', 'truck', 'tractor', 'bus'],
  },
  baseFare: { type: Number, required: true },
  perKmRate: { type: Number, required: true },
  minCharge: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: String },
});

// Compound unique index: one config per serviceType + vehicleType combination
pricingConfigSchema.index({ serviceType: 1, vehicleType: 1 }, { unique: true });

module.exports = mongoose.model('PricingConfig', pricingConfigSchema);