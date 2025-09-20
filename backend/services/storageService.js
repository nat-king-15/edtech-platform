const { storage } = require('../config/firebase');
const { v4: uuidv4 } = require('uuid');
const admin = require('firebase-admin');

class StorageService {
  constructor() {
    this.bucket = storage.bucket();
  }

  /**
   * Generate a signed upload URL for PDF files
   * @param {string} fileName - Original file name
   * @param {string} contentType - MIME type of the file
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<Object>} Upload URL and file path
   */
  async generateUploadUrl(fileName, contentType = 'application/pdf', metadata = {}) {
    try {
      // Generate unique file path
      const fileExtension = fileName.split('.').pop();
      const uniqueFileName = `${uuidv4()}.${fileExtension}`;
      const filePath = `content/${admin.firestore.Timestamp.fromDate(new Date()).toDate().getFullYear()}/${admin.firestore.Timestamp.fromDate(new Date()).toDate().getMonth() + 1}/${uniqueFileName}`;
      
      const file = this.bucket.file(filePath);
      
      // Configure upload options
      const options = {
        version: 'v4',
        action: 'write',
        expires: Date.now() + 15 * 60 * 1000, // 15 minutes
        contentType: contentType,
        extensionHeaders: {
          'x-goog-meta-original-name': fileName,
          'x-goog-meta-uploaded-by': metadata.teacherId || 'unknown',
          'x-goog-meta-subject-id': metadata.subjectId || '',
          'x-goog-meta-batch-id': metadata.batchId || ''
        }
      };
      
      const [uploadUrl] = await file.getSignedUrl(options);
      
      return {
        uploadUrl,
        filePath,
        fileName: uniqueFileName,
        downloadUrl: `gs://${this.bucket.name}/${filePath}`
      };
    } catch (error) {
      console.error('Error generating upload URL:', error);
      throw new Error('Failed to generate upload URL');
    }
  }

  /**
   * Get public download URL for a file
   * @param {string} filePath - Path to the file in storage
   * @returns {Promise<string>} Public download URL
   */
  async getDownloadUrl(filePath) {
    try {
      const file = this.bucket.file(filePath);
      
      // Make file publicly readable
      await file.makePublic();
      
      // Return public URL
      return `https://storage.googleapis.com/${this.bucket.name}/${filePath}`;
    } catch (error) {
      console.error('Error getting download URL:', error);
      throw new Error('Failed to get download URL');
    }
  }

  /**
   * Generate a signed download URL (temporary access)
   * @param {string} filePath - Path to the file in storage
   * @param {number} expiresInMinutes - URL expiration time in minutes
   * @returns {Promise<string>} Signed download URL
   */
  async getSignedDownloadUrl(filePath, expiresInMinutes = 60) {
    try {
      const file = this.bucket.file(filePath);
      
      const options = {
        version: 'v4',
        action: 'read',
        expires: Date.now() + expiresInMinutes * 60 * 1000
      };
      
      const [signedUrl] = await file.getSignedUrl(options);
      return signedUrl;
    } catch (error) {
      console.error('Error generating signed download URL:', error);
      throw new Error('Failed to generate signed download URL');
    }
  }

  /**
   * Delete a file from storage
   * @param {string} filePath - Path to the file in storage
   * @returns {Promise<boolean>} Success status
   */
  async deleteFile(filePath) {
    try {
      const file = this.bucket.file(filePath);
      await file.delete();
      return true;
    } catch (error) {
      console.error('Error deleting file:', error);
      throw new Error('Failed to delete file');
    }
  }

  /**
   * Check if a file exists in storage
   * @param {string} filePath - Path to the file in storage
   * @returns {Promise<boolean>} File existence status
   */
  async fileExists(filePath) {
    try {
      const file = this.bucket.file(filePath);
      const [exists] = await file.exists();
      return exists;
    } catch (error) {
      console.error('Error checking file existence:', error);
      return false;
    }
  }

  /**
   * Get file metadata
   * @param {string} filePath - Path to the file in storage
   * @returns {Promise<Object>} File metadata
   */
  async getFileMetadata(filePath) {
    try {
      const file = this.bucket.file(filePath);
      const [metadata] = await file.getMetadata();
      return {
        name: metadata.name,
        size: parseInt(metadata.size),
        contentType: metadata.contentType,
        created: metadata.timeCreated,
        updated: metadata.updated,
        originalName: metadata.metadata?.['original-name'],
        uploadedBy: metadata.metadata?.['uploaded-by'],
        subjectId: metadata.metadata?.['subject-id'],
        batchId: metadata.metadata?.['batch-id']
      };
    } catch (error) {
      console.error('Error getting file metadata:', error);
      throw new Error('Failed to get file metadata');
    }
  }

  /**
   * List files in a directory
   * @param {string} prefix - Directory prefix
   * @param {number} maxResults - Maximum number of results
   * @returns {Promise<Array>} List of files
   */
  async listFiles(prefix = 'content/', maxResults = 100) {
    try {
      const [files] = await this.bucket.getFiles({
        prefix,
        maxResults
      });
      
      return files.map(file => ({
        name: file.name,
        path: file.name,
        size: file.metadata.size,
        contentType: file.metadata.contentType,
        created: file.metadata.timeCreated,
        updated: file.metadata.updated
      }));
    } catch (error) {
      console.error('Error listing files:', error);
      throw new Error('Failed to list files');
    }
  }

  /**
   * Copy a file to a new location
   * @param {string} sourcePath - Source file path
   * @param {string} destinationPath - Destination file path
   * @returns {Promise<boolean>} Success status
   */
  async copyFile(sourcePath, destinationPath) {
    try {
      const sourceFile = this.bucket.file(sourcePath);
      const destinationFile = this.bucket.file(destinationPath);
      
      await sourceFile.copy(destinationFile);
      return true;
    } catch (error) {
      console.error('Error copying file:', error);
      throw new Error('Failed to copy file');
    }
  }

  /**
   * Move a file to a new location
   * @param {string} sourcePath - Source file path
   * @param {string} destinationPath - Destination file path
   * @returns {Promise<boolean>} Success status
   */
  async moveFile(sourcePath, destinationPath) {
    try {
      const sourceFile = this.bucket.file(sourcePath);
      const destinationFile = this.bucket.file(destinationPath);
      
      await sourceFile.move(destinationFile);
      return true;
    } catch (error) {
      console.error('Error moving file:', error);
      throw new Error('Failed to move file');
    }
  }
}

module.exports = new StorageService();