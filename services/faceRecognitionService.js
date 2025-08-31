const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs-extra');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { v4: uuidv4 } = require('uuid');

class FaceRecognitionService {
  constructor() {
    // Face++ API credentials
    this.apiKey = process.env.FACEPLUS_API_KEY || '8VGYHrSCqqoRrXOAzIf5JBOsENzdMwPn';
    this.apiSecret = process.env.FACEPLUS_API_SECRET || 'HCCAZI2S6J32dL-T9DiAq119QyRJvlz0';
    this.baseUrl = 'https://api-us.faceplusplus.com/facepp/v3';
    
    if (!this.apiKey || !this.apiSecret) {
      throw new Error('Face++ API credentials not found. Please set FACEPLUS_API_KEY and FACEPLUS_API_SECRET in your .env file');
    }

    // Enhanced rate limiting configuration
    this.rateLimitConfig = {
      maxConcurrent: 1,
      delayBetweenRequests: 3000, // 3 seconds between requests
      retryDelay: 5000,
      maxRetries: 3,
      backoffMultiplier: 2,
      maxFacesetsPerSearch: 5 // Reduced for better reliability
    };

    // Ensure public directories exist
    fs.ensureDirSync('./public/frames');
    fs.ensureDirSync('./public/results');
  }

  async initialize() {
    console.log('Face++ API service initialized with enhanced multi-person search');
    console.log('API Key:', this.apiKey.substring(0, 10) + '...');
    
    // Test API connection
    try {
      await this.testConnection();
      console.log('✅ Face++ API connection verified');
    } catch (error) {
      console.error('⚠️ Face++ API connection test failed:', error.message);
      console.log('Continuing without connection verification...');
    }
  }

  // Enhanced API request wrapper with better error handling
  async makeAPIRequest(requestFunction, requestName, maxRetries = this.rateLimitConfig.maxRetries) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Add delay before each request
        if (attempt > 1) {
          const backoffDelay = this.rateLimitConfig.retryDelay * Math.pow(this.rateLimitConfig.backoffMultiplier, attempt - 2);
          console.log(`  ⏳ Retry attempt ${attempt}/${maxRetries} for ${requestName}, waiting ${backoffDelay}ms...`);
          await this.delay(backoffDelay);
        } else {
          await this.delay(this.rateLimitConfig.delayBetweenRequests);
        }

        const result = await requestFunction();
        
        // Validate response
        if (result && result.error_message) {
          throw new Error(result.error_message);
        }
        
        await this.delay(500); // Extra delay after successful request
        return result;
        
      } catch (error) {
        const errorMsg = error.response?.data?.error_message || error.message;
        console.log(`  ⚠️ API error for ${requestName} (attempt ${attempt}/${maxRetries}): ${errorMsg}`);
        
        if (errorMsg.includes('CONCURRENCY_LIMIT_EXCEEDED') || 
            errorMsg.includes('RATE_LIMIT_EXCEEDED') ||
            errorMsg.includes('QPS_LIMIT_EXCEEDED')) {
          
          if (attempt === maxRetries) {
            console.error(`  ❌ Rate limit exceeded for ${requestName}`);
            return null;
          }
          continue;
        } 
        
        // Handle invalid faceset token specifically
        if (errorMsg.includes('INVALID_FACESET_TOKEN')) {
          console.error(`  ❌ Invalid faceset token for ${requestName}`);
          return { error: 'INVALID_FACESET_TOKEN', message: errorMsg };
        }
        
        if (attempt === maxRetries) {
          console.error(`  ❌ Max retries exceeded for ${requestName}`);
          return null;
        }
      }
    }
    
    return null;
  }

  async testConnection() {
    const requestFunction = async () => {
      const formData = new FormData();
      formData.append('api_key', this.apiKey);
      formData.append('api_secret', this.apiSecret);
      
      const response = await axios.post(`${this.baseUrl}/faceset/getfacesets`, formData, {
        headers: formData.getHeaders(),
        timeout: 15000
      });
      
      return response.data;
    };

    return await this.makeAPIRequest(requestFunction, 'testConnection', 1);
  }

  // ✅ FIXED: Validate faceset before using it
  async validateFaceSet(faceSetToken) {
    const requestFunction = async () => {
      const formData = new FormData();
      formData.append('api_key', this.apiKey);
      formData.append('api_secret', this.apiSecret);
      formData.append('faceset_token', faceSetToken);
      
      const response = await axios.post(`${this.baseUrl}/faceset/getdetail`, formData, {
        headers: formData.getHeaders(),
        timeout: 15000
      });
      
      return response.data;
    };

    const result = await this.makeAPIRequest(requestFunction, `validateFaceSet(${faceSetToken.substring(0, 20)}...)`);
    
    if (result && result.error) {
      console.log(`  ❌ Invalid faceset: ${faceSetToken.substring(0, 20)}...`);
      return false;
    }
    
    if (result && result.face_count !== undefined) {
      console.log(`  ✅ Valid faceset with ${result.face_count} faces`);
      return true;
    }
    
    return false;
  }

  async detectFace(imagePath) {
    const requestFunction = async () => {
      const imageBuffer = await fs.readFile(imagePath);
      const base64Image = imageBuffer.toString('base64');
      
      const formData = new FormData();
      formData.append('api_key', this.apiKey);
      formData.append('api_secret', this.apiSecret);
      formData.append('image_base64', base64Image);
      formData.append('return_landmark', '1');
      formData.append('return_attributes', 'age,gender,emotion');
      
      const response = await axios.post(`${this.baseUrl}/detect`, formData, {
        headers: formData.getHeaders(),
        timeout: 30000
      });

      return response.data;
    };

    try {
      const result = await this.makeAPIRequest(requestFunction, `detectFace(${path.basename(imagePath)})`);
      
      if (result && result.faces && result.faces.length > 0) {
        console.log(`✅ Face detected in ${path.basename(imagePath)}`);
        return result.faces[0];
      }
      
      console.log(`⚠️ No face detected in ${path.basename(imagePath)}`);
      return null;
    } catch (error) {
      console.error('Error detecting face:', error.message);
      return null;
    }
  }

  async createFaceSet(faceSetName) {
    const requestFunction = async () => {
      const formData = new FormData();
      formData.append('api_key', this.apiKey);
      formData.append('api_secret', this.apiSecret);
      formData.append('display_name', faceSetName);
      formData.append('outer_id', faceSetName);
      
      const response = await axios.post(`${this.baseUrl}/faceset/create`, formData, {
        headers: formData.getHeaders(),
        timeout: 30000
      });

      return response.data;
    };

    const result = await this.makeAPIRequest(requestFunction, `createFaceSet(${faceSetName})`);
    
    if (result && result.faceset_token) {
      console.log(`✅ Created faceset: ${faceSetName}`);
      return result.faceset_token;
    } else {
      throw new Error('Failed to create faceset after retries');
    }
  }

  async addFaceToFaceSet(faceSetToken, faceToken) {
    const requestFunction = async () => {
      const formData = new FormData();
      formData.append('api_key', this.apiKey);
      formData.append('api_secret', this.apiSecret);
      formData.append('faceset_token', faceSetToken);
      formData.append('face_tokens', faceToken);
      
      const response = await axios.post(`${this.baseUrl}/faceset/addface`, formData, {
        headers: formData.getHeaders(),
        timeout: 30000
      });

      return response.data;
    };

    const result = await this.makeAPIRequest(requestFunction, 'addFaceToFaceSet');
    
    if (result) {
      console.log(`✅ Added face to faceset`);
      return result;
    } else {
      throw new Error('Failed to add face to faceset after retries');
    }
  }

  // ✅ FIXED: Single person search with validation
  async searchSinglePerson(imageBuffer, person) {
    // First validate the faceset
    const isValid = await this.validateFaceSet(person.faceSetToken);
    if (!isValid) {
      console.log(`❌ Skipping invalid faceset for ${person.name}`);
      return null;
    }

    const requestFunction = async () => {
      const base64Image = imageBuffer.toString('base64');
      
      const formData = new FormData();
      formData.append('api_key', this.apiKey);
      formData.append('api_secret', this.apiSecret);
      formData.append('image_base64', base64Image);
      formData.append('faceset_token', person.faceSetToken);
      formData.append('return_result_count', '3');
      
      const response = await axios.post(`${this.baseUrl}/search`, formData, {
        headers: formData.getHeaders(),
        timeout: 30000
      });

      return response.data;
    };

    const result = await this.makeAPIRequest(requestFunction, `searchSinglePerson(${person.name})`);
    
    if (result && result.results && result.results.length > 0) {
      // Add person info to each result
      return result.results.map(match => ({
        ...match,
        personId: person._id,
        personName: person.name,
        faceSetToken: person.faceSetToken
      }));
    }
    
    return [];
  }

  // ✅ IMPROVED: Sequential search for multiple people (more reliable than batch)
  async searchMultiplePeopleSequential(imageBuffer, persons) {
    console.log(`  🔍 Searching for ${persons.length} people sequentially...`);
    
    const allResults = [];
    const validPersons = [];
    
    // First, validate all facesets
    for (const person of persons) {
      if (person.faceSetToken) {
        const isValid = await this.validateFaceSet(person.faceSetToken);
        if (isValid) {
          validPersons.push(person);
        } else {
          console.log(`❌ Removing invalid person: ${person.name}`);
        }
      }
    }
    
    if (validPersons.length === 0) {
      console.log('❌ No valid facesets available');
      return [];
    }
    
    console.log(`  ✅ Found ${validPersons.length} valid facesets`);
    
    // Search each person individually
    for (const person of validPersons) {
      console.log(`    🔍 Searching for ${person.name}...`);
      
      const personResults = await this.searchSinglePerson(imageBuffer, person);
      
      if (personResults && personResults.length > 0) {
        // Filter results by confidence threshold
        const goodMatches = personResults.filter(match => match.confidence > 75);
        if (goodMatches.length > 0) {
          console.log(`    ✅ Found ${goodMatches.length} matches for ${person.name}`);
          allResults.push(...goodMatches);
        }
      }
      
      // Add delay between person searches
      await this.delay(1000);
    }
    
    return allResults;
  }

  async detectFacesInFrame(imageBuffer) {
    const requestFunction = async () => {
      const base64Image = imageBuffer.toString('base64');
      
      const formData = new FormData();
      formData.append('api_key', this.apiKey);
      formData.append('api_secret', this.apiSecret);
      formData.append('image_base64', base64Image);
      formData.append('return_landmark', '1');
      
      const response = await axios.post(`${this.baseUrl}/detect`, formData, {
        headers: formData.getHeaders(),
        timeout: 30000
      });

      return response.data;
    };

    return await this.makeAPIRequest(requestFunction, 'detectFacesInFrame');
  }

  async createPersonFaceSet(personId, name, imagePaths) {
    try {
      console.log(`Creating faceset for ${name}...`);
      
      const faceSetName = `person_${personId}_${Date.now()}`;
      const faceSetToken = await this.createFaceSet(faceSetName);
      
      const faceTokens = [];
      const validImages = [];
      
      for (const imagePath of imagePaths) {
        console.log(`Processing image: ${path.basename(imagePath)}`);
        
        const face = await this.detectFace(imagePath);
        
        if (face && face.face_token) {
          await this.addFaceToFaceSet(faceSetToken, face.face_token);
          faceTokens.push(face.face_token);
          validImages.push(imagePath);
          console.log(`✅ Added face from ${path.basename(imagePath)} to faceset`);
        } else {
          console.log(`⚠️ No face detected in ${path.basename(imagePath)}`);
        }
      }

      if (faceTokens.length === 0) {
        await this.deleteFaceSet(faceSetToken);
        throw new Error('No faces found in any of the provided images');
      }

      // Validate the created faceset
      const isValid = await this.validateFaceSet(faceSetToken);
      if (!isValid) {
        throw new Error('Created faceset validation failed');
      }

      console.log(`✅ Successfully created and validated faceset with ${faceTokens.length} faces`);

      return {
        faceSetToken,
        faceTokens,
        faceSetName,
        validImages
      };
    } catch (error) {
      console.error('Error creating person faceset:', error);
      throw error;
    }
  }

  async extractFrames(videoPath, outputDir, fps = 0.3) { // Reduced fps for better API performance
    return new Promise((resolve, reject) => {
      fs.ensureDirSync(outputDir);
      console.log(`Extracting frames at ${fps} fps to ${outputDir}...`);

      ffmpeg(videoPath)
        .fps(fps)
        .format('image2')
        .output(path.join(outputDir, 'frame-%04d.jpg'))
        .on('start', (commandLine) => {
          console.log('FFmpeg process started');
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`Frame extraction: ${Math.round(progress.percent)}%`);
          }
        })
        .on('end', () => {
          console.log('✅ Frame extraction completed');
          resolve();
        })
        .on('error', (error) => {
          console.error('FFmpeg error:', error.message);
          reject(error);
        })
        .run();
    });
  }

  // Copy frames to public directory for web access
  async copyFramesToPublic(tempDir, publicFrameId) {
    const publicFrameDir = path.join('./public/frames', publicFrameId);
    fs.ensureDirSync(publicFrameDir);
    
    const frameFiles = await fs.readdir(tempDir);
    const frameMapping = {};
    
    for (const frameFile of frameFiles) {
      if (frameFile.endsWith('.jpg')) {
        const sourcePath = path.join(tempDir, frameFile);
        const destPath = path.join(publicFrameDir, frameFile);
        await fs.copy(sourcePath, destPath);
        frameMapping[frameFile] = `/frames/${publicFrameId}/${frameFile}`;
      }
    }
    
    console.log(`✅ Copied ${Object.keys(frameMapping).length} frames to public directory`);
    return frameMapping;
  }

  formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  async findFacesInVideo(videoPath, persons, fps = 0.3) {
    const tempDir = path.join('./temp', `frames_${uuidv4()}`);
    const publicFrameId = uuidv4();
    
    try {
      console.log('========================================');
      console.log('Starting video processing with enhanced sequential search...');
      console.log(`Video: ${path.basename(videoPath)}`);
      console.log(`Looking for ${persons.length} person(s)`);
      console.log(`FPS: ${fps}`);
      console.log('========================================');
      
      // Extract frames from video
      await this.extractFrames(videoPath, tempDir, fps);

      // Copy frames to public directory for web access
      const frameMapping = await this.copyFramesToPublic(tempDir, publicFrameId);

      // Validate persons have facesets
      const validPersons = persons.filter(person => person.faceSetToken);
      
      if (validPersons.length === 0) {
        throw new Error('No valid facesets available for comparison');
      }

      console.log(`Processing frames with ${validPersons.length} person facesets...`);
      
      // Process frames with sequential search
      const results = await this.processFramesSequential(tempDir, validPersons, fps, frameMapping, publicFrameId);

      console.log('========================================');
      console.log(`✅ Video processing completed`);
      console.log(`Total matches found: ${results.length}`);
      console.log('========================================');

      return results;
    } catch (error) {
      console.error('Error in findFacesInVideo:', error);
      throw error;
    }
  }

  // ✅ IMPROVED: Sequential frame processing for better reliability
  async processFramesSequential(framesDir, persons, fps, frameMapping, publicFrameId) {
    const results = [];
    const frameFiles = await fs.readdir(framesDir);
    
    // Sort frame files numerically
    frameFiles.sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)[0]);
      const numB = parseInt(b.match(/\d+/)[0]);
      return numA - numB;
    });

    console.log(`Processing ${frameFiles.length} frames with sequential search...`);

    // Process every Nth frame for efficiency (process every 3rd frame)
    const frameStep = 3;
    const framesToProcess = frameFiles.filter((_, index) => index % frameStep === 0);
    
    console.log(`Processing ${framesToProcess.length} frames (every ${frameStep}rd frame for efficiency)`);

    for (let i = 0; i < framesToProcess.length; i++) {
      const frameFile = framesToProcess[i];
      const framePath = path.join(framesDir, frameFile);
      
      // Calculate timestamp based on frame number and fps
      const frameNumber = parseInt(frameFile.match(/\d+/)[0]);
      const timestamp = (frameNumber - 1) / fps;

      console.log(`Processing frame ${i + 1}/${framesToProcess.length} (${this.formatTime(timestamp)})`);

      try {
        // Load frame
        const imageBuffer = await fs.readFile(framePath);
        
        // First detect faces in the frame
        console.log(`  🔍 Detecting faces...`);
        const detectResult = await this.detectFacesInFrame(imageBuffer);
        
        if (detectResult && detectResult.faces && detectResult.faces.length > 0) {
          console.log(`  ✅ Found ${detectResult.faces.length} face(s), searching for people...`);
          
          // ✅ Use sequential search instead of batch search
          const searchResults = await this.searchMultiplePeopleSequential(imageBuffer, persons);
          
          if (searchResults && searchResults.length > 0) {
            console.log(`  🎯 Found ${searchResults.length} matches`);
            
            // Process each match result
            for (const result of searchResults) {
              // Find corresponding detected face for bounding box
              const detectedFace = detectResult.faces[0]; // Use first detected face

              let boundingBox = null;
              if (detectedFace && detectedFace.face_rectangle) {
                boundingBox = {
                  x: detectedFace.face_rectangle.left,
                  y: detectedFace.face_rectangle.top,
                  width: detectedFace.face_rectangle.width,
                  height: detectedFace.face_rectangle.height
                };
              }

              results.push({
                frame: frameMapping[frameFile] || `/frames/${publicFrameId}/${frameFile}`,
                timestamp: timestamp,
                timestampFormatted: this.formatTime(timestamp),
                confidence: result.confidence / 100,
                personId: result.personId,
                personName: result.personName,
                faceToken: result.face_token,
                boundingBox: boundingBox
              });
              
              console.log(`    ✅ Found ${result.personName} (confidence: ${result.confidence.toFixed(1)}%)`);
            }
          } else {
            console.log(`  ⚠️ No matches found in this frame`);
          }
        } else {
          console.log(`  ⚠️ No faces detected in frame`);
        }

      } catch (error) {
        console.error(`  ❌ Error processing frame ${frameFile}:`, error.message);
      }

      // Rate limiting pause between frames (longer for stability)
      await this.delay(this.rateLimitConfig.delayBetweenRequests);
    }

    // Remove duplicate detections (same person within 5 seconds)
    const filteredResults = this.removeDuplicateDetections(results, 5);

    console.log(`✅ Found ${filteredResults.length} unique detections (filtered from ${results.length} total)`);
    
    // Group results by person for summary
    const personSummary = {};
    filteredResults.forEach(result => {
      if (!personSummary[result.personName]) {
        personSummary[result.personName] = 0;
      }
      personSummary[result.personName]++;
    });
    
    console.log('👥 Person detection summary:');
    Object.keys(personSummary).forEach(personName => {
      console.log(`   ${personName}: ${personSummary[personName]} detections`);
    });
    
    return filteredResults;
  }

  removeDuplicateDetections(results, timeWindow = 5) {
    if (results.length === 0) return results;

    results.sort((a, b) => {
      if (a.personId !== b.personId) {
        return a.personId.toString().localeCompare(b.personId.toString());
      }
      return a.timestamp - b.timestamp;
    });

    const filtered = [];
    let lastPerson = null;
    let lastTimestamp = -999;

    for (const result of results) {
      if (result.personId !== lastPerson || result.timestamp - lastTimestamp > timeWindow) {
        filtered.push(result);
        lastPerson = result.personId;
        lastTimestamp = result.timestamp;
      }
    }

    return filtered;
  }

  async deleteFaceSet(faceSetToken) {
    const requestFunction = async () => {
      const formData = new FormData();
      formData.append('api_key', this.apiKey);
      formData.append('api_secret', this.apiSecret);
      formData.append('faceset_token', faceSetToken);
      
      const response = await axios.post(`${this.baseUrl}/faceset/delete`, formData, {
        headers: formData.getHeaders(),
        timeout: 30000
      });
      
      return response.data;
    };

    const result = await this.makeAPIRequest(requestFunction, 'deleteFaceSet', 2);
    
    if (result) {
      console.log(`✅ Deleted faceset: ${faceSetToken}`);
    }
    
    return result;
  }

  // Helper method to add delay
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Method to clean up old frame images (older than 24 hours)
  async cleanupOldFrames() {
    try {
      const framesDir = './public/frames';
      if (!fs.existsSync(framesDir)) {
        return;
      }

      const frameDirs = await fs.readdir(framesDir);
      const now = Date.now();
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours

      for (const frameDir of frameDirs) {
        const frameDirPath = path.join(framesDir, frameDir);
        const stats = await fs.stat(frameDirPath);
        
        if (now - stats.mtimeMs > maxAge) {
          await fs.remove(frameDirPath);
          console.log(`Deleted old frame directory: ${frameDir}`);
        }
      }
      
      console.log('✅ Frame cleanup completed');
    } catch (error) {
      console.error('Error cleaning up frames:', error);
    }
  }
}

module.exports = FaceRecognitionService;