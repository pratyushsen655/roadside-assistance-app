const express = require('express');
const jwt = require('jsonwebtoken');

const router = express.Router();

// JWT Secret fallback
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_in_env';

// Admin JWT protection middleware
const adminMiddleware = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No authorization token provided',
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    // TypeScript check bypass: JSDoc typecast
    const payload = /** @type {any} */ (decoded);
    if (payload.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin role required.',
      });
    }

    req.user = payload;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token',
      error: error.message,
    });
  }
};

// POST /api/admin/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (email === 'admin@roadside.com' && password === 'admin123') {
      const token = jwt.sign(
        { id: 'admin', role: 'admin', email },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      return res.status(200).json({
        success: true,
        message: 'Admin login successful',
        token
      });
    } else {
      return res.status(401).json({
        success: false,
        message: 'Invalid admin credentials'
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Protected routes past this point
router.use(adminMiddleware);

// GET /api/admin/settings
router.get('/settings', async (req, res) => {
  try {
    const Setting = require('../models/Setting');
    
    // Find or initialize defaults
    let autoPromptDelay = await Setting.findOne({ key: 'autoPromptDelay' });
    if (!autoPromptDelay) autoPromptDelay = await Setting.create({ key: 'autoPromptDelay', value: 120 });

    let maxPriceIncrease = await Setting.findOne({ key: 'maxPriceIncrease' });
    if (!maxPriceIncrease) maxPriceIncrease = await Setting.create({ key: 'maxPriceIncrease', value: 1000 });

    let maxRetries = await Setting.findOne({ key: 'maxRetries' });
    if (!maxRetries) maxRetries = await Setting.create({ key: 'maxRetries', value: 3 });

    res.status(200).json({
      success: true,
      settings: {
        autoPromptDelay: Number(autoPromptDelay.value),
        maxPriceIncrease: Number(maxPriceIncrease.value),
        maxRetries: Number(maxRetries.value)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/admin/settings
router.put('/settings', async (req, res) => {
  try {
    const Setting = require('../models/Setting');
    const { autoPromptDelay, maxPriceIncrease, maxRetries } = req.body;

    if (autoPromptDelay !== undefined) {
      await Setting.findOneAndUpdate({ key: 'autoPromptDelay' }, { value: Number(autoPromptDelay) }, { upsert: true });
    }
    if (maxPriceIncrease !== undefined) {
      await Setting.findOneAndUpdate({ key: 'maxPriceIncrease' }, { value: Number(maxPriceIncrease) }, { upsert: true });
    }
    if (maxRetries !== undefined) {
      await Setting.findOneAndUpdate({ key: 'maxRetries' }, { value: Number(maxRetries) }, { upsert: true });
    }

    res.status(200).json({
      success: true,
      message: 'Settings updated successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/admin/stats
router.get('/stats', async (req, res) => {
  try {
    const User = require('../models/User');
    const Mechanic = require('../models/Mechanic');
    const ServiceRequest = require('../models/ServiceRequest');

    const totalCustomers = await User.countDocuments({ role: 'user' });
    const totalMechanics = await Mechanic.countDocuments();
    const totalJobs = await ServiceRequest.countDocuments();

    const completedJobs = await ServiceRequest.find({ status: 'completed' });
    const paidJobs = completedJobs.filter(j => j.paymentStatus === 'paid');
    const totalRevenue = paidJobs.reduce((sum, j) => sum + (j.pricing?.totalAmount || 0), 0);
    const onlineMechanics = await Mechanic.countDocuments({ isOnline: true });

    // Job counts by status
    const pendingJobs = await ServiceRequest.countDocuments({ status: 'pending' });
    const acceptedJobs = await ServiceRequest.countDocuments({ status: 'accepted' });
    const completedJobsCount = completedJobs.length;
    const cancelledJobs = await ServiceRequest.countDocuments({ status: 'cancelled' });

    // Last 7 days revenue chart data
    const revenueData = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateString = date.toLocaleDateString('en-US', { weekday: 'short' });

      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      const jobsOfDay = completedJobs.filter(j => j.paymentStatus === 'paid' && j.completedAt >= startOfDay && j.completedAt <= endOfDay);
      const earnings = jobsOfDay.reduce((sum, j) => sum + (j.pricing?.totalAmount || 0), 0);

      revenueData.push({
        name: dateString,
        earnings
      });
    }

    // Recent jobs table data (last 10 jobs)
    const recentRequests = await ServiceRequest.find()
      .populate('customer', 'name phone')
      .populate('mechanic', 'name phone')
      .sort({ createdAt: -1 })
      .limit(10);

    const recentJobs = recentRequests.map(job => {
      const cust = /** @type {any} */ (job.customer);
      const mech = /** @type {any} */ (job.mechanic);
      return {
        id: job._id.toString(),
        customer: cust?.name || 'Customer',
        mechanic: mech?.name || 'Unassigned',
        status: job.status,
        paymentStatus: job.paymentStatus || 'pending',
        amount: `₹${job.pricing?.totalAmount || 0}`,
        date: new Date(job.createdAt).toLocaleDateString()
      };
    });

    res.status(200).json({
      success: true,
      stats: {
        totalCustomers,
        totalMechanics,
        totalJobs,
        totalRevenue,
        onlineMechanics
      },
      revenueData,
      jobsByStatus: [
        { name: 'Pending', value: pendingJobs },
        { name: 'Accepted', value: acceptedJobs },
        { name: 'Completed', value: completedJobsCount },
        { name: 'Cancelled', value: cancelledJobs }
      ],
      recentJobs
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/admin/customers
router.get('/customers', async (req, res) => {
  try {
    const User = require('../models/User');
    const ServiceRequest = require('../models/ServiceRequest');
    const customers = await User.find({ role: 'user' }).sort({ createdAt: -1 });

    const customersWithJobs = await Promise.all(customers.map(async (cust) => {
      const jobCount = await ServiceRequest.countDocuments({ customer: cust._id });
      // Fetch user's requests history
      const history = await ServiceRequest.find({ customer: cust._id })
        .populate('mechanic', 'name phone')
        .sort({ createdAt: -1 });

      const mappedHistory = history.map(h => {
        const mech = /** @type {any} */ (h.mechanic);
        return {
          id: h._id.toString(),
          date: new Date(h.createdAt).toLocaleDateString(),
          issue: h.issueDescription || h.serviceType,
          mechanicName: mech?.name || 'Unassigned',
          status: h.status,
          amount: `₹${h.pricing?.totalAmount || 0}`
        };
      });

      return {
        _id: cust._id.toString(),
        name: cust.name || 'Anonymous',
        phone: cust.phone,
        email: cust.email || 'N/A',
        vehicleMake: cust.vehicleMake || 'N/A',
        vehicleModel: cust.vehicleModel || 'N/A',
        totalJobs: jobCount,
        joinDate: new Date(cust.createdAt).toLocaleDateString(),
        isBlocked: cust.isBlocked || false,
        history: mappedHistory
      };
    }));

    res.status(200).json({ success: true, customers: customersWithJobs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/admin/customers/:id/block
router.put('/customers/:id/block', async (req, res) => {
  try {
    const User = require('../models/User');
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    user.isBlocked = !user.isBlocked;
    await user.save();
    res.status(200).json({ success: true, isBlocked: user.isBlocked });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/admin/mechanics
router.get('/mechanics', async (req, res) => {
  try {
    const Mechanic = require('../models/Mechanic');
    const ServiceRequest = require('../models/ServiceRequest');
    const mechanics = await Mechanic.find().sort({ createdAt: -1 });

    const mechanicsWithJobs = await Promise.all(mechanics.map(async (mech) => {
      const jobCount = await ServiceRequest.countDocuments({ mechanic: mech._id });
      // Fetch request history
      const history = await ServiceRequest.find({ mechanic: mech._id })
        .populate('customer', 'name phone')
        .sort({ createdAt: -1 });

      const mappedHistory = history.map(h => {
        const cust = /** @type {any} */ (h.customer);
        return {
          id: h._id.toString(),
          date: new Date(h.createdAt).toLocaleDateString(),
          issue: h.issueDescription || h.serviceType,
          customerName: cust?.name || 'Customer',
          status: h.status,
          amount: `₹${h.pricing?.totalAmount || 0}`
        };
      });

      return {
        _id: mech._id.toString(),
        name: mech.name || 'Mechanic',
        phone: mech.phone,
        rating: mech.rating || mech.averageRating || 5.0,
        totalJobs: jobCount,
        earnings: mech.earnings || 0,
        isOnline: mech.isOnline || false,
        isVerified: mech.isVerified || false,
        isBlocked: mech.isBlocked || false,
        bio: mech.bio || '',
        experience: mech.experience || 0,
        vehicleSpecializations: mech.vehicleSpecializations || [],
        history: mappedHistory
      };
    }));

    res.status(200).json({ success: true, mechanics: mechanicsWithJobs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/admin/mechanics/:id/verify
router.put('/mechanics/:id/verify', async (req, res) => {
  try {
    const Mechanic = require('../models/Mechanic');
    const mechanic = await Mechanic.findById(req.params.id);
    if (!mechanic) {
      return res.status(404).json({ success: false, message: 'Mechanic not found' });
    }
    mechanic.isVerified = true;
    if (mechanic.kyc) {
      mechanic.kyc.status = 'approved';
    }
    await mechanic.save();
    res.status(200).json({ success: true, isVerified: mechanic.isVerified });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/admin/mechanics/:id/block
router.put('/mechanics/:id/block', async (req, res) => {
  try {
    const Mechanic = require('../models/Mechanic');
    const mechanic = await Mechanic.findById(req.params.id);
    if (!mechanic) {
      return res.status(404).json({ success: false, message: 'Mechanic not found' });
    }
    mechanic.isBlocked = !mechanic.isBlocked;
    await mechanic.save();
    res.status(200).json({ success: true, isBlocked: mechanic.isBlocked });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/admin/jobs
router.get('/jobs', async (req, res) => {
  try {
    const ServiceRequest = require('../models/ServiceRequest');
    const requests = await ServiceRequest.find()
      .populate('customer', 'name phone')
      .populate('mechanic', 'name phone')
      .sort({ createdAt: -1 });

    const jobs = requests.map(j => {
      const cust = /** @type {any} */ (j.customer);
      const mech = /** @type {any} */ (j.mechanic);
      return {
        id: j._id.toString(),
        customer: cust?.name || 'Customer',
        customerPhone: cust?.phone || '',
        mechanic: mech?.name || 'Unassigned',
        mechanicPhone: mech?.phone || '',
        issueType: j.serviceType,
        description: j.issueDescription || '',
        status: j.status,
        paymentStatus: j.paymentStatus || 'pending',
        amount: `₹${j.pricing?.totalAmount || 0}`,
        date: new Date(j.createdAt).toLocaleDateString(),
        createdAt: j.createdAt,
        initialPrice: j.initial_price || 0,
        currentPrice: j.current_price || j.amount || 0,
        priceHistory: j.price_history || [],
        acceptedPrice: j.accepted_price || null
      };
    });

    res.status(200).json({ success: true, jobs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/admin/earnings
router.get('/earnings', async (req, res) => {
  try {
    const ServiceRequest = require('../models/ServiceRequest');
    const Mechanic = require('../models/Mechanic');

    const completedRequests = await ServiceRequest.find({ status: 'completed', paymentStatus: 'paid' })
      .populate('mechanic', 'name phone');

    const totalRevenue = completedRequests.reduce((sum, j) => sum + (j.pricing?.totalAmount || 0), 0);

    const monthlyEarnings = [];
    for (let i = 5; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const monthName = date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

      const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
      const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);

      const jobsOfMonth = completedRequests.filter(j => j.completedAt >= startOfMonth && j.completedAt <= endOfMonth);
      const revenue = jobsOfMonth.reduce((sum, j) => sum + (j.pricing?.totalAmount || 0), 0);

      monthlyEarnings.push({
        name: monthName,
        revenue
      });
    }

    const mechanics = await Mechanic.find();
    const payouts = mechanics.map(mech => {
      const completedJobs = completedRequests.filter(j => j.mechanic?._id?.toString() === mech._id.toString());
      const totalEarned = completedJobs.reduce((sum, j) => sum + (j.pricing?.totalAmount || 0), 0);

      return {
        id: mech._id.toString(),
        name: mech.name || 'Mechanic',
        totalEarned,
        pendingPayout: Math.round(totalEarned * 0.15),
        paidOut: Math.round(totalEarned * 0.85),
        payoutStatus: mech.earnings > 0 ? 'pending' : 'paid'
      };
    });

    res.status(200).json({
      success: true,
      totalRevenue,
      monthlyEarnings,
      payouts
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/admin/notifications/send
router.post('/notifications/send', async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    const User = require('../models/User');
    const Mechanic = require('../models/Mechanic');

    const { target, title, message } = req.body;

    // Direct fetch history check (triggered by admin dashboard page load)
    if (target === 'history') {
      const history = await Notification.find({ type: 'admin_broadcast' })
        .sort({ createdAt: -1 })
        .limit(10);

      const formattedHistory = history.map(h => ({
        id: h._id.toString(),
        title: h.title,
        message: h.body,
        target: 'broadcast',
        date: new Date(h.createdAt).toLocaleDateString()
      }));

      return res.status(200).json({
        success: true,
        message: 'History fetched successfully',
        history: formattedHistory
      });
    }

    if (!title || !message) {
      return res.status(400).json({ success: false, message: 'Title and message are required' });
    }

    let recipients = [];
    let tokens = [];

    if (target === 'customers') {
      recipients = await User.find({ role: 'user' }).select('_id');
      const users = await User.find({ role: 'user' }).select('pushToken fcmToken');
      tokens = users.map(u => u.pushToken || u.fcmToken).filter(t => !!t);
    } else if (target === 'mechanics') {
      recipients = await Mechanic.find().select('_id');
      const mechanics = await Mechanic.find().select('pushToken fcmToken');
      tokens = mechanics.map(m => m.pushToken || m.fcmToken).filter(t => !!t);
    } else {
      recipients = [{ _id: target }];
      try {
        const user = await User.findById(target).select('pushToken fcmToken');
        if (user && (user.pushToken || user.fcmToken)) {
          tokens.push(user.pushToken || user.fcmToken);
        }
      } catch (err) {}
      
      try {
        const mechanic = await Mechanic.findById(target).select('pushToken fcmToken');
        if (mechanic && (mechanic.pushToken || mechanic.fcmToken)) {
          tokens.push(mechanic.pushToken || mechanic.fcmToken);
        }
      } catch (err) {}
    }

    const notifRecords = recipients.map(recipient => ({
      userId: recipient._id,
      title,
      body: message,
      type: 'admin_broadcast',
      isRead: false
    }));

    if (notifRecords.length > 0) {
      await Notification.insertMany(notifRecords);
    }

    // Trigger FCM Multicast Push
    if (tokens.length > 0) {
      try {
        const { sendMulticastNotification } = require('../services/pushNotificationService');
        await sendMulticastNotification(tokens, title, message);
      } catch (pushErr) {
        console.error('[Admin Broadcast Push Error]', pushErr.message);
      }
    }

    const history = await Notification.find({ type: 'admin_broadcast' })
      .sort({ createdAt: -1 })
      .limit(10);

    const formattedHistory = history.map(h => ({
      id: h._id.toString(),
      title: h.title,
      message: h.body,
      target: target,
      date: new Date(h.createdAt).toLocaleDateString()
    }));

    res.status(200).json({
      success: true,
      message: `Notification broadcasted to ${recipients.length} users`,
      history: formattedHistory
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/admin/jobs/:id/cancel
router.put('/jobs/:id/cancel', async (req, res) => {
  try {
    const ServiceRequest = require('../models/ServiceRequest');
    const Mechanic = require('../models/Mechanic');

    const request = await ServiceRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    request.status = 'cancelled';
    request.cancelledBy = 'admin';
    await request.save();

    if (request.mechanic) {
      await Mechanic.findByIdAndUpdate(request.mechanic, {
        activeRequestId: null,
        status: 'online'
      });
    }

    if (/** @type {any} */ (req).io) {
      /** @type {any} */ (req).io.to(`job:${request._id}`).emit('job:status:changed', { status: 'cancelled' });
    }

    res.status(200).json({
      success: true,
      message: 'Job cancelled successfully',
      request
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
