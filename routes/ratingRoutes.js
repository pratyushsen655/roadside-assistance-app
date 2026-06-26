const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const Rating = require('../models/Rating');
const Mechanic = require('../models/Mechanic');
const ServiceRequest = require('../models/ServiceRequest');

const router = express.Router();

// POST /api/ratings — customer submits rating
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { jobId, serviceRequest, rating, review, tags } = req.body;
    const finalJobId = jobId || serviceRequest;

    if (!finalJobId || !rating || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: 'Job ID and rating (1-5) are required' });
    }

    const job = await ServiceRequest.findById(finalJobId);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Service request not found' });
    }

    // Check if already rated
    const existingRating = await Rating.findOne({ jobId: finalJobId });
    if (existingRating) {
      return res.status(400).json({ success: false, message: 'You have already rated this service request' });
    }

    const customerId = req.user.id;
    const mechanicId = job.mechanic;

    if (!mechanicId) {
      return res.status(400).json({ success: false, message: 'No mechanic was assigned to this job' });
    }

    const newRating = await Rating.create({
      jobId: finalJobId,
      customerId,
      mechanicId,
      rating,
      review: review || '',
      tags: tags || []
    });

    // Recalculate mechanic stats
    const ratings = await Rating.find({ mechanicId });
    const avg = ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length;

    const breakdownKey = ['one', 'two', 'three', 'four', 'five'][rating - 1];

    await Mechanic.findByIdAndUpdate(mechanicId, {
      rating: Math.round(avg * 10) / 10,
      totalRatings: ratings.length,
      $inc: { [`ratingBreakdown.${breakdownKey}`]: 1 }
    });

    res.status(201).json({
      success: true,
      message: 'Rating submitted successfully',
      rating: newRating
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/ratings/mechanic/:mechanicId — get all ratings for a mechanic (public)
router.get('/mechanic/:mechanicId', async (req, res) => {
  try {
    const ratings = await Rating.find({ mechanicId: req.params.mechanicId })
      .populate('customerId', 'name')
      .sort({ createdAt: -1 });

    res.json({ success: true, ratings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/ratings/my-ratings — get all ratings given by logged-in customer
router.get('/my-ratings', authMiddleware, async (req, res) => {
  try {
    const ratings = await Rating.find({ customerId: req.user.id })
      .populate('mechanicId', 'name')
      .sort({ createdAt: -1 });

    res.json({ success: true, ratings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/ratings/:id/reply — mechanic replies to a review
router.put('/:id/reply', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'mechanic') {
      return res.status(403).json({ success: false, message: 'Access denied. Mechanic only.' });
    }

    const { reply } = req.body;
    if (!reply) {
      return res.status(400).json({ success: false, message: 'Reply text is required' });
    }

    const rating = await Rating.findById(req.params.id);
    if (!rating) {
      return res.status(404).json({ success: false, message: 'Rating not found' });
    }

    // Verify rating is for this mechanic
    // req.user.id maps to the User ID. In mechanicRoutes/mechanic model, a Mechanic document
    // is identified by req.user.id (or userId in mechanic profile).
    // Let's resolve the Mechanic document for the logged-in user.
    const Mechanic = require('../models/Mechanic');
    const mechanic = await Mechanic.findById(req.user.id);
    if (!mechanic || rating.mechanicId.toString() !== mechanic._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized to reply to this rating' });
    }

    rating.mechanicReply = reply;
    await rating.save();

    res.json({ success: true, message: 'Reply submitted successfully', rating });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/ratings/job/:jobId — check if rating exists for a job
router.get('/job/:jobId', async (req, res) => {
  try {
    const rating = await Rating.findOne({ jobId: req.params.jobId });
    res.json({
      success: true,
      exists: !!rating,
      rating: rating || null
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
