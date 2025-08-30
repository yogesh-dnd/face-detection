const express = require('express');
const multer = require('multer');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const FaceRecognitionService = require('./services/faceRecognitionService');
const Person = require('./models/Person');
const VideoResult = require('./models/VideoResult');

const app = express();
const PORT = process.env.PORT || 5000;

// Ensure directories exist
fs.ensureDirSync('./uploads');
fs.ensureDirSync('./temp');
fs.ensureDirSync('./public/results');
fs.ensureDirSync('./public/frames');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Serve frames directory specifically for face highlighting
app.use('/frames', express.static(path.join(__dirname, 'public/frames')));

// Multer configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueName = uuidv4() + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  }
});

// Initialize face recognition service
const faceService = new FaceRecognitionService();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/facerecognition', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Face Recognition API is running with Face++' });
});

// Create a person with photos
app.post('/api/persons', upload.array('photos', 10), async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name || !req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Name and at least one photo are required' });
    }

    console.log(`Creating person: ${name} with ${req.files.length} photos`);

    // Create Face++ faceset and process photos
    const personId = new mongoose.Types.ObjectId();
    const imagePaths = req.files.map(file => file.path);
    
    try {
      const faceSetData = await faceService.createPersonFaceSet(personId, name, imagePaths);
      
      // Process photos and get face tokens
      const photoFiles = [];
      let validPhotoCount = 0;
      
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        const face = await faceService.detectFace(file.path);
        
        if (face && face.face_token) {
          photoFiles.push({
            filename: file.filename,
            originalName: file.originalname,
            path: file.path,
            faceToken: face.face_token
          });
          validPhotoCount++;
          console.log(`✅ Processed ${file.originalname} - Face token: ${face.face_token}`);
        } else {
          console.log(`❌ No face found in ${file.originalname}`);
          // Delete file if no face found
          fs.unlinkSync(file.path);
        }
      }

      if (validPhotoCount === 0) {
        return res.status(400).json({ error: 'No faces found in uploaded photos' });
      }

      // Save person to database
      const person = new Person({
        _id: personId,
        name,
        faceSetToken: faceSetData.faceSetToken,
        faceSetName: faceSetData.faceSetName,
        faceTokens: faceSetData.faceTokens,
        photos: photoFiles
      });

      await person.save();

      res.json({ 
        success: true, 
        personId: person._id,
        name: person.name,
        faceSetToken: person.faceSetToken,
        facesCount: validPhotoCount 
      });

    } catch (error) {
      // Cleanup uploaded files if Face++ processing fails
      req.files.forEach(file => {
        fs.unlink(file.path).catch(console.error);
      });
      throw error;
    }

  } catch (error) {
    console.error('Error creating person:', error);
    res.status(500).json({ error: 'Failed to create person: ' + error.message });
  }
});

// Get all persons
app.get('/api/persons', async (req, res) => {
  try {
    const persons = await Person.find({}, 'name _id createdAt faceSetToken').sort({ createdAt: -1 });
    res.json(persons);
  } catch (error) {
    console.error('Error fetching persons:', error);
    res.status(500).json({ error: 'Failed to fetch persons' });
  }
});

// Process video - Updated to include bounding box data
app.post('/api/process-video', upload.single('video'), async (req, res) => {
  try {
    const { personIds } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'Video file is required' });
    }

    if (!personIds) {
      return res.status(400).json({ error: 'Person IDs are required' });
    }

    const videoPath = req.file.path;
    const videoId = uuidv4();
    
    console.log(`Processing video: ${req.file.originalname}`);
    console.log(`Looking for persons: ${personIds}`);

    // Get persons with their facesets from database
    const persons = await Person.find({ _id: { $in: personIds.split(',') } });
    
    if (persons.length === 0) {
      return res.status(400).json({ error: 'No valid persons found' });
    }

    console.log(`Loaded ${persons.length} persons with facesets`);

    // Process video using Face++ API
    const results = await faceService.findFacesInVideo(videoPath, persons);

    // Group results by person and remove duplicates - INCLUDING bounding box data
    const groupedResults = {};
    results.forEach(result => {
      const key = result.personId;
      if (!groupedResults[key]) {
        groupedResults[key] = {
          personId: result.personId,
          personName: result.personName,
          matches: []
        };
      }
      
      // Include ALL detection data including bounding box
      groupedResults[key].matches.push({
        timestamp: result.timestamp,
        timestampFormatted: result.timestampFormatted,
        confidence: result.confidence,
        frame: result.frame,
        faceToken: result.faceToken,
        boundingBox: result.boundingBox // ✅ Include bounding box data
      });
    });

    // Remove duplicate timestamps (within 2 seconds of each other for Face++ API)
    Object.keys(groupedResults).forEach(key => {
      const matches = groupedResults[key].matches;
      const filtered = [];
      matches.sort((a, b) => a.timestamp - b.timestamp);
      
      matches.forEach(match => {
        if (filtered.length === 0 || match.timestamp - filtered[filtered.length - 1].timestamp > 2) {
          filtered.push(match);
        }
      });
      
      groupedResults[key].matches = filtered;
    });

    // Save results to database - Updated schema to include bounding box
    const videoResult = new VideoResult({
      videoId,
      originalName: req.file.originalname,
      videoPath,
      results: Object.values(groupedResults).map(personResult => ({
        personId: personResult.personId,
        personName: personResult.personName,
        matches: personResult.matches.map(match => ({
          timestamp: match.timestamp,
          timestampFormatted: match.timestampFormatted,
          confidence: match.confidence,
          frame: match.frame,
          faceToken: match.faceToken,
          boundingBox: match.boundingBox // ✅ Save bounding box to database
        }))
      })),
      processedAt: new Date()
    });

    await videoResult.save();

    // Cleanup video file after processing
    setTimeout(() => {
      fs.unlink(videoPath).catch(console.error);
    }, 300000); // Delete after 5 minutes

    // Return response with complete data including bounding boxes
    const responseData = {
      success: true,
      videoId,
      results: Object.values(groupedResults),
      totalMatches: results.length,
      processingDetails: {
        framesProcessed: results.length,
        personsSearched: persons.length,
        detectionThreshold: '80%'
      }
    };

    console.log(`✅ Returning ${responseData.results.length} person results with bounding box data`);
    res.json(responseData);

  } catch (error) {
    console.error('Error processing video:', error);
    res.status(500).json({ error: 'Failed to process video: ' + error.message });
  }
});

// Get processing result - Updated to include bounding box data
app.get('/api/results/:videoId', async (req, res) => {
  try {
    const result = await VideoResult.findOne({ videoId: req.params.videoId });
    if (!result) {
      return res.status(404).json({ error: 'Result not found' });
    }
    
    // Ensure the response includes all bounding box data
    const responseData = {
      ...result.toObject(),
      results: result.results.map(personResult => ({
        ...personResult,
        matches: personResult.matches.map(match => ({
          timestamp: match.timestamp,
          timestampFormatted: match.timestampFormatted,
          confidence: match.confidence,
          frame: match.frame,
          faceToken: match.faceToken,
          boundingBox: match.boundingBox // ✅ Include bounding box in response
        }))
      }))
    };
    
    res.json(responseData);
  } catch (error) {
    console.error('Error fetching result:', error);
    res.status(500).json({ error: 'Failed to fetch result' });
  }
});

// Delete person
app.delete('/api/persons/:id', async (req, res) => {
  try {
    const person = await Person.findById(req.params.id);
    if (!person) {
      return res.status(404).json({ error: 'Person not found' });
    }

    // Delete Face++ faceset
    if (person.faceSetToken) {
      await faceService.deleteFaceSet(person.faceSetToken);
    }

    // Delete associated photo files
    person.photos.forEach(photo => {
      fs.unlink(photo.path).catch(console.error);
    });

    await Person.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting person:', error);
    res.status(500).json({ error: 'Failed to delete person' });
  }
});

// New endpoint: Get frame image with highlighting data
app.get('/api/frame/:frameId', async (req, res) => {
  try {
    const frameId = req.params.frameId;
    const framePath = path.join(__dirname, 'public', 'frames', frameId);
    
    if (!fs.existsSync(framePath)) {
      return res.status(404).json({ error: 'Frame not found' });
    }
    
    res.sendFile(framePath);
  } catch (error) {
    console.error('Error serving frame:', error);
    res.status(500).json({ error: 'Failed to serve frame' });
  }
});

// New endpoint: Cleanup old frames (can be called manually or via cron)
app.post('/api/cleanup-frames', async (req, res) => {
  try {
    await faceService.cleanupOldFrames();
    res.json({ success: true, message: 'Frame cleanup completed' });
  } catch (error) {
    console.error('Error during cleanup:', error);
    res.status(500).json({ error: 'Cleanup failed' });
  }
});

// New endpoint: Get processing statistics
app.get('/api/stats', async (req, res) => {
  try {
    const personCount = await Person.countDocuments();
    const videoResultCount = await VideoResult.countDocuments();
    
    // Count total matches across all video results
    const videoResults = await VideoResult.find({}, 'results');
    const totalMatches = videoResults.reduce((total, result) => {
      return total + result.results.reduce((sum, personResult) => {
        return sum + personResult.matches.length;
      }, 0);
    }, 0);

    res.json({
      persons: personCount,
      videosProcessed: videoResultCount,
      totalMatches: totalMatches,
      avgMatchesPerVideo: videoResultCount > 0 ? (totalMatches / videoResultCount).toFixed(2) : 0
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// Initialize face recognition service and start server
async function startServer() {
  try {
    console.log('Initializing Face++ API service...');
    await faceService.initialize();
    console.log('✅ Face++ API service initialized');
    
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📋 API endpoints:`);
      console.log(`   GET  /api/health - Health check`);
      console.log(`   POST /api/persons - Create person with photos`);
      console.log(`   GET  /api/persons - Get all persons`);
      console.log(`   POST /api/process-video - Process video for face recognition`);
      console.log(`   GET  /api/results/:videoId - Get processing results`);
      console.log(`   DELETE /api/persons/:id - Delete person`);
      console.log(`   GET  /api/frame/:frameId - Serve frame image`);
      console.log(`   POST /api/cleanup-frames - Cleanup old frames`);
      console.log(`   GET  /api/stats - Get processing statistics`);
      console.log(`\n⚡ Using Face++ API for face recognition`);
      console.log(`🖼️  Frame images served from: /frames/`);
      console.log(`📦 Bounding box data included in all responses`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();