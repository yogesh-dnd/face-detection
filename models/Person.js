// models/Person.js - Updated for Face++ API
const mongoose = require('mongoose');

const personSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  // Face++ specific data
  faceSetToken: {
    type: String,
    required: true,
    unique: true
  },
  faceSetName: {
    type: String,
    required: true
  },
  faceTokens: [{
    type: String,
    required: true
  }],
  photos: [{
    filename: {
      type: String,
      required: true
    },
    originalName: {
      type: String,
      required: true
    },
    path: {
      type: String,
      required: true
    },
    faceToken: {
      type: String // Face++ face token for this specific photo
    }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes
personSchema.index({ name: 1 });
personSchema.index({ faceSetToken: 1 });
personSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Person', personSchema);