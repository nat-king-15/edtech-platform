# Deployment Guide

Comprehensive guide for deploying the EdTech Platform API to production environments.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Local Development](#local-development)
4. [Production Deployment](#production-deployment)
5. [Docker Deployment](#docker-deployment)
6. [Cloud Deployment](#cloud-deployment)
7. [Monitoring and Logging](#monitoring-and-logging)
8. [Security Considerations](#security-considerations)
9. [Troubleshooting](#troubleshooting)

## Prerequisites

### System Requirements
- Node.js 18.x or higher
- npm 9.x or higher
- Git
- Firebase CLI (for Firebase setup)

### Required Services
- Firebase Project with Authentication and Firestore enabled
- Gmail account with App Password (for email notifications)
- Domain name (for production deployment)
- SSL certificate (for HTTPS)

## Environment Setup

### 1. Clone Repository
```bash
git clone <repository-url>
cd edtech-platform/backend
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Variables

Create `.env` file in the backend root directory:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# Firebase Configuration
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_PRIVATE_KEY_ID=your-private-key-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour-Private-Key-Here\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
FIREBASE_CLIENT_ID=your-client-id
FIREBASE_AUTH_URI=https://accounts.google.com/o/oauth2/auth
FIREBASE_TOKEN_URI=https://oauth2.googleapis.com/token
FIREBASE_AUTH_PROVIDER_X509_CERT_URL=https://www.googleapis.com/oauth2/v1/certs
FIREBASE_CLIENT_X509_CERT_URL=https://www.googleapis.com/robot/v1/metadata/x509/your-service-account%40your-project.iam.gserviceaccount.com

# Email Configuration
EMAIL_USER=your-gmail@gmail.com
EMAIL_PASSWORD=your-app-password
FRONTEND_URL=http://localhost:3000

# Security (Production Only)
JWT_SECRET=your-super-secret-jwt-key
ENCRYPTION_KEY=your-32-character-encryption-key
```

### 4. Firebase Setup

#### Create Firebase Project
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project
3. Enable Authentication and Firestore

#### Generate Service Account Key
1. Go to Project Settings > Service Accounts
2. Generate new private key
3. Download JSON file
4. Extract values for environment variables

#### Configure Firestore Rules
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users collection
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
      allow read: if request.auth != null && 
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role in ['admin', 'teacher'];
    }
    
    // Courses collection
    match /courses/{courseId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && 
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }
    
    // Batches collection
    match /batches/{batchId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && 
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }
    
    // Subjects collection
    match /subjects/{subjectId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && 
        (get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin' ||
         (get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'teacher' &&
          resource.data.teacherId == request.auth.uid));
    }
  }
}
```

### 5. Gmail App Password Setup

1. Enable 2-Factor Authentication on your Gmail account
2. Go to Google Account Settings > Security > App Passwords
3. Generate app password for "Mail"
4. Use this password in `EMAIL_PASSWORD` environment variable

## Local Development

### Start Development Server
```bash
npm run dev
```

### Run Tests
```bash
npm test
```

### Check Code Quality
```bash
npm run lint
npm run format
```

### Database Seeding (Optional)
```bash
npm run seed
```

## Production Deployment

### 1. Server Setup

#### Ubuntu/Debian Server
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 (Process Manager)
sudo npm install -g pm2

# Install Nginx (Reverse Proxy)
sudo apt install nginx -y

# Install Certbot (SSL Certificates)
sudo apt install certbot python3-certbot-nginx -y
```

### 2. Application Deployment

```bash
# Clone repository
git clone <repository-url>
cd edtech-platform/backend

# Install dependencies
npm ci --only=production

# Create production environment file
sudo nano .env.production
```

#### Production Environment Variables
```env
NODE_ENV=production
PORT=3000

# Firebase Configuration (same as development)
FIREBASE_PROJECT_ID=your-firebase-project-id
# ... other Firebase variables

# Email Configuration
EMAIL_USER=your-gmail@gmail.com
EMAIL_PASSWORD=your-app-password
FRONTEND_URL=https://yourdomain.com

# Security
JWT_SECRET=your-super-secret-jwt-key-different-from-dev
ENCRYPTION_KEY=your-32-character-encryption-key

# Logging
LOG_LEVEL=info
LOG_FILE=/var/log/edtech-api/app.log
```

### 3. PM2 Configuration

Create `ecosystem.config.js`:
```javascript
module.exports = {
  apps: [{
    name: 'edtech-api',
    script: './server.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'development'
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    log_file: '/var/log/edtech-api/combined.log',
    out_file: '/var/log/edtech-api/out.log',
    error_file: '/var/log/edtech-api/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    max_memory_restart: '1G',
    node_args: '--max-old-space-size=1024'
  }]
};
```

### 4. Start Application
```bash
# Create log directory
sudo mkdir -p /var/log/edtech-api
sudo chown $USER:$USER /var/log/edtech-api

# Start with PM2
pm2 start ecosystem.config.js --env production

# Save PM2 configuration
pm2 save

# Setup PM2 startup
pm2 startup
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u $USER --hp $HOME
```

### 5. Nginx Configuration

Create `/etc/nginx/sites-available/edtech-api`:
```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    
    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;
    
    # SSL Configuration
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    
    # Security Headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    
    # Rate Limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req zone=api burst=20 nodelay;
    
    # Proxy to Node.js application
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    # Health check endpoint
    location /health {
        access_log off;
        proxy_pass http://localhost:3000/health;
    }
    
    # Static files (if any)
    location /static/ {
        alias /path/to/static/files/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

### 6. Enable Nginx Site
```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/edtech-api /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
```

### 7. SSL Certificate
```bash
# Obtain SSL certificate
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Test auto-renewal
sudo certbot renew --dry-run
```

## Docker Deployment

### 1. Dockerfile

Create `Dockerfile`:
```dockerfile
FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy application code
COPY . .

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Change ownership
RUN chown -R nodejs:nodejs /usr/src/app
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node healthcheck.js

# Start application
CMD ["node", "server.js"]
```

### 2. Docker Compose

Create `docker-compose.yml`:
```yaml
version: '3.8'

services:
  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    env_file:
      - .env.production
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "healthcheck.js"]
      interval: 30s
      timeout: 10s
      retries: 3
    volumes:
      - ./logs:/usr/src/app/logs
    networks:
      - edtech-network

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/ssl/certs
    depends_on:
      - api
    restart: unless-stopped
    networks:
      - edtech-network

networks:
  edtech-network:
    driver: bridge

volumes:
  logs:
```

### 3. Build and Deploy
```bash
# Build image
docker build -t edtech-api .

# Run with Docker Compose
docker-compose up -d

# View logs
docker-compose logs -f api

# Scale application
docker-compose up -d --scale api=3
```

## Cloud Deployment

### AWS Deployment

#### Using AWS Elastic Beanstalk
1. Install AWS CLI and EB CLI
2. Initialize Elastic Beanstalk application
3. Configure environment variables
4. Deploy application

```bash
# Initialize EB application
eb init

# Create environment
eb create production

# Set environment variables
eb setenv NODE_ENV=production FIREBASE_PROJECT_ID=your-project-id

# Deploy
eb deploy
```

#### Using AWS ECS
1. Create ECR repository
2. Build and push Docker image
3. Create ECS cluster and service
4. Configure load balancer

### Google Cloud Deployment

#### Using Google App Engine
Create `app.yaml`:
```yaml
runtime: nodejs18

env_variables:
  NODE_ENV: production
  FIREBASE_PROJECT_ID: your-project-id
  # ... other environment variables

automatic_scaling:
  min_instances: 1
  max_instances: 10
  target_cpu_utilization: 0.6

resources:
  cpu: 1
  memory_gb: 0.5
  disk_size_gb: 10
```

Deploy:
```bash
gcloud app deploy
```

### Heroku Deployment

```bash
# Create Heroku app
heroku create edtech-api

# Set environment variables
heroku config:set NODE_ENV=production
heroku config:set FIREBASE_PROJECT_ID=your-project-id
# ... set other variables

# Deploy
git push heroku main

# Scale dynos
heroku ps:scale web=2
```

## Monitoring and Logging

### 1. Application Monitoring

#### PM2 Monitoring
```bash
# Monitor processes
pm2 monit

# View logs
pm2 logs

# Restart application
pm2 restart edtech-api

# Reload with zero downtime
pm2 reload edtech-api
```

#### Health Checks
Create `healthcheck.js`:
```javascript
const http = require('http');

const options = {
  hostname: 'localhost',
  port: process.env.PORT || 3000,
  path: '/health',
  method: 'GET',
  timeout: 2000
};

const req = http.request(options, (res) => {
  if (res.statusCode === 200) {
    process.exit(0);
  } else {
    process.exit(1);
  }
});

req.on('error', () => {
  process.exit(1);
});

req.on('timeout', () => {
  req.destroy();
  process.exit(1);
});

req.end();
```

### 2. Logging Configuration

Install logging packages:
```bash
npm install winston winston-daily-rotate-file
```

Create `utils/logger.js`:
```javascript
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'edtech-api' },
  transports: [
    new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '20m',
      maxFiles: '14d'
    }),
    new DailyRotateFile({
      filename: 'logs/combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d'
    })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

module.exports = logger;
```

### 3. Performance Monitoring

Install monitoring packages:
```bash
npm install express-rate-limit helmet compression
```

Add to `server.js`:
```javascript
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');

// Security middleware
app.use(helmet());

// Compression
app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP'
});
app.use('/api/', limiter);
```

## Security Considerations

### 1. Environment Variables
- Never commit `.env` files to version control
- Use different secrets for different environments
- Rotate secrets regularly
- Use strong, random passwords and keys

### 2. Firebase Security
- Configure proper Firestore security rules
- Use service account with minimal permissions
- Enable Firebase App Check in production
- Monitor Firebase usage and billing

### 3. Server Security
- Keep server and dependencies updated
- Use HTTPS everywhere
- Implement proper CORS policies
- Use security headers (helmet.js)
- Implement rate limiting
- Monitor for security vulnerabilities

### 4. Database Security
- Use Firestore security rules
- Validate all input data
- Implement proper authentication
- Monitor database access patterns

## Troubleshooting

### Common Issues

#### Application Won't Start
1. Check environment variables
2. Verify Firebase configuration
3. Check port availability
4. Review application logs

#### Authentication Errors
1. Verify Firebase service account key
2. Check token expiration
3. Validate Firestore rules
4. Test with Firebase emulator

#### Email Not Sending
1. Verify Gmail app password
2. Check email configuration
3. Test SMTP connection
4. Review email service logs

#### Performance Issues
1. Monitor CPU and memory usage
2. Check database query performance
3. Implement caching strategies
4. Scale application horizontally

### Debugging Commands

```bash
# Check application status
pm2 status

# View real-time logs
pm2 logs --lines 100

# Monitor system resources
top
htop

# Check network connections
netstat -tulpn

# Test API endpoints
curl -X GET http://localhost:3000/health

# Check SSL certificate
openssl s_client -connect yourdomain.com:443
```

### Log Analysis

```bash
# Search for errors
grep -i error /var/log/edtech-api/error.log

# Monitor access patterns
tail -f /var/log/nginx/access.log

# Check application performance
grep -i "slow" /var/log/edtech-api/combined.log
```

## Maintenance

### Regular Tasks

1. **Update Dependencies**
```bash
npm audit
npm update
```

2. **Monitor Logs**
```bash
pm2 logs --lines 50
```

3. **Check SSL Certificate**
```bash
sudo certbot certificates
```

4. **Database Maintenance**
- Monitor Firestore usage
- Clean up old data
- Optimize queries

5. **Security Updates**
- Update server packages
- Review security advisories
- Update Firebase SDK

### Backup Strategy

1. **Code Backup**
- Use version control (Git)
- Regular repository backups

2. **Database Backup**
- Export Firestore data regularly
- Store backups in secure location

3. **Configuration Backup**
- Backup environment variables
- Document configuration changes

This deployment guide provides comprehensive instructions for deploying the EdTech Platform API in various environments. Follow the appropriate section based on your deployment needs and infrastructure requirements.