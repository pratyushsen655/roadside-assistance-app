const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/', authMiddleware, async (req, res) => {
  try {
    const Request = require('../models/Request');
    const { serviceType, description, location, priority } = req.body;

    const newRequest = await Request.create({
      userId: req.user.id,
      serviceType,
      description,
      location,
      priority,
    });

    res.status(201).json({
      success: true,
      message: 'Service request created',
      request: newRequest,
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
    const Request = require('../models/Request');
    const request = await Request.findById(req.params.id)
      .populate('userId', 'name phone email')
      .populate('mechanicId', 'name phone hourlyRate');

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Request not found',
      });
    }

    res.status(200).json({
      success: true,
      request,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const Request = require('../models/Request');
    const { status, mechanicId, cost, notes } = req.body;

    const request = await Request.findByIdAndUpdate(
      req.params.id,
      { status, mechanicId, cost, notes },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: 'Request updated',
      request,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;
