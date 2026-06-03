const mongoose = require('mongoose');

const RatingSchema = new mongoose.Schema({
  serviceRequest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ServiceRequest',
    required: true,
  },
  from: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'fromModel',
  },
  fromModel: {
    type: String,
    required: true,
    enum: ['User', 'Mechanic'],
  },
  to: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'toModel',
  },
  toModel: {
    type: String,
    required: true,
    enum: ['User', 'Mechanic'],
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
  },
  review: {
    type: String,
    trim: true,
    default: '',
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Rating', RatingSchema);
