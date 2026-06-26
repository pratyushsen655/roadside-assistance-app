const Notification = require('../models/Notification');

const SAMPLE_NOTIFICATIONS = [
  {
    title: 'Welcome to RoadSide Assist! 🎉',
    body: 'Your account is ready. Request a mechanic anytime you need help.',
    type: 'message',
  },
  {
    title: 'Mechanic Assigned',
    body: 'A mechanic has been assigned to your request and is on the way.',
    type: 'mechanic_assigned',
  },
  {
    title: 'Earn ₹50 per Referral',
    body: 'Share your referral code with friends and earn ₹50 for every signup!',
    type: 'message',
  },
];

// GET /api/notifications
const getNotifications = async (req, res, next) => {
  try {
    let notifications = await Notification.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .lean();

    // Seed sample notifications for users who have none
    if (notifications.length === 0) {
      const seeded = await Notification.insertMany(
        SAMPLE_NOTIFICATIONS.map((n) => ({ ...n, userId: req.user.id }))
      );
      const leanSeeded = seeded.map(n => n.toObject());
      leanSeeded.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      notifications = leanSeeded;
    }

    res.status(200).json({ success: true, notifications });
  } catch (error) {
    next(error);
  }
};

// PUT /api/notifications/mark-all-read
const markAllRead = async (req, res, next) => {
  try {
    await Notification.updateMany(
      { userId: req.user.id, isRead: false },
      { $set: { isRead: true } }
    );
    res.status(200).json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    next(error);
  }
};

// PUT /api/notifications/:id/read
const markOneRead = async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { $set: { isRead: true } },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    res.status(200).json({ success: true, notification });
  } catch (error) {
    next(error);
  }
};

module.exports = { getNotifications, markAllRead, markOneRead };
