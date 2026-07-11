const express = require('express');
const PricingConfig = require('../models/PricingConfig');
const adminMiddleware = require('../middleware/adminMiddleware');

const router = express.Router();

// Helper to seed default configurations if none exist
const seedDefaultConfigs = async () => {
  const defaults = [
    { serviceType: 'towing', baseFare: 1000, perKmRate: 30, minCharge: 1200 },
    { serviceType: 'flat_tire', baseFare: 350, perKmRate: 30, minCharge: 400 },
    { serviceType: 'battery_jump', baseFare: 350, perKmRate: 30, minCharge: 400 },
    { serviceType: 'fuel_delivery', baseFare: 450, perKmRate: 30, minCharge: 500 },
    { serviceType: 'engine_repair', baseFare: 600, perKmRate: 30, minCharge: 700 },
    { serviceType: 'puncture_repair', baseFare: 300, perKmRate: 30, minCharge: 350 },
    { serviceType: 'breakdown', baseFare: 350, perKmRate: 30, minCharge: 400 },
    { serviceType: 'oil_change', baseFare: 300, perKmRate: 30, minCharge: 350 },
    { serviceType: 'other', baseFare: 350, perKmRate: 30, minCharge: 400 }
  ];
  
  try {
    await PricingConfig.insertMany(defaults);
    console.log('[Pricing Seeder] Seeded default pricing configurations successfully.');
  } catch (err) {
    console.error('[Pricing Seeder] Error seeding default configs:', err.message);
  }
};

// GET /api/pricing - Retrieve all pricing configs
router.get('/', async (req, res) => {
  try {
    let configs = await PricingConfig.find().sort({ serviceType: 1 });
    
    // Seed defaults if database collection is empty
    if (configs.length === 0) {
      await seedDefaultConfigs();
      configs = await PricingConfig.find().sort({ serviceType: 1 });
    }
    
    res.status(200).json({
      success: true,
      configs
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve pricing configurations',
      error: error.message
    });
  }
});

// GET /api/pricing/:serviceType - Retrieve configuration for a specific service type
router.get('/:serviceType', async (req, res) => {
  try {
    const serviceType = req.params.serviceType;
    const config = await PricingConfig.findOne({ serviceType });
    
    if (!config) {
      return res.status(404).json({
        success: false,
        message: `Pricing configuration not found for service type: ${serviceType}`
      });
    }
    
    res.status(200).json({
      success: true,
      config
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve pricing configuration',
      error: error.message
    });
  }
});

// PUT /api/pricing/:serviceType - Upsert configuration for a specific service type
router.put('/:serviceType', adminMiddleware, async (req, res) => {
  try {
    const { serviceType } = req.params;
    const { baseFare, perKmRate, minCharge } = req.body;

    if (baseFare === undefined || perKmRate === undefined) {
      return res.status(400).json({
        success: false,
        message: 'baseFare and perKmRate are required fields.'
      });
    }

    const updatedBy = req.user?.email || req.user?.id || 'admin';

    const config = await PricingConfig.findOneAndUpdate(
      { serviceType },
      {
        baseFare: Number(baseFare),
        perKmRate: Number(perKmRate),
        minCharge: minCharge !== undefined ? Number(minCharge) : 0,
        updatedAt: new Date(),
        updatedBy
      },
      { new: true, upsert: true }
    );

    res.status(200).json({
      success: true,
      message: `Pricing configuration for '${serviceType}' saved successfully.`,
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
