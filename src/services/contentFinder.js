const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

class ContentFinder {
  constructor() {
    this.tempDir = process.env.TEMP_DIRECTORY || './temp';
    this.maxImages = parseInt(process.env.MAX_IMAGES) || 10;
    this.maxVideos = parseInt(process.env.MAX_VIDEOS) || 5;
    
    // Ensure temp directory exists
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  async findContent(keywords) {
    try {
      // Join keywords for search queries
      const searchQuery = keywords.join(' ');
      
      // Find images and videos in parallel
      const [images, videos] = await Promise.all([
        this.findImages(searchQuery),
        this.findVideos(searchQuery)
      ]);
      
      return { images, videos };
    } catch (error) {
      console.error('Error finding content:', error);
      throw error;
    }
  }

  async findImages(query) {
    try {
      // Search images from Pexels
      const pexelsImages = await this.searchPexelsImages(query);
      
      // Search images from Unsplash
      const unsplashImages = await this.searchUnsplashImages(query);
      
      // Combine and limit results
      const allImages = [...pexelsImages, ...unsplashImages].slice(0, this.maxImages);
      
      // Download images
      const downloadedImages = await this.downloadImages(allImages);
      
      return downloadedImages;
    } catch (error) {
      console.error('Error finding images:', error);
      return [];
    }
  }

  async findVideos(query) {
    try {
      // Search videos from YouTube
      const youtubeVideos = await this.searchYouTubeVideos(query);
      
      // Search videos from Pexels
      const pexelsVideos = await this.searchPexelsVideos(query);
      
      // Combine and limit results
      const allVideos = [...youtubeVideos, ...pexelsVideos].slice(0, this.maxVideos);
      
      // Download videos
      const downloadedVideos = await this.downloadVideos(allVideos);
      
      return downloadedVideos;
    } catch (error) {
      console.error('Error finding videos:', error);
      return [];
    }
  }

  async searchPexelsImages(query) {
    try {
      const response = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=15`, {
        headers: {
          'Authorization': process.env.PEXELS_API_KEY
        }
      });
      
      const data = await response.json();
      
      return data.photos.map(photo => ({
        url: photo.src.original,
        source: 'pexels',
        id: photo.id.toString()
      }));
    } catch (error) {
      console.error('Error searching Pexels images:', error);
      return [];
    }
  }

  async searchUnsplashImages(query) {
    try {
      const response = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=15`, {
        headers: {
          'Authorization': `Client-ID ${process.env.UNSPLASH_API_KEY}`
        }
      });
      
      const data = await response.json();
      
      return data.results.map(photo => ({
        url: photo.urls.full,
        source: 'unsplash',
        id: photo.id
      }));
    } catch (error) {
      console.error('Error searching Unsplash images:', error);
      return [];
    }
  }

  async searchYouTubeVideos(query) {
    try {
      const response = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&maxResults=10&key=${process.env.YOUTUBE_API_KEY}`);
      
      const data = await response.json();
      
      return data.items.map(item => ({
        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        source: 'youtube',
        id: item.id.videoId,
        title: item.snippet.title
      }));
    } catch (error) {
      console.error('Error searching YouTube videos:', error);
      return [];
    }
  }

  async searchPexelsVideos(query) {
    try {
      const response = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=10`, {
        headers: {
          'Authorization': process.env.PEXELS_API_KEY
        }
      });
      
      const data = await response.json();
      
      return data.videos.map(video => {
        // Get the highest quality video file
        const videoFile = video.video_files.reduce((prev, curr) => {
          return (prev.quality === 'hd' || prev.height > curr.height) ? prev : curr;
        });
        
        return {
          url: videoFile.link,
          source: 'pexels',
          id: video.id.toString()
        };
      });
    } catch (error) {
      console.error('Error searching Pexels videos:', error);
      return [];
    }
  }

  async downloadImages(images) {
    const downloadPromises = images.map(async (image, index) => {
      try {
        const response = await fetch(image.url);
        const buffer = await response.buffer();
        
        const filename = `image_${image.source}_${image.id}.jpg`;
        const filepath = path.join(this.tempDir, filename);
        
        fs.writeFileSync(filepath, buffer);
        
        return {
          ...image,
          localPath: filepath
        };
      } catch (error) {
        console.error(`Error downloading image ${image.url}:`, error);
        return null;
      }
    });
    
    const results = await Promise.all(downloadPromises);
    return results.filter(result => result !== null);
  }

  async downloadVideos(videos) {
    const downloadPromises = videos.map(async (video, index) => {
      try {
        // For YouTube videos, we would need a more complex solution with youtube-dl
        // For simplicity, we'll just store the URL for YouTube videos
        if (video.source === 'youtube') {
          return {
            ...video,
            localPath: video.url,  // Just store the URL for YouTube videos
            isYouTube: true
          };
        }
        
        // For Pexels videos, download them
        const response = await fetch(video.url);
        const buffer = await response.buffer();
        
        const filename = `video_${video.source}_${video.id}.mp4`;
        const filepath = path.join(this.tempDir, filename);
        
        fs.writeFileSync(filepath, buffer);
        
        return {
          ...video,
          localPath: filepath,
          isYouTube: false
        };
      } catch (error) {
        console.error(`Error downloading video ${video.url}:`, error);
        return null;
      }
    });
    
    const results = await Promise.all(downloadPromises);
    return results.filter(result => result !== null);
  }
}

module.exports = new ContentFinder();