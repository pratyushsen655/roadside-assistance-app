const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  label: {
    type: String,
    required: true,
    enum: ['Home', 'Work', 'Other']
  },
  address: {
    type: String,
    required: true
  },
  landmark: {
    type: String
  },
  location: {
    lat: {
      type: Number
    },
    lng: {
      type: Number
    }
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Address', addressSchema);
