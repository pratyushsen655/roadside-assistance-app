const express = require('express');
const router = express.Router();
const Address = require('../models/Address');
const protect = require('../middleware/authMiddleware');

// Get all addresses for logged-in user
router.get('/', protect, async (req, res) => {
  try {
    const addresses = await Address.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json({ success: true, addresses });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});

// Create new address
router.post('/', protect, async (req, res) => {
  try {
    const { label, address, landmark, lat, lng } = req.body;
    
    // Check if this is the first address, set as default
    const count = await Address.countDocuments({ userId: req.user._id });
    const isDefault = count === 0;

    const newAddress = new Address({
      userId: req.user._id,
      label,
      address,
      landmark,
      location: { lat, lng },
      isDefault
    });

    const savedAddress = await newAddress.save();
    res.status(201).json({ success: true, address: savedAddress });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});

// Update address
router.put('/:id', protect, async (req, res) => {
  try {
    let addr = await Address.findById(req.params.id);
    if (!addr) {
      return res.status(404).json({ success: false, message: 'Address not found' });
    }
    if (addr.userId.toString() !== req.user._id.toString()) {
      return res.status(401).json({ success: false, message: 'Not authorized' });
    }

    addr = await Address.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, address: addr });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});

// Delete address
router.delete('/:id', protect, async (req, res) => {
  try {
    const addr = await Address.findById(req.params.id);
    if (!addr) {
      return res.status(404).json({ success: false, message: 'Address not found' });
    }
    if (addr.userId.toString() !== req.user._id.toString()) {
      return res.status(401).json({ success: false, message: 'Not authorized' });
    }

    await Address.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Address removed' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});

// Set default address
router.put('/:id/default', protect, async (req, res) => {
  try {
    const addr = await Address.findById(req.params.id);
    if (!addr) {
      return res.status(404).json({ success: false, message: 'Address not found' });
    }
    if (addr.userId.toString() !== req.user._id.toString()) {
      return res.status(401).json({ success: false, message: 'Not authorized' });
    }

    // Unset all other defaults
    await Address.updateMany(
      { userId: req.user._id },
      { $set: { isDefault: false } }
    );

    // Set this one as default
    addr.isDefault = true;
    await addr.save();

    res.json({ success: true, address: addr });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});

module.exports = router;
