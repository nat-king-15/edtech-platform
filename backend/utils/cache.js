const NodeCache = require('node-cache');

// Create cache instance with default TTL of 5 minutes (300 seconds)
const cache = new NodeCache({ 
  stdTTL: 300, // 5 minutes default
  checkperiod: 60, // Check for expired keys every 60 seconds
  useClones: false // Don't clone objects for better performance
});

/**
 * Cache utility functions
 */
class CacheManager {
  /**
   * Get value from cache
   * @param {string} key - Cache key
   * @returns {any} Cached value or undefined
   */
  static get(key) {
    try {
      return cache.get(key);
    } catch (error) {
      console.error('Cache get error:', error);
      return undefined;
    }
  }

  /**
   * Set value in cache
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} ttl - Time to live in seconds (optional)
   * @returns {boolean} Success status
   */
  static set(key, value, ttl = null) {
    try {
      if (ttl) {
        return cache.set(key, value, ttl);
      }
      return cache.set(key, value);
    } catch (error) {
      console.error('Cache set error:', error);
      return false;
    }
  }

  /**
   * Delete value from cache
   * @param {string} key - Cache key
   * @returns {number} Number of deleted keys
   */
  static del(key) {
    try {
      return cache.del(key);
    } catch (error) {
      console.error('Cache delete error:', error);
      return 0;
    }
  }

  /**
   * Delete multiple keys from cache
   * @param {string[]} keys - Array of cache keys
   * @returns {number} Number of deleted keys
   */
  static delMultiple(keys) {
    try {
      return cache.del(keys);
    } catch (error) {
      console.error('Cache delete multiple error:', error);
      return 0;
    }
  }

  /**
   * Clear all cache
   */
  static flush() {
    try {
      cache.flushAll();
      console.log('Cache flushed successfully');
    } catch (error) {
      console.error('Cache flush error:', error);
    }
  }

  /**
   * Get cache statistics
   * @returns {object} Cache stats
   */
  static getStats() {
    try {
      return cache.getStats();
    } catch (error) {
      console.error('Cache stats error:', error);
      return {};
    }
  }

  /**
   * Check if key exists in cache
   * @param {string} key - Cache key
   * @returns {boolean} True if key exists
   */
  static has(key) {
    try {
      return cache.has(key);
    } catch (error) {
      console.error('Cache has error:', error);
      return false;
    }
  }

  /**
   * Get or set pattern - if key exists return it, otherwise execute function and cache result
   * @param {string} key - Cache key
   * @param {Function} fetchFunction - Function to execute if cache miss
   * @param {number} ttl - Time to live in seconds (optional)
   * @returns {Promise<any>} Cached or fresh data
   */
  static async getOrSet(key, fetchFunction, ttl = null) {
    try {
      // Try to get from cache first
      const cachedValue = this.get(key);
      if (cachedValue !== undefined) {
        return cachedValue;
      }

      // Cache miss - execute function
      const freshValue = await fetchFunction();
      
      // Cache the result
      this.set(key, freshValue, ttl);
      
      return freshValue;
    } catch (error) {
      console.error('Cache getOrSet error:', error);
      // If caching fails, still return the fresh value
      return await fetchFunction();
    }
  }

  /**
   * Invalidate cache keys by pattern
   * @param {string} pattern - Pattern to match keys (supports wildcards)
   */
  static invalidatePattern(pattern) {
    try {
      const keys = cache.keys();
      const keysToDelete = keys.filter(key => {
        // Simple pattern matching - replace * with .* for regex
        const regexPattern = pattern.replace(/\*/g, '.*');
        const regex = new RegExp(`^${regexPattern}$`);
        return regex.test(key);
      });
      
      if (keysToDelete.length > 0) {
        this.delMultiple(keysToDelete);
        console.log(`Invalidated ${keysToDelete.length} cache keys matching pattern: ${pattern}`);
      }
    } catch (error) {
      console.error('Cache invalidate pattern error:', error);
    }
  }
}

// Cache key generators for consistent naming
const CacheKeys = {
  // User-related cache keys
  USERS_LIST: 'users:list',
  USER_BY_ID: (userId) => `user:${userId}`,
  TEACHERS_LIST: 'teachers:list',
  
  // Course-related cache keys
  COURSES_LIST: 'courses:list',
  COURSE_BY_ID: (courseId) => `course:${courseId}`,
  COURSE_BATCHES: (courseId) => `course:${courseId}:batches`,
  
  // Batch-related cache keys
  BATCH_BY_ID: (batchId) => `batch:${batchId}`,
  BATCH_SUBJECTS: (batchId) => `batch:${batchId}:subjects`,
  
  // Subject-related cache keys
  SUBJECT_BY_ID: (subjectId) => `subject:${subjectId}`,
  
  // Dashboard cache keys
  ADMIN_DASHBOARD_STATS: 'admin:dashboard:stats',
  
  // Platform settings
  PLATFORM_SETTINGS: 'platform:settings',
  ADMIN_SETTINGS: 'admin:settings'
};

// Cache TTL constants (in seconds)
const CacheTTL = {
  SHORT: 60,        // 1 minute
  MEDIUM: 300,      // 5 minutes
  LONG: 600,        // 10 minutes
  VERY_LONG: 900,   // 15 minutes
  EXTRA_LONG: 1800  // 30 minutes
};

module.exports = {
  CacheManager,
  CacheKeys,
  CacheTTL
};