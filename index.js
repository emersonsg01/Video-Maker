require('dotenv').config();
const express = require('express');
const path = require('path');
const multer = require('multer');
const textAnalyzer = require('./src/services/textAnalyzer');
const contentFinder = require('./src/services/contentFinder');
const videoEditor = require('./src/services/videoEditor');
const fs = require('fs');

// Create necessary directories if they don't exist
const outputDir = process.env.OUTPUT_DIRECTORY || './output';
const tempDir = process.env.TEMP_DIRECTORY || './temp';

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, tempDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage });

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API endpoint to create a video
app.post('/api/create-video', upload.array('localFiles', 10), async (req, res) => {
  try {
    const { description } = req.body;
    const localFiles = req.files || [];
    
    // Step 1: Analyze text to extract keywords
    const keywords = await textAnalyzer.extractKeywords(description);
    
    // Step 2: Find relevant content based on keywords
    const { images, videos } = await contentFinder.findContent(keywords);
    
    // Step 3: Create video from the collected content
    const localFilePaths = localFiles.map(file => file.path);
    const videoPath = await videoEditor.createVideo(description, images, videos, localFilePaths);
    
    res.json({ success: true, videoPath });
  } catch (error) {
    console.error('Error creating video:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});