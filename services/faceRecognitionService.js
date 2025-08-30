// services/faceRecognitionService.js - Updated with frame management
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs-extra');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { v4: uuidv4 } = require('uuid');

class FaceRecognitionService {
  constructor() {
    // Face++ API credentials
    this.apiKey = process.env.FACEPLUS_API_KEY || 'jhjQBgNodMIbIAiGp-7a2iqvXT6xDLKN';
    this.apiSecret = process.env.FACEPLUS_API_SECRET || 'e9YapRMfwVQ0Wrg8oWLxlaI9feuEemdk';
    this.baseUrl = 'https://api-us.faceplusplus.com/facepp/v3';

    if (!this.apiKey || !this.apiSecret) {
      throw new Error('Face++ API credentials not found. Please set FACEPLUS_API_KEY and FACEPLUS_API_SECRET in your .env file');
    }

    // Ensure public directories exist
    fs.ensureDirSync('./public/frames');
    fs.ensureDirSync('./public/results');
  }

  async initialize() {
    console.log('Face++ API service initialized');
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

  async testConnection() {
    try {
      const formData = new FormData();
      formData.append('api_key', this.apiKey);
      formData.append('api_secret', this.apiSecret);

      const response = await axios.post(`${this.baseUrl}/faceset/getfacesets`, formData, {
        headers: formData.getHeaders(),
        timeout: 10000
      });

      return response.data;
    } catch (error) {
      throw new Error(`Face++ API test failed: ${error.response?.data?.error_message || error.message}`);
    }
  }

  async detectFace(imagePath) {
    try {
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

      if (response.data.faces && response.data.faces.length > 0) {
        console.log(`✅ Face detected in ${path.basename(imagePath)}`);
        return response.data.faces[0];
      }

      console.log(`⚠️ No face detected in ${path.basename(imagePath)}`);
      return null;
    } catch (error) {
      console.error('Error detecting face:', error.response?.data?.error_message || error.message);
      return null;
    }
  }

  async createFaceSet(faceSetName) {
    try {
      const formData = new FormData();
      formData.append('api_key', this.apiKey);
      formData.append('api_secret', this.apiSecret);
      formData.append('display_name', faceSetName);
      formData.append('outer_id', faceSetName);

      const response = await axios.post(`${this.baseUrl}/faceset/create`, formData, {
        headers: formData.getHeaders(),
        timeout: 30000
      });

      console.log(`✅ Created faceset: ${faceSetName}`);
      return response.data.faceset_token;
    } catch (error) {
      console.error('Error creating faceset:', error.response?.data?.error_message || error.message);
      throw error;
    }
  }

  async addFaceToFaceSet(faceSetToken, faceToken) {
    try {
      const formData = new FormData();
      formData.append('api_key', this.apiKey);
      formData.append('api_secret', this.apiSecret);
      formData.append('faceset_token', faceSetToken);
      formData.append('face_tokens', faceToken);

      const response = await axios.post(`${this.baseUrl}/faceset/addface`, formData, {
        headers: formData.getHeaders(),
        timeout: 30000
      });

      console.log(`✅ Added face to faceset`);
      return response.data;
    } catch (error) {
      console.error('Error adding face to faceset:', error.response?.data?.error_message || error.message);
      throw error;
    }
  }

  async searchFace(imageBuffer, faceSetTokens) {
    try {
      const base64Image = imageBuffer.toString('base64');

      const formData = new FormData();
      formData.append('api_key', this.apiKey);
      formData.append('api_secret', this.apiSecret);
      formData.append('image_base64', base64Image);
      formData.append('faceset_token', faceSetTokens.join(','));
      formData.append('return_result_count', '5');

      const response = await axios.post(`${this.baseUrl}/search`, formData, {
        headers: formData.getHeaders(),
        timeout: 30000
      });

      return response.data;
    } catch (error) {
      console.error('Error searching face:', error.response?.data?.error_message || error.message);
      return null;
    }
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

          await this.delay(500);
        } else {
          console.log(`⚠️ No face detected in ${path.basename(imagePath)}`);
        }
      }

      if (faceTokens.length === 0) {
        await this.deleteFaceSet(faceSetToken);
        throw new Error('No faces found in any of the provided images');
      }

      console.log(`✅ Successfully created faceset with ${faceTokens.length} faces`);

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

  async extractFrames(videoPath, outputDir, fps = 0.5) {
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

  async findFacesInVideo(videoPath, persons, fps = 1) {
    const tempDir = path.join('./temp', `frames_${uuidv4()}`);
    const publicFrameId = uuidv4();

    try {
      console.log('========================================');
      console.log('Starting video processing...');
      console.log(`Video: ${path.basename(videoPath)}`);
      console.log(`Looking for ${persons.length} person(s)`);
      console.log('========================================');

      // Extract frames from video
      await this.extractFrames(videoPath, tempDir, fps);

      // Copy frames to public directory for web access
      const frameMapping = await this.copyFramesToPublic(tempDir, publicFrameId);

      // Get faceset tokens from persons
      const faceSetTokens = persons.map(person => person.faceSetToken).filter(Boolean);

      if (faceSetTokens.length === 0) {
        throw new Error('No facesets available for comparison');
      }

      console.log(`Using ${faceSetTokens.length} facesets for comparison`);

      // Process frames with public frame paths
      const results = await this.processFrames(tempDir, faceSetTokens, persons, fps, frameMapping, publicFrameId);

      console.log('========================================');
      console.log(`✅ Video processing completed`);
      console.log(`Total matches found: ${results.length}`);
      console.log('========================================');

      return results;
    } catch (error) {
      console.error('Error in findFacesInVideo:', error);
      throw error;
    }
    // Note: We keep temp frames for now, cleanup can be done later
  }

  async processFrames(framesDir, faceSetTokens, persons, fps, frameMapping, publicFrameId) {
    const results = [];
    const frameFiles = await fs.readdir(framesDir);

    // Sort frame files numerically
    frameFiles.sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)[0]);
      const numB = parseInt(b.match(/\d+/)[0]);
      return numA - numB;
    });

    console.log(`Processing ${frameFiles.length} frames...`);

    // Create a map of faceset tokens to person info
    const faceSetToPerson = {};
    persons.forEach(person => {
      if (person.faceSetToken) {
        faceSetToPerson[person.faceSetToken] = person;
      }
    });

    // Process frames in batches to respect rate limits
    const batchSize = 3;

    for (let i = 0; i < frameFiles.length; i++) {
      const frameFile = frameFiles[i];
      const framePath = path.join(framesDir, frameFile);

      // Calculate timestamp based on frame number and fps
      const frameNumber = parseInt(frameFile.match(/\d+/)[0]);
      const timestamp = (frameNumber - 1) / fps;

      try {
        // Load frame
        const imageBuffer = await fs.readFile(framePath);

        console.log(`Processing frame ${i + 1}/${frameFiles.length} (${this.formatTime(timestamp)})`);

        // First detect all faces in the frame
        const detectResult = await this.detectFacesInFrame(imageBuffer);

        if (detectResult && detectResult.faces && detectResult.faces.length > 0) {
          // Search for matches against our facesets
          const searchResult = await this.searchFace(imageBuffer, faceSetTokens);

          if (searchResult && searchResult.results && searchResult.results.length > 0) {
            // Process each match
            for (const result of searchResult.results) {
              // Find the corresponding detected face for bounding box info
              const detectedFace = detectResult.faces[0]

              // Find the person associated with this match
              const matchedPerson = Object.values(faceSetToPerson).find(person => {
                return person.faceTokens && person.faceTokens.some(token =>
                  result.face_token && token === result.face_token
                );
              });

              if (matchedPerson && result.confidence > 80) { // 80% confidence threshold
                // ✅ FIXED: Properly extract bounding box from the matched face
                let boundingBox = null;
                if (detectedFace && detectedFace.face_rectangle) {
                  boundingBox = {
                    x: detectedFace.face_rectangle.left,
                    y: detectedFace.face_rectangle.top,
                    width: detectedFace.face_rectangle.width,
                    height: detectedFace.face_rectangle.height
                  };
                } else if (detectResult.faces.length > 0) {
                  // Fallback to first detected face if specific match not found
                  boundingBox = {
                    x: detectResult.faces[0].face_rectangle.left,
                    y: detectResult.faces[0].face_rectangle.top,
                    width: detectResult.faces[0].face_rectangle.width,
                    height: detectResult.faces[0].face_rectangle.height
                  };
                }

                results.push({
                  frame: frameMapping[frameFile] || `/frames/${publicFrameId}/${frameFile}`,
                  timestamp: timestamp,
                  timestampFormatted: this.formatTime(timestamp),
                  confidence: result.confidence / 100, // Convert to 0-1 scale
                  personId: matchedPerson._id,
                  personName: matchedPerson.name,
                  faceToken: result.face_token,
                  boundingBox: boundingBox // ✅ Properly formatted bounding box
                });

                console.log(`  ✅ Found ${matchedPerson.name} (confidence: ${result.confidence.toFixed(1)}%)`);
                if (boundingBox) {
                  console.log(`     📍 Face position: x=${boundingBox.x}, y=${boundingBox.y}, size=${boundingBox.width}x${boundingBox.height}`);
                }
              }
            }
          }
        }

        // Rate limiting: add delay every few frames
        if ((i + 1) % batchSize === 0) {
          console.log(`  ⏳ Rate limiting pause...`);
          await this.delay(2000);
        }

      } catch (error) {
        console.error(`  ❌ Error processing frame ${frameFile}:`, error.message);
        await this.delay(3000);
      }
    }

    // Remove duplicate detections (same person within 2 seconds)
    const filteredResults = this.removeDuplicateDetections(results);

    console.log(`✅ Found ${filteredResults.length} unique detections (filtered from ${results.length} total)`);
    console.log(`📦 Bounding box data available for ${filteredResults.filter(r => r.boundingBox).length} detections`);

    return filteredResults;
  }

  async detectFacesInFrame(imageBuffer) {
    try {
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
    } catch (error) {
      console.error('Error detecting faces in frame:', error.response?.data?.error_message || error.message);
      return null;
    }
  }

  removeDuplicateDetections(results) {
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
      if (result.personId !== lastPerson || result.timestamp - lastTimestamp > 2) {
        filtered.push(result);
        lastPerson = result.personId;
        lastTimestamp = result.timestamp;
      }
    }

    return filtered;
  }

  async deleteFaceSet(faceSetToken) {
    try {
      const formData = new FormData();
      formData.append('api_key', this.apiKey);
      formData.append('api_secret', this.apiSecret);
      formData.append('faceset_token', faceSetToken);

      const response = await axios.post(`${this.baseUrl}/faceset/delete`, formData, {
        headers: formData.getHeaders(),
        timeout: 30000
      });

      console.log(`✅ Deleted faceset: ${faceSetToken}`);
      return response.data;
    } catch (error) {
      console.error('Error deleting faceset:', error.response?.data?.error_message || error.message);
      return null;
    }
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