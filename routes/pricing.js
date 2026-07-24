const express = require('express');
const PricingConfig = require('../models/PricingConfig');
const adminMiddleware = require('../middleware/adminMiddleware');
const router = express.Router();

// Helper to seed default configurations if none exist (defaults to 'car' vehicleType)
const seedDefaultConfigs = async () => {
  /** @type {Array<'car' | 'bike' | 'ev' | 'auto' | 'truck' | 'tractor' | 'bus'>} */
  const vehicleTypes = ['car', 'bike', 'ev', 'auto', 'truck', 'tractor', 'bus'];
  /** @type {Array<'towing' | 'flat-tire' | 'battery_jump' | 'fuel-delivery' | 'breakdown' | 'engine-repair' | 'oil-change' | 'puncture-repair' | 'other'>} */
  const serviceTypes = ['towing', 'flat-tire', 'battery_jump', 'fuel-delivery', 'engine-repair', 'puncture-repair', 'breakdown', 'oil-change', 'other'];

  const baseRates = {
    car: { towing: 1000, 'flat-tire': 350, battery_jump: 350, 'fuel-delivery': 450, 'engine-repair': 600, 'puncture-repair': 300, breakdown: 350, 'oil-change': 300, other: 350 },
    bike: { towing: 500, 'flat-tire': 150, battery_jump: 150, 'fuel-delivery': 150, 'engine-repair': 300, 'puncture-repair': 79, breakdown: 150, 'oil-change': 149, other: 150 },
    auto: { towing: 800, 'flat-tire': 200, battery_jump: 200, 'fuel-delivery': 200, 'engine-repair': 400, 'puncture-repair': 199, breakdown: 200, 'oil-change': 200, other: 200 },
    ev: { towing: 900, 'flat-tire': 250, battery_jump: 250, 'fuel-delivery': 250, 'engine-repair': 500, 'puncture-repair': 249, breakdown: 250, 'oil-change': 250, other: 250 },
    truck: { towing: 1500, 'flat-tire': 500, battery_jump: 500, 'fuel-delivery': 500, 'engine-repair': 800, 'puncture-repair': 499, breakdown: 500, 'oil-change': 500, other: 500 },
    tractor: { towing: 1800, 'flat-tire': 600, battery_jump: 600, 'fuel-delivery': 600, 'engine-repair': 1000, 'puncture-repair': 599, breakdown: 600, 'oil-change': 600, other: 600 },
    bus: { towing: 2000, 'flat-tire': 700, battery_jump: 700, 'fuel-delivery': 700, 'engine-repair': 1200, 'puncture-repair': 699, breakdown: 700, 'oil-change': 700, other: 700 }
  };

  const operations = [];
  for (const vType of vehicleTypes) {
    const serviceRates = baseRates[vType] || baseRates.car;
    for (const sType of serviceTypes) {
      const baseFare = serviceRates[sType] || 350;
      const minCharge = sType === 'towing' ? baseFare + 200 : baseFare + 50;

      operations.push({
        updateOne: {
          filter: { serviceType: sType, vehicleType: vType },
          update: {
            $setOnInsert: {
              serviceType: sType,
              vehicleType: vType,
              baseFare,
              perKmRate: 30,
              minCharge
            }
          },
          upsert: true
        }
      });
    }
  }

  try {
    await PricingConfig.bulkWrite(operations);
    console.log('[Pricing Seeder] Seeded default pricing configurations successfully.');
  } catch (err) {
    console.error('[Pricing Seeder] Error seeding default configs:', err.message);
  }
};

// GET /api/pricing - Retrieve all pricing configs
router.get('/', async (req, res) => {
  try {
    // Backfill any legacy configs that are missing the vehicleType field (set them to 'car')
    await PricingConfig.updateMany({ vehicleType: { $exists: false } }, { $set: { vehicleType: 'car' } });

    // Seed missing combinations if they are not in the database
    const count = await PricingConfig.countDocuments();
    if (count < 63) {
      await seedDefaultConfigs();
    }

    let configs = await PricingConfig.find().sort({ serviceType: 1, vehicleType: 1 });
    res.status(200).json({ success: true, configs });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve pricing configurations',
      error: error.message
    });
  }
});

// GET /api/pricing/:serviceType - Retrieve ALL vehicle-type variants for a service
router.get('/:serviceType', async (req, res) => {
  try {
    const { serviceType } = req.params;
    const configs = await PricingConfig.find({ serviceType }).sort({ vehicleType: 1 });
    if (configs.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No pricing configurations found for service type: ${serviceType}`
      });
    }
    res.status(200).json({ success: true, configs });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve pricing configurations',
      error: error.message
    });
  }
});

// GET /api/pricing/:serviceType/:vehicleType - Retrieve ONE specific combination
router.get('/:serviceType/:vehicleType', async (req, res) => {
  try {
    const { serviceType, vehicleType } = req.params;
    const config = await PricingConfig.findOne({ serviceType, vehicleType });
    if (!config) {
      return res.status(404).json({
        success: false,
        message: `Pricing configuration not found for ${serviceType} / ${vehicleType}`
      });
    }
    res.status(200).json({ success: true, config });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve pricing configuration',
      error: error.message
    });
  }
});

// PUT /api/pricing/:serviceType/:vehicleType - Upsert a specific combination
router.put('/:serviceType/:vehicleType', adminMiddleware, async (req, res) => {
  try {
    const { serviceType, vehicleType } = req.params;
    const { baseFare, perKmRate, minCharge } = req.body;

    if (baseFare === undefined || perKmRate === undefined) {
      return res.status(400).json({
        success: false,
        message: 'baseFare and perKmRate are required fields.'
      });
    }

    const updatedBy = req.user?.email || req.user?.id || 'admin';
    const config = await PricingConfig.findOneAndUpdate(
      { serviceType, vehicleType },
      {
        baseFare: Number(baseFare),
        perKmRate: Number(perKmRate),
        minCharge: minCharge !== undefined ? Number(minCharge) : 0,
        updatedAt: new Date(),
        updatedBy
      },
      { new: true, upsert: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: `Pricing configuration for '${serviceType}' (${vehicleType}) saved successfully.`,
      config
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to save pricing configuration',
      error: error.message
    });
  }
});

module.exports = router;