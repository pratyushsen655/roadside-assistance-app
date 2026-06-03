const Chat = require('../models/Chat');
const ServiceRequest = require('../models/ServiceRequest');

// @desc    Get all chat messages for a specific service request
// @route   GET /api/chats/:requestId
// @access  Private (Customer/Mechanic)
exports.getChatMessages = async (req, res, next) => {
  const requestId = req.params.requestId;
  const userId = req.user.id;

  try {
    const request = await ServiceRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Breakdown request not found.' });
    }

    // Verify requesting user belongs to the transaction
    if (request.customer.toString() !== userId.toString() && 
        (request.mechanic && request.mechanic.toString() !== userId.toString())) {
      return res.status(403).json({ success: false, message: 'Not authorized to view messages for this request.' });
    }

    const messages = await Chat.find({ serviceRequest: requestId })
      .populate('sender', 'name avatar')
      .sort({ createdAt: 1 });

    res.status(200).json({
      success: true,
      count: messages.length,
      data: messages
    });

  } catch (error) {
    next(error);
  }
};
