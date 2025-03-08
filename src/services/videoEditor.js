const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { Configuration, OpenAIApi } = require('openai');

// Initialize OpenAI for generating narration
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

class VideoEditor {
  constructor() {
    this.outputDir = process.env.OUTPUT_DIRECTORY || './output';
    this.tempDir = process.env.TEMP_DIRECTORY || './temp';
    
    // Ensure output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  async createVideo(description, images, videos, localFilePaths) {
    try {
      // Generate a script for narration using GPT
      const script = await this.generateScript(description);
      
      // Create a Python script that will use MoviePy to create the video
      const pythonScriptPath = await this.createPythonScript(images, videos, localFilePaths, script, description);
      
      // Execute the Python script
      const outputPath = await this.executePythonScript(pythonScriptPath);
      
      return outputPath;
    } catch (error) {
      console.error('Error creating video:', error);
      throw error;
    }
  }

  async generateScript(description) {
    try {
      const response = await openai.createCompletion({
        model: "text-davinci-003",
        prompt: `Create a short, engaging narration script for a video about: ${description}. The script should be concise and suitable for a 1-2 minute video.`,
        max_tokens: 250,
        temperature: 0.7,
      });

      return response.data.choices[0].text.trim();
    } catch (error) {
      console.error('Error generating script:', error);
      return description; // Fallback to using the description if script generation fails
    }
  }

  async createPythonScript(images, videos, localFilePaths, script, description) {
    // Combine all media files
    const allMedia = [
      ...images.map(img => ({ path: img.localPath, type: 'image' })),
      ...videos.filter(v => !v.isYouTube).map(vid => ({ path: vid.localPath, type: 'video' })),
      ...localFilePaths.map(path => ({ path, type: this.getFileType(path) }))
    ];
    
    // Shuffle the media to create a more interesting video
    this.shuffleArray(allMedia);
    
    // Create a timestamp for the output file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputFilename = `video_${timestamp}.mp4`;
    const outputPath = path.join(this.outputDir, outputFilename);
    
    // Create a Python script that uses MoviePy
    const pythonScript = `
# -*- coding: utf-8 -*-
import os
import sys
from moviepy.editor import *
from moviepy.video.tools.segmenting import findObjects
from moviepy.video.fx import all as vfx
from moviepy.audio.fx import all as afx
import textwrap

# Configuration
VIDEO_WIDTH = 1280
VIDEO_HEIGHT = 720
DURATION = 3  # Duration for each image in seconds
TRANSITION_DURATION = 1  # Duration for transitions in seconds

# Media files
media_files = ${JSON.stringify(allMedia)}

# Script for narration
script = """${script}"""

# Video title
video_title = """${description}"""

# Create clips list
clips = []
for media in media_files:
    path = media['path']
    media_type = media['type']
    
    try:
        if media_type == 'image':
            # Load image and set duration
            clip = ImageClip(path).set_duration(DURATION)
            
            # Resize to fit video dimensions while maintaining aspect ratio
            clip = clip.resize(height=VIDEO_HEIGHT)
            
            # If image is wider than video, crop it
            if clip.w > VIDEO_WIDTH:
                clip = clip.crop(x1=(clip.w - VIDEO_WIDTH)/2, y1=0, x2=(clip.w + VIDEO_WIDTH)/2, y2=VIDEO_HEIGHT)
            
            # If image is narrower than video, add black padding
            if clip.w < VIDEO_WIDTH:
                clip = clip.on_color(size=(VIDEO_WIDTH, VIDEO_HEIGHT), color=(0,0,0))
            
            # Add a zoom effect
            clip = clip.fx(vfx.resize, 1.1).set_position(('center', 'center'))
            clip = clip.fx(vfx.fadein, TRANSITION_DURATION/2).fx(vfx.fadeout, TRANSITION_DURATION/2)
            
        elif media_type == 'video':
            # Load video clip
            clip = VideoFileClip(path)
            
            # If video is longer than 10 seconds, trim it
            if clip.duration > 10:
                clip = clip.subclip(0, 10)
            
            # Resize to fit video dimensions while maintaining aspect ratio
            clip = clip.resize(height=VIDEO_HEIGHT)
            
            # If video is wider than our dimensions, crop it
            if clip.w > VIDEO_WIDTH:
                clip = clip.crop(x1=(clip.w - VIDEO_WIDTH)/2, y1=0, x2=(clip.w + VIDEO_WIDTH)/2, y2=VIDEO_HEIGHT)
            
            # If video is narrower than our dimensions, add black padding
            if clip.w < VIDEO_WIDTH:
                clip = clip.on_color(size=(VIDEO_WIDTH, VIDEO_HEIGHT), color=(0,0,0))
            
            # Add fade in/out effects
            clip = clip.fx(vfx.fadein, TRANSITION_DURATION/2).fx(vfx.fadeout, TRANSITION_DURATION/2)
        
        # Add clip to list
        clips.append(clip)
    except Exception as e:
        print(f"Error processing {path}: {str(e)}")
        continue

# If no clips were created, exit
if not clips:
    print("No valid media files were found.")
    sys.exit(1)

# Create title clip
title_clip = TextClip(txt=textwrap.fill(video_title, width=30), 
                     fontsize=60, color='white', bg_color='black',
                     size=(VIDEO_WIDTH, VIDEO_HEIGHT),
                     method='caption').set_duration(5)
title_clip = title_clip.fx(vfx.fadein, 1).fx(vfx.fadeout, 1)

# Add title at the beginning
clips.insert(0, title_clip)

# Concatenate all clips
final_clip = concatenate_videoclips(clips, method="compose")

# Generate narration text clips
text_clips = []
wrapped_script = textwrap.fill(script, width=50)
script_parts = wrapped_script.split('\n\n')

for i, part in enumerate(script_parts):
    # Calculate start time for this text part (distribute evenly throughout the video)
    start_time = i * (final_clip.duration - 5) / max(1, len(script_parts))
    
    # Create text clip
    txt_clip = TextClip(txt=part, fontsize=30, color='white', bg_color='rgba(0,0,0,0.5)',
                       size=(VIDEO_WIDTH, None), method='caption').set_duration(10)
    
    # Position at bottom of screen
    txt_clip = txt_clip.set_position(('center', 'bottom'))
    
    # Set start time
    txt_clip = txt_clip.set_start(start_time + 5)  # Start after title
    
    # Add fade in/out
    txt_clip = txt_clip.crossfadein(1).crossfadeout(1)
    
    text_clips.append(txt_clip)

# Overlay text clips on final video
final_clip = CompositeVideoClip([final_clip] + text_clips)

# Write final video to file
final_clip.write_videofile("${outputPath}", fps=24, codec='libx264', audio_codec='aac')

print(f"Video created successfully: ${outputPath}")
`;

    // Write the Python script to a file
    const scriptFilename = `create_video_${timestamp}.py`;
    const scriptPath = path.join(this.tempDir, scriptFilename);
    fs.writeFileSync(scriptPath, pythonScript);
    
    return scriptPath;
  }

  async executePythonScript(scriptPath) {
    return new Promise((resolve, reject) => {
      // Execute the Python script
      exec(`python ${scriptPath}`, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error executing Python script: ${error.message}`);
          console.error(`stderr: ${stderr}`);
          reject(error);
          return;
        }
        
        console.log(`Python script output: ${stdout}`);
        
        // Extract the output path from the stdout
        const match = stdout.match(/Video created successfully: (.+)/);
        if (match && match[1]) {
          resolve(match[1]);
        } else {
          resolve(null);
        }
      });
    });
  }

  getFileType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const videoExts = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv'];
    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
    
    if (videoExts.includes(ext)) {
      return 'video';
    } else if (imageExts.includes(ext)) {
      return 'image';
    } else {
      return 'unknown';
    }
  }

  shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
}

module.exports = new VideoEditor();