const handlebars = require('handlebars');
const fs = require('fs').promises;
const path = require('path');

/**
 * Template Engine Service for Email Templates
 * Provides centralized template management with caching and helper functions
 */
class TemplateEngine {
  constructor() {
    this.templateCache = new Map();
    this.templatesDir = path.join(__dirname, '../templates/emails');
    this.registerHelpers();
  }

  /**
   * Register Handlebars helper functions
   */
  registerHelpers() {
    // Format date helper
    handlebars.registerHelper('formatDate', (date, format = 'YYYY-MM-DD') => {
      if (!date) return '';
      const d = new Date(date);
      return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    });

    // Format currency helper
    handlebars.registerHelper('formatCurrency', (amount, currency = 'INR') => {
      if (!amount) return '₹0';
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: currency
      }).format(amount);
    });

    // Conditional helper
    handlebars.registerHelper('ifEquals', function(arg1, arg2, options) {
      return (arg1 == arg2) ? options.fn(this) : options.inverse(this);
    });

    // Capitalize helper
    handlebars.registerHelper('capitalize', (str) => {
      if (!str) return '';
      return str.charAt(0).toUpperCase() + str.slice(1);
    });

    // Join array helper
    handlebars.registerHelper('join', (array, separator = ', ') => {
      if (!Array.isArray(array)) return '';
      return array.join(separator);
    });
  }

  /**
   * Load and compile template from file
   * @param {string} templateName - Name of the template file (without .hbs extension)
   * @returns {Promise<Function>} Compiled template function
   */
  async loadTemplate(templateName) {
    // Check cache first
    if (this.templateCache.has(templateName)) {
      return this.templateCache.get(templateName);
    }

    try {
      const templatePath = path.join(this.templatesDir, `${templateName}.hbs`);
      const templateSource = await fs.readFile(templatePath, 'utf8');
      const compiledTemplate = handlebars.compile(templateSource);
      
      // Cache the compiled template
      this.templateCache.set(templateName, compiledTemplate);
      
      return compiledTemplate;
    } catch (error) {
      throw new Error(`Failed to load template '${templateName}': ${error.message}`);
    }
  }

  /**
   * Render template with data
   * @param {string} templateName - Name of the template
   * @param {Object} data - Data to render in template
   * @returns {Promise<string>} Rendered HTML
   */
  async render(templateName, data = {}) {
    try {
      const template = await this.loadTemplate(templateName);
      
      // Add common data available to all templates
      const templateData = {
        ...data,
        currentYear: new Date().getFullYear(),
        platformName: 'EdTech Platform',
        supportEmail: process.env.SUPPORT_EMAIL || 'support@edtech.com',
        baseUrl: process.env.BASE_URL || 'https://edtech.com'
      };

      return template(templateData);
    } catch (error) {
      throw new Error(`Failed to render template '${templateName}': ${error.message}`);
    }
  }

  /**
   * Clear template cache
   */
  clearCache() {
    this.templateCache.clear();
  }

  /**
   * Get available templates
   * @returns {Promise<string[]>} Array of template names
   */
  async getAvailableTemplates() {
    try {
      const files = await fs.readdir(this.templatesDir);
      return files
        .filter(file => file.endsWith('.hbs'))
        .map(file => file.replace('.hbs', ''));
    } catch (error) {
      return [];
    }
  }

  /**
   * Preload commonly used templates
   */
  async preloadTemplates() {
    const commonTemplates = [
      'teacher-assignment',
      'general-notification',
      'welcome',
      'password-reset',
      'course-enrollment'
    ];

    const loadPromises = commonTemplates.map(template => 
      this.loadTemplate(template).catch(() => null) // Ignore errors for missing templates
    );

    await Promise.all(loadPromises);
  }

  /**
   * Validate template syntax
   * @param {string} templateSource - Template source code
   * @returns {boolean} True if valid, throws error if invalid
   */
  validateTemplate(templateSource) {
    try {
      handlebars.compile(templateSource);
      return true;
    } catch (error) {
      throw new Error(`Invalid template syntax: ${error.message}`);
    }
  }
}

// Export singleton instance
module.exports = new TemplateEngine();