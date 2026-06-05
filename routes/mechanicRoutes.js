const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const Mechanic = require('../models/Mechanic');
    const mechanics = await Mechanic.find({ availabilityStatus: 'available' }).populate('userId', 'name phone');

    res.status(200).json({
      success: true,
      mechanics,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const Mechanic = require('../models/Mechanic');
    const mechanic = await Mechanic.findById(req.params.id).populate('userId', 'name phone email');

    if (!mechanic) {
      return res.status(404).json({
        success: false,
        message: 'Mechanic not found',
      });
    }

    res.status(200).json({
      success: true,
      mechanic,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.put('/availability', authMiddleware, async (req, res) => {
  try {
    const Mechanic = require('../models/Mechanic');
    const { status, location } = req.body;

    const mechanic = await Mechanic.findOneAndUpdate(
      { userId: req.user.id },
      { availabilityStatus: status, currentLocation: location },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: 'Availability updated',
      mechanic,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;
