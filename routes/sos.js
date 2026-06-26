const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const SOS = require('../models/SOS');
const Mechanic = require('../models/Mechanic');

const router = express.Router();

// POST /api/sos — create SOS record
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { lat, lng, serviceType, description } = req.body;
    if (lat === undefined || lng === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Location coordinates (lat, lng) are required'
      });
    }

    const sos = await SOS.create({
      customerId: req.user.id,
      location: { lat, lng },
      status: 'pending',
      serviceType: serviceType || 'unknown',
      description: description || 'Emergency SOS Request'
    });

    // Broadcast new SOS to mechanics within 5 km
    if (/** @type {any} */ (req).io) {
      try {
        const { calculateHaversineDistance } = require('../services/mapService');
        const onlineMechanics = await Mechanic.find({ isOnline: true });
        for (const mech of onlineMechanics) {
          const [mLng, mLat] = mech.location?.coordinates || [0, 0];
          if (mLng === 0 && mLat === 0) continue;
          const dist = calculateHaversineDistance(lat, lng, mLat, mLng);
          if (dist <= 5) {
            /** @type {any} */ (req).io.to(`mechanic:${mech._id}`).emit('sos:new', sos);
          }
        }
      } catch (err) {
        console.error('Error broadcasting new SOS:', err.message);
      }
    }

    res.status(201).json(sos);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/sos/active — return all SOS records with status: pending and within matching radius
router.get('/active', authMiddleware, async (req, res) => {
  try {
    const Mechanic = require('../models/Mechanic');
    const { calculateHaversineDistance } = require('../services/mapService');

    const mechanic = await Mechanic.findOne({ $or: [{ _id: req.user.id }, { userId: req.user.id }] });
    if (!mechanic) {
      return res.status(200).json([]);
    }

    const [mLng, mLat] = mechanic.location?.coordinates || [0, 0];
    if (mLng === 0 && mLat === 0) {
      return res.status(200).json([]);
    }

    const activeSos = await SOS.find({ status: 'pending' });

    const filteredSos = activeSos.map(sosItem => {
      const distanceKm = parseFloat(calculateHaversineDistance(mLat, mLng, sosItem.location.lat, sosItem.location.lng).toFixed(1));
      const elapsedSeconds = (Date.now() - new Date(sosItem.createdAt).getTime()) / 1000;
      let activeRadiusKm = 5;
      if (elapsedSeconds >= 120) {
        activeRadiusKm = 15;
      } else if (elapsedSeconds >= 60) {
        activeRadiusKm = 10;
      }

      return {
        sosItem,
        distanceKm,
        activeRadiusKm
      };
    })
    .filter(item => item.distanceKm <= item.activeRadiusKm)
    .map(({ sosItem, distanceKm }) => {
      const obj = sosItem.toObject();
      obj.distanceKm = distanceKm;
      return obj;
    });

    res.status(200).json(filteredSos);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/sos/:id/accept — accept SOS request
router.put('/:id/accept', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const sos = await SOS.findById(id);

    if (!sos) {
      return res.status(404).json({ success: false, message: 'SOS record not found' });
    }

    if (sos.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'SOS request is already accepted or completed' });
    }

    const mechanic = await Mechanic.findOne({ $or: [{ _id: req.user.id }, { userId: req.user.id }] });

    sos.status = 'accepted';
    sos.mechanicId = /** @type {any} */ (mechanic?.userId || req.user.id);
    await sos.save();

    // Notify customer via socket.io
    if (/** @type {any} */ (req).io) {
      /** @type {any} */ (req).io.to(`job:${id}`).emit('job:accepted:notify', {
        jobId: id,
        mechanicId: mechanic?._id || req.user.id,
        mechanicName: mechanic?.name || 'Mechanic',
        mechanicPhone: mechanic?.phone || ''
      });
    }

    res.status(200).json(sos);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
