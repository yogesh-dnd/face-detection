// services/faceRecognitionService.js - Using Face++ API
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
      // Don't throw error, allow service to continue
      console.log('Continuing without connection verification...');
    }
  }

  async testConnection() {
    try {
      const formData = new FormData();
      formData.append('api_key', this.apiKey);
      formData.append('api_secret', this.apiSecret);
      
      // Test with a simple API call
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

  async compareFaces(face1Buffer, face2Buffer) {
    try {
      const base64Image1 = face1Buffer.toString('base64');
      const base64Image2 = face2Buffer.toString('base64');
      
      const formData = new FormData();
      formData.append('api_key', this.apiKey);
      formData.append('api_secret', this.apiSecret);
      formData.append('image_base64_1', base64Image1);
      formData.append('image_base64_2', base64Image2);
      
      const response = await axios.post(`${this.baseUrl}/compare`, formData, {
        headers: formData.getHeaders(),
        timeout: 30000
      });

      return response.data;
    } catch (error) {
      console.error('Error comparing faces:', error.response?.data?.error_message || error.message);
      return null;
    }
  }

  async createPersonFaceSet(personId, name, imagePaths) {
    try {
      console.log(`Creating faceset for ${name}...`);
      
      // Create a unique faceset name
      const faceSetName = `person_${personId}_${Date.now()}`;
      const faceSetToken = await this.createFaceSet(faceSetName);
      
      const faceTokens = [];
      const validImages = [];
      
      // Process each image
      for (const imagePath of imagePaths) {
        console.log(`Processing image: ${path.basename(imagePath)}`);
        
        const face = await this.detectFace(imagePath);
        
        if (face && face.face_token) {
          // Add face to faceset
          await this.addFaceToFaceSet(faceSetToken, face.face_token);
          faceTokens.push(face.face_token);
          validImages.push(imagePath);
          console.log(`✅ Added face from ${path.basename(imagePath)} to faceset`);
          
          // Add small delay to avoid rate limiting
          await this.delay(500);
        } else {
          console.log(`⚠️ No face detected in ${path.basename(imagePath)}`);
        }
      }

      if (faceTokens.length === 0) {
        // Delete empty faceset
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
      // Ensure output directory exists
      fs.ensureDirSync(outputDir);

      console.log(`Extracting frames at ${fps} fps...`);

      ffmpeg(videoPath)
        .fps(fps)
        .format('image2')
        .output(path.join(outputDir, 'frame-%04d.jpg'))
        .on('start', (commandLine) => {
          console.log('FFmpeg process started');
          console.log('Command:', commandLine);
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

  formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  async findFacesInVideo(videoPath, persons, fps = 1) {
    const tempDir = path.join('./temp', `frames_${uuidv4()}`);
    
    try {
      console.log('========================================');
      console.log('Starting video processing...');
      console.log(`Video: ${path.basename(videoPath)}`);
      console.log(`Looking for ${persons.length} person(s)`);
      console.log('========================================');
      
      // Extract frames from video
      await this.extractFrames(videoPath, tempDir, fps);

      // Get faceset tokens from persons
      const faceSetTokens = persons.map(person => person.faceSetToken).filter(Boolean);
      
      if (faceSetTokens.length === 0) {
        throw new Error('No facesets available for comparison');
      }

      console.log(`Using ${faceSetTokens.length} facesets for comparison`);
      
      // Process frames
      const results = await this.processFrames(tempDir, faceSetTokens, persons, fps);

      console.log('========================================');
      console.log(`✅ Video processing completed`);
      console.log(`Total matches found: ${results.length}`);
      console.log('========================================');

      return results;
    } catch (error) {
      console.error('Error in findFacesInVideo:', error);
      throw error;
    } finally {
      // Cleanup temp directory
      console.log('Cleaning up temporary files...');
      fs.remove(tempDir).catch(console.error);
    }
  }

 async processFrames(framesDir, faceSetTokens, persons, fps) {
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
     const batchSize = 3; // Process 3 frames at a time
     
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
         
         // Search for faces in this frame
         const searchResult = await this.searchFace(imageBuffer, faceSetTokens);
         
         if (searchResult && searchResult.faces && searchResult.faces.length > 0) {
           // Process each detected face
           for (const face of searchResult.results) {
               // Get the best match
               const bestMatch = face;
               
               // Find the person associated with this faceset
               const matchedPerson = Object.values(faceSetToPerson).find(person => {
                 // Check if the face token belongs to this person
                 return person.faceTokens && person.faceTokens.includes(bestMatch.face_token);
               });
               
               if (matchedPerson && bestMatch.confidence > 0) { // 70% confidence threshold
                 results.push({
                   frame: frameFile,
                   timestamp: timestamp,
                   timestampFormatted: this.formatTime(timestamp),
                   confidence: bestMatch.confidence / 100, // Convert to 0-1 scale
                   personId: matchedPerson._id,
                   personName: matchedPerson.name,
                   faceToken: bestMatch.face_token,
                   boundingBox: face.face_rectangle ? {
                     x: face.face_rectangle.left,
                     y: face.face_rectangle.top,
                     width: face.face_rectangle.width,
                     height: face.face_rectangle.height
                   } : null
                 });
                 
                 console.log(`  âœ… Found ${matchedPerson.name} (confidence: ${bestMatch.confidence.toFixed(1)}%)`);
             }
           }
         }
 
         // Rate limiting: add delay every few frames
         if ((i + 1) % batchSize === 0) {
           console.log(`  â³ Rate limiting pause...`);
           await this.delay(2000); // 2 second delay every batch
         }
 
       } catch (error) {
         console.error(`  âŒ Error processing frame ${frameFile}:`, error.message);
         // Add longer delay on error
         await this.delay(3000);
       }
     }
 
     // Remove duplicate detections (same person within 2 seconds)
     const filteredResults = this.removeDuplicateDetections(results);
 
     console.log(`âœ… Found ${filteredResults.length} unique detections (filtered from ${results.length} total)`);
     return filteredResults;
   }
 

  removeDuplicateDetections(results) {
    if (results.length === 0) return results;

    // Sort by person and timestamp
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
      // Keep if different person or same person but > 2 seconds apart
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
      // Don't throw error on delete failure
      return null;
    }
  }

  async getFaceSetDetail(faceSetToken) {
    try {
      const formData = new FormData();
      formData.append('api_key', this.apiKey);
      formData.append('api_secret', this.apiSecret);
      formData.append('faceset_token', faceSetToken);
      
      const response = await axios.post(`${this.baseUrl}/faceset/getdetail`, formData, {
        headers: formData.getHeaders(),
        timeout: 30000
      });
      
      return response.data;
    } catch (error) {
      console.error('Error getting faceset detail:', error.response?.data?.error_message || error.message);
      return null;
    }
  }

  async getAllFaceSets() {
    try {
      const formData = new FormData();
      formData.append('api_key', this.apiKey);
      formData.append('api_secret', this.apiSecret);
      
      const response = await axios.post(`${this.baseUrl}/faceset/getfacesets`, formData, {
        headers: formData.getHeaders(),
        timeout: 30000
      });
      
      return response.data.facesets || [];
    } catch (error) {
      console.error('Error getting facesets:', error.response?.data?.error_message || error.message);
      return [];
    }
  }

  // Helper method to add delay
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Helper method to validate API credentials
  async validateCredentials() {
    try {
      const facesets = await this.getAllFaceSets();
      console.log(`✅ API credentials valid. Found ${facesets.length} existing facesets.`);
      return true;
    } catch (error) {
      console.error('❌ Invalid API credentials or connection issue');
      return false;
    }
  }

  // Method to clean up old frame images (older than 24 hours)
  async cleanupOldFrames() {
    try {
      const framesDir = './public/frames';
      if (!fs.existsSync(framesDir)) {
        return;
      }

      const files = await fs.readdir(framesDir);
      const now = Date.now();
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

      for (const file of files) {
        const filePath = path.join(framesDir, file);
        const stats = await fs.stat(filePath);
        
        if (now - stats.mtimeMs > maxAge) {
          await fs.unlink(filePath);
          console.log(`Deleted old frame: ${file}`);
        }
      }
      
      console.log('✅ Frame cleanup completed');
    } catch (error) {
      console.error('Error cleaning up frames:', error);
    }
  }
  async cleanupOrphanedFaceSets(validPersonIds = []) {
    try {
      const facesets = await this.getAllFaceSets();
      console.log(`Found ${facesets.length} total facesets`);
      
      for (const faceset of facesets) {
        // Check if faceset belongs to a valid person
        const isValid = validPersonIds.some(id => 
          faceset.display_name && faceset.display_name.includes(id.toString())
        );
        
        if (!isValid && faceset.display_name && faceset.display_name.startsWith('person_')) {
          console.log(`Deleting orphaned faceset: ${faceset.display_name}`);
          await this.deleteFaceSet(faceset.faceset_token);
          await this.delay(500); // Rate limiting
        }
      }
      
      console.log('✅ Cleanup completed');
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }
}

module.exports = FaceRecognitionService;