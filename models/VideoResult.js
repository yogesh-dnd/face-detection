const mongoose = require('mongoose');

const videoResultSchema = new mongoose.Schema({
  videoId: {
    type: String,
    required: true,
    unique: true
  },
  originalName: {
    type: String,
    required: true
  },
  videoPath: {
    type: String,
    required: true
  },
  results: [{
    personId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Person',
      required: true
    },
    personName: {
      type: String,
      required: true
    },
    matches: [{
      timestamp: {
        type: Number,
        required: true
      },
      timestampFormatted: {
        type: String,
        required: false
      },
      confidence: {
        type: Number,
        required: true
      },
      frame: {
        type: String,
        required: true
      },
      faceToken: {
        type: String,
        required: false
      },
      // ✅ Added bounding box support
      boundingBox: {
        x: {
          type: Number,
          required: false
        },
        y: {
          type: Number,
          required: false
        },
        width: {
          type: Number,
          required: false
        },
        height: {
          type: Number,
          required: false
        }
      }
    }]
  }],
  // Additional metadata
  processingMetadata: {
    framesExtracted: {
      type: Number,
      required: false
    },
    framesProcessed: {
      type: Number,
      required: false
    },
    processingTimeMs: {
      type: Number,
      required: false
    },
    fpsUsed: {
      type: Number,
      required: false,
      default: 1
    },
    confidenceThreshold: {
      type: Number,
      required: false,
      default: 0.8
    }
  },
  processedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for better performance
videoResultSchema.index({ videoId: 1 });
videoResultSchema.index({ processedAt: -1 });
videoResultSchema.index({ 'results.personId': 1 });
videoResultSchema.index({ 'results.matches.timestamp': 1 });

// Virtual for total matches count
videoResultSchema.virtual('totalMatches').get(function() {
  return this.results.reduce((total, result) => {
    return total + result.matches.length;
  }, 0);
});

// Virtual for unique persons detected
videoResultSchema.virtual('uniquePersonsDetected').get(function() {
  return this.results.length;
});

// Method to get matches for a specific person
videoResultSchema.methods.getMatchesForPerson = function(personId) {
  const personResult = this.results.find(result => 
    result.personId.toString() === personId.toString()
  );
  return personResult ? personResult.matches : [];
};

// Method to get matches within a time range
videoResultSchema.methods.getMatchesInTimeRange = function(startTime, endTime) {
  const matches = [];
  this.results.forEach(personResult => {
    personResult.matches.forEach(match => {
      if (match.timestamp >= startTime && match.timestamp <= endTime) {
        matches.push({
          ...match.toObject(),
          personId: personResult.personId,
          personName: personResult.personName
        });
      }
    });
  });
  return matches.sort((a, b) => a.timestamp - b.timestamp);
};

// Method to get high confidence matches only
videoResultSchema.methods.getHighConfidenceMatches = function(minConfidence = 0.9) {
  const matches = [];
  this.results.forEach(personResult => {
    personResult.matches.forEach(match => {
      if (match.confidence >= minConfidence) {
        matches.push({
          ...match.toObject(),
          personId: personResult.personId,
          personName: personResult.personName
        });
      }
    });
  });
  return matches.sort((a, b) => b.confidence - a.confidence);
};

// Static method to get processing statistics
videoResultSchema.statics.getProcessingStats = async function() {
  const stats = await this.aggregate([
    {
      $group: {
        _id: null,
        totalVideos: { $sum: 1 },
        totalMatches: { 
          $sum: { 
            $sum: { 
              $map: { 
                input: '$results', 
                as: 'result', 
                in: { $size: '$$result.matches' } 
              } 
            } 
          } 
        },
        avgMatchesPerVideo: { 
          $avg: { 
            $sum: { 
              $map: { 
                input: '$results', 
                as: 'result', 
                in: { $size: '$$result.matches' } 
              } 
            } 
          } 
        },
        avgConfidence: {
          $avg: {
            $avg: {
              $map: {
                input: {
                  $reduce: {
                    input: '$results',
                    initialValue: [],
                    in: { $concatArrays: ['$$value', '$$this.matches'] }
                  }
                },
                as: 'match',
                in: '$$match.confidence'
              }
            }
          }
        }
      }
    }
  ]);
  
  return stats[0] || {
    totalVideos: 0,
    totalMatches: 0,
    avgMatchesPerVideo: 0,
    avgConfidence: 0
  };
};

// Pre-save middleware to add processing metadata
videoResultSchema.pre('save', function(next) {
  if (this.isNew) {
    // Calculate total matches
    const totalMatches = this.results.reduce((total, result) => {
      return total + result.matches.length;
    }, 0);
    
    // Set processing metadata if not already set
    if (!this.processingMetadata) {
      this.processingMetadata = {};
    }
    
    if (!this.processingMetadata.framesProcessed && totalMatches > 0) {
      // Estimate frames processed based on matches and assuming some detection rate
      this.processingMetadata.framesProcessed = Math.ceil(totalMatches * 1.5);
    }
  }
  next();
});

// Ensure virtuals are included in JSON output
videoResultSchema.set('toJSON', { virtuals: true });
videoResultSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('VideoResult', videoResultSchema);