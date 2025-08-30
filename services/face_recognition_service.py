# face_recognition_service.py
import cv2
import face_recognition
import numpy as np
import json
import sys
import os
from pathlib import Path

class FaceRecognitionService:
    def __init__(self):
        self.known_encodings = []
        self.known_names = []
        self.person_map = {}
    
    def extract_face_encoding(self, image_path):
        """Extract face encoding from an image"""
        try:
            # Load image
            image = face_recognition.load_image_file(image_path)
            
            # Find face encodings
            encodings = face_recognition.face_encodings(image)
            
            if len(encodings) > 0:
                return encodings[0].tolist()  # Convert numpy array to list
            else:
                return None
        except Exception as e:
            print(f"Error processing {image_path}: {str(e)}", file=sys.stderr)
            return None
    
    def process_video(self, video_path, target_encodings, person_map, fps=0.5):
        """Process video to find faces"""
        results = []
        
        try:
            # Open video
            video = cv2.VideoCapture(video_path)
            
            if not video.isOpened():
                raise Exception("Could not open video file")
            
            # Get video properties
            total_frames = int(video.get(cv2.CAP_PROP_FRAME_COUNT))
            video_fps = video.get(cv2.CAP_PROP_FPS)
            
            # Calculate frame skip
            frame_skip = max(1, int(video_fps / fps))
            
            frame_number = 0
            processed_frames = 0
            
            print(f"Processing video: {total_frames} frames at {video_fps} fps")
            print(f"Processing every {frame_skip} frames")
            
            while True:
                ret, frame = video.read()
                if not ret:
                    break
                
                # Process only every nth frame
                if frame_number % frame_skip == 0:
                    timestamp = frame_number / video_fps
                    
                    # Convert BGR to RGB
                    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    
                    # Find faces in frame
                    face_locations = face_recognition.face_locations(rgb_frame)
                    face_encodings = face_recognition.face_encodings(rgb_frame, face_locations)
                    
                    # Compare with target encodings
                    for face_encoding in face_encodings:
                        for i, target_encoding in enumerate(target_encodings):
                            # Calculate distance
                            distance = face_recognition.face_distance([target_encoding], face_encoding)[0]
                            
                            # If match found (lower distance = better match)
                            if distance < 0.45:
                                person_info = person_map.get(str(i), {})
                                confidence = max(0, 1 - distance)
                                
                                result = {
                                    'timestamp': timestamp,
                                    'timestampFormatted': self.format_time(timestamp),
                                    'confidence': confidence,
                                    'distance': distance,
                                    'personId': person_info.get('personId', ''),
                                    'personName': person_info.get('name', ''),
                                    'frame': f'frame-{frame_number:04d}'
                                }
                                
                                results.append(result)
                                print(f"Found {person_info.get('name', 'Unknown')} at {self.format_time(timestamp)} (confidence: {confidence*100:.1f}%)")
                    
                    processed_frames += 1
                    if processed_frames % 10 == 0:
                        progress = (frame_number / total_frames) * 100
                        print(f"Progress: {progress:.1f}%")
                
                frame_number += 1
            
            video.release()
            print(f"Processing complete. Found {len(results)} matches.")
            return results
            
        except Exception as e:
            print(f"Error processing video: {str(e)}", file=sys.stderr)
            return []
    
    def format_time(self, seconds):
        """Format seconds to MM:SS"""
        minutes = int(seconds // 60)
        seconds = int(seconds % 60)
        return f"{minutes}:{seconds:02d}"

def main():
    if len(sys.argv) < 2:
        print("Usage: python face_recognition_service.py <command> [args...]")
        sys.exit(1)
    
    command = sys.argv[1]
    service = FaceRecognitionService()
    
    if command == "extract_encoding":
        if len(sys.argv) != 3:
            print("Usage: python face_recognition_service.py extract_encoding <image_path>")
            sys.exit(1)
        
        image_path = sys.argv[2]
        encoding = service.extract_face_encoding(image_path)
        
        if encoding:
            print(json.dumps({"success": True, "encoding": encoding}))
        else:
            print(json.dumps({"success": False, "error": "No face found"}))
    
    elif command == "process_video":
        if len(sys.argv) != 5:
            print("Usage: python face_recognition_service.py process_video <video_path> <encodings_file> <person_map_file>")
            sys.exit(1)
        
        video_path = sys.argv[2]
        encodings_file = sys.argv[3]
        person_map_file = sys.argv[4]
        
        # Load target encodings
        with open(encodings_file, 'r') as f:
            target_encodings = json.load(f)
        
        # Load person map
        with open(person_map_file, 'r') as f:
            person_map = json.load(f)
        
        # Process video
        results = service.process_video(video_path, target_encodings, person_map)
        
        print(json.dumps({"success": True, "results": results}))
    
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)

if __name__ == "__main__":
    main()