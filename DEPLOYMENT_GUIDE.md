# EdTech Platform Deployment Guide

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Secrets Management](#secrets-management)
4. [Local Development](#local-development)
5. [Staging Deployment](#staging-deployment)
6. [Production Deployment](#production-deployment)
7. [Monitoring & Logging](#monitoring--logging)
8. [Backup & Recovery](#backup--recovery)
9. [Troubleshooting](#troubleshooting)
10. [Security Checklist](#security-checklist)

## Prerequisites

### System Requirements
- **Node.js**: 18.x or higher
- **npm**: 9.x or higher
- **Docker**: 24.x or higher
- **Docker Compose**: 2.x or higher
- **Git**: Latest version

### Cloud Services
- **Firebase Project** with the following services enabled:
  - Authentication
  - Firestore Database
  - Storage
  - Cloud Functions (optional)
- **Razorpay Account** for payment processing
- **Mux Account** for video streaming
- **Email Service** (Gmail/SendGrid/AWS SES)

### Domain & SSL
- Domain name registered
- SSL certificate (Let's Encrypt recommended)
- DNS configuration access

## Environment Setup

### 1. Clone Repository
```bash
git clone https://github.com/your-org/edtech-platform.git
cd edtech-platform
```

### 2. Environment Files
Create environment files for different stages:

#### Backend Environment (`.env`)
```env
# Server Configuration
NODE_ENV=production
PORT=5000
HOST=0.0.0.0

# Database Configuration
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com

# Redis Configuration
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=your-redis-password

# Payment Configuration
RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxx
RAZORPAY_KEY_SECRET=your-razorpay-secret

# Video Streaming Configuration
MUX_TOKEN_ID=your-mux-token-id
MUX_TOKEN_SECRET=your-mux-token-secret
MUX_WEBHOOK_SECRET=your-mux-webhook-secret

# Email Configuration
EMAIL_SERVICE=gmail
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
EMAIL_FROM=noreply@yourdomain.com

# Security Configuration
JWT_SECRET=your-super-secure-jwt-secret-key
ENCRYPTION_KEY=your-32-character-encryption-key
SESSION_SECRET=your-session-secret-key

# CORS Configuration
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Monitoring
SENTRY_DSN=https://your-sentry-dsn@sentry.io/project-id
```

#### Frontend Environment (`.env.local`)
```env
# API Configuration
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
NEXT_PUBLIC_FRONTEND_URL=https://yourdomain.com

# Firebase Configuration
NEXT_PUBLIC_FIREBASE_API_KEY=your-firebase-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789012
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789012:web:abcdef123456

# Payment Configuration
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxx

# Analytics
NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX
NEXT_PUBLIC_HOTJAR_ID=1234567

# Environment
NEXT_PUBLIC_ENVIRONMENT=production
```

## Secrets Management

### 1. Environment Variables Security
- **Never commit** `.env` files to version control
- Use different secrets for each environment
- Rotate secrets regularly (quarterly recommended)
- Use strong, randomly generated passwords

### 2. Cloud Secrets Management

#### AWS Secrets Manager
```bash
# Store secrets
aws secretsmanager create-secret \
  --name "edtech/production/database" \
  --description "Database credentials" \
  --secret-string '{"username":"admin","password":"secure-password"}'

# Retrieve secrets in application
const secret = await secretsManager.getSecretValue({
  SecretId: "edtech/production/database"
}).promise();
```

#### Azure Key Vault
```bash
# Store secrets
az keyvault secret set \
  --vault-name "edtech-keyvault" \
  --name "database-password" \
  --value "secure-password"
```

#### Google Secret Manager
```bash
# Store secrets
gcloud secrets create database-password --data-file=-
echo "secure-password" | gcloud secrets versions add database-password --data-file=-
```

### 3. Docker Secrets
```yaml
# docker-compose.prod.yml
version: '3.8'
services:
  backend:
    secrets:
      - db_password
      - jwt_secret
    environment:
      - DB_PASSWORD_FILE=/run/secrets/db_password
      - JWT_SECRET_FILE=/run/secrets/jwt_secret

secrets:
  db_password:
    external: true
  jwt_secret:
    external: true
```

## Local Development

### 1. Quick Start
```bash
# Install dependencies
npm run install:all

# Start development services
docker-compose up -d redis

# Start backend
cd backend && npm run dev

# Start frontend (in new terminal)
cd frontend && npm run dev
```

### 2. Development with Docker
```bash
# Start all development services
docker-compose --profile dev up -d

# View logs
docker-compose logs -f backend frontend

# Stop services
docker-compose down
```

### 3. Database Setup
```bash
# Initialize Firestore (if using local emulator)
firebase emulators:start --only firestore

# Seed development data
npm run seed:dev
```

## Staging Deployment

### 1. Server Setup
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

### 2. Application Deployment
```bash
# Clone repository
git clone https://github.com/your-org/edtech-platform.git
cd edtech-platform

# Checkout staging branch
git checkout staging

# Set up environment
cp .env.staging .env
cp frontend/.env.staging frontend/.env.local

# Build and start services
docker-compose -f docker-compose.staging.yml up -d --build

# Run database migrations
docker-compose exec backend npm run migrate

# Verify deployment
curl -f http://localhost/health || exit 1
```

### 3. Nginx Configuration
```nginx
# /etc/nginx/sites-available/edtech-staging
server {
    listen 80;
    server_name staging.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name staging.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/staging.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/staging.yourdomain.com/privkey.pem;

    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains";

    # Frontend
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
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Rate limiting
        limit_req zone=api burst=20 nodelay;
    }
}
```

## Production Deployment

### 1. Infrastructure Setup

#### Using Docker Swarm
```bash
# Initialize swarm
docker swarm init

# Deploy stack
docker stack deploy -c docker-compose.prod.yml edtech

# Scale services
docker service scale edtech_backend=3
docker service scale edtech_frontend=2
```

#### Using Kubernetes
```yaml
# k8s/deployment.yml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: edtech-backend
spec:
  replicas: 3
  selector:
    matchLabels:
      app: edtech-backend
  template:
    metadata:
      labels:
        app: edtech-backend
    spec:
      containers:
      - name: backend
        image: your-registry/edtech-backend:latest
        ports:
        - containerPort: 5000
        env:
        - name: NODE_ENV
          value: "production"
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: edtech-secrets
              key: database-url
```

### 2. Load Balancer Configuration
```yaml
# AWS Application Load Balancer
apiVersion: v1
kind: Service
metadata:
  name: edtech-alb
  annotations:
    service.beta.kubernetes.io/aws-load-balancer-type: "nlb"
spec:
  type: LoadBalancer
  ports:
  - port: 80
    targetPort: 3000
  - port: 443
    targetPort: 3000
  selector:
    app: edtech-frontend
```

### 3. Database Configuration
```bash
# Firestore production setup
firebase use production
firebase deploy --only firestore:rules,firestore:indexes

# Backup configuration
gcloud firestore export gs://your-backup-bucket/$(date +%Y%m%d-%H%M%S)
```

### 4. CDN Setup
```javascript
// next.config.js
module.exports = {
  images: {
    domains: ['your-cdn-domain.com'],
    loader: 'custom',
    loaderFile: './src/utils/imageLoader.js'
  },
  assetPrefix: process.env.NODE_ENV === 'production' 
    ? 'https://cdn.yourdomain.com' 
    : ''
}
```

## Monitoring & Logging

### 1. Application Monitoring

#### Prometheus Configuration
```yaml
# docker/prometheus/prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'edtech-backend'
    static_configs:
      - targets: ['backend:5000']
    metrics_path: '/metrics'
    
  - job_name: 'edtech-frontend'
    static_configs:
      - targets: ['frontend:3000']
    metrics_path: '/api/metrics'

  - job_name: 'redis'
    static_configs:
      - targets: ['redis:6379']

  - job_name: 'node-exporter'
    static_configs:
      - targets: ['node-exporter:9100']
```

#### Grafana Dashboards
```json
{
  "dashboard": {
    "title": "EdTech Platform Metrics",
    "panels": [
      {
        "title": "API Response Time",
        "type": "graph",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))",
            "legendFormat": "95th percentile"
          }
        ]
      },
      {
        "title": "Active Users",
        "type": "stat",
        "targets": [
          {
            "expr": "active_users_total",
            "legendFormat": "Active Users"
          }
        ]
      }
    ]
  }
}
```

### 2. Logging Configuration

#### Winston Logger Setup
```javascript
// backend/src/utils/logger.js
const winston = require('winston');
const { ElasticsearchTransport } = require('winston-elasticsearch');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new ElasticsearchTransport({
      level: 'info',
      clientOpts: { node: process.env.ELASTICSEARCH_URL }
    })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}
```

### 3. Health Checks
```javascript
// backend/src/routes/health.js
const express = require('express');
const router = express.Router();

router.get('/health', async (req, res) => {
  const health = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    services: {}
  };

  try {
    // Check database connection
    await admin.firestore().collection('health').doc('test').get();
    health.services.database = 'OK';
  } catch (error) {
    health.services.database = 'ERROR';
    health.status = 'ERROR';
  }

  try {
    // Check Redis connection
    await redisClient.ping();
    health.services.redis = 'OK';
  } catch (error) {
    health.services.redis = 'ERROR';
    health.status = 'ERROR';
  }

  const statusCode = health.status === 'OK' ? 200 : 503;
  res.status(statusCode).json(health);
});
```

### 4. Alerting Rules
```yaml
# docker/prometheus/alert.rules.yml
groups:
- name: edtech.rules
  rules:
  - alert: HighErrorRate
    expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.1
    for: 5m
    labels:
      severity: critical
    annotations:
      summary: "High error rate detected"
      description: "Error rate is {{ $value }} errors per second"

  - alert: HighResponseTime
    expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 1
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "High response time detected"
      description: "95th percentile response time is {{ $value }} seconds"

  - alert: DatabaseConnectionFailed
    expr: up{job="edtech-backend"} == 0
    for: 1m
    labels:
      severity: critical
    annotations:
      summary: "Backend service is down"
      description: "Backend service has been down for more than 1 minute"
```

## Backup & Recovery

### 1. Database Backup
```bash
#!/bin/bash
# scripts/backup-firestore.sh

DATE=$(date +%Y%m%d-%H%M%S)
BUCKET="gs://your-backup-bucket"
PROJECT_ID="your-project-id"

# Export Firestore data
gcloud firestore export $BUCKET/firestore-backup-$DATE \
  --project=$PROJECT_ID

# Backup to multiple locations
gsutil -m cp -r $BUCKET/firestore-backup-$DATE \
  gs://your-secondary-backup-bucket/firestore-backup-$DATE

echo "Backup completed: firestore-backup-$DATE"
```

### 2. File Storage Backup
```bash
#!/bin/bash
# scripts/backup-storage.sh

DATE=$(date +%Y%m%d-%H%M%S)
SOURCE_BUCKET="your-project-id.appspot.com"
BACKUP_BUCKET="your-backup-bucket"

# Sync Firebase Storage to backup bucket
gsutil -m rsync -r -d gs://$SOURCE_BUCKET gs://$BACKUP_BUCKET/storage-backup-$DATE

echo "Storage backup completed: storage-backup-$DATE"
```

### 3. Automated Backup Schedule
```yaml
# k8s/cronjob-backup.yml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: firestore-backup
spec:
  schedule: "0 2 * * *"  # Daily at 2 AM
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: backup
            image: google/cloud-sdk:alpine
            command:
            - /bin/bash
            - -c
            - |
              gcloud auth activate-service-account --key-file=/secrets/service-account.json
              gcloud firestore export gs://your-backup-bucket/$(date +%Y%m%d-%H%M%S)
            volumeMounts:
            - name: service-account
              mountPath: /secrets
          volumes:
          - name: service-account
            secret:
              secretName: gcp-service-account
          restartPolicy: OnFailure
```

### 4. Recovery Procedures
```bash
# Restore Firestore from backup
gcloud firestore import gs://your-backup-bucket/firestore-backup-20240115-020000

# Restore specific collection
gcloud firestore import gs://your-backup-bucket/firestore-backup-20240115-020000 \
  --collection-ids=users,courses

# Point-in-time recovery (if available)
gcloud firestore databases restore \
  --source-backup=projects/your-project/locations/us-central1/backups/backup-id \
  --destination-database=restored-database
```

## Troubleshooting

### 1. Common Issues

#### High Memory Usage
```bash
# Check memory usage
docker stats

# Analyze Node.js memory
node --inspect backend/server.js
# Connect to chrome://inspect

# Optimize memory
NODE_OPTIONS="--max-old-space-size=4096" npm start
```

#### Database Connection Issues
```javascript
// Add connection retry logic
const connectWithRetry = async () => {
  try {
    await admin.firestore().collection('health').doc('test').get();
    console.log('Database connected successfully');
  } catch (error) {
    console.error('Database connection failed, retrying in 5 seconds...', error);
    setTimeout(connectWithRetry, 5000);
  }
};
```

#### SSL Certificate Issues
```bash
# Check certificate expiry
openssl x509 -in /etc/letsencrypt/live/yourdomain.com/cert.pem -text -noout | grep "Not After"

# Renew Let's Encrypt certificate
certbot renew --nginx

# Test SSL configuration
curl -I https://yourdomain.com
```

### 2. Performance Optimization

#### Database Optimization
```javascript
// Use composite indexes
// firestore.indexes.json
{
  "indexes": [
    {
      "collectionGroup": "courses",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "category", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    }
  ]
}

// Optimize queries
const courses = await db.collection('courses')
  .where('category', '==', 'programming')
  .orderBy('createdAt', 'desc')
  .limit(10)
  .get();
```

#### Caching Strategy
```javascript
// Redis caching
const getCachedCourses = async (category) => {
  const cacheKey = `courses:${category}`;
  
  // Try cache first
  const cached = await redisClient.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }
  
  // Fetch from database
  const courses = await fetchCoursesFromDB(category);
  
  // Cache for 1 hour
  await redisClient.setex(cacheKey, 3600, JSON.stringify(courses));
  
  return courses;
};
```

### 3. Debugging Tools

#### Application Debugging
```bash
# Enable debug mode
DEBUG=app:* npm start

# Profile application
node --prof backend/server.js
node --prof-process isolate-*.log > processed.txt

# Memory leak detection
node --inspect --trace-warnings backend/server.js
```

#### Network Debugging
```bash
# Check port availability
netstat -tulpn | grep :5000

# Test API endpoints
curl -X GET https://api.yourdomain.com/health \
  -H "Authorization: Bearer $TOKEN" \
  -v

# Monitor network traffic
tcpdump -i eth0 port 5000
```

## Security Checklist

### 1. Application Security
- [ ] Input validation on all endpoints
- [ ] SQL injection prevention (parameterized queries)
- [ ] XSS protection (Content Security Policy)
- [ ] CSRF protection (tokens)
- [ ] Rate limiting implemented
- [ ] Authentication and authorization
- [ ] Secure session management
- [ ] Password hashing (bcrypt)
- [ ] Secure file uploads
- [ ] API versioning

### 2. Infrastructure Security
- [ ] Firewall configuration
- [ ] SSL/TLS certificates
- [ ] Security headers
- [ ] Regular security updates
- [ ] Access logging
- [ ] Intrusion detection
- [ ] Backup encryption
- [ ] Network segmentation
- [ ] VPN access for admin
- [ ] Multi-factor authentication

### 3. Data Security
- [ ] Data encryption at rest
- [ ] Data encryption in transit
- [ ] Personal data anonymization
- [ ] GDPR compliance
- [ ] Data retention policies
- [ ] Secure data disposal
- [ ] Access audit trails
- [ ] Data backup verification
- [ ] Privacy policy implementation
- [ ] Cookie consent management

### 4. Monitoring Security
- [ ] Security event logging
- [ ] Anomaly detection
- [ ] Vulnerability scanning
- [ ] Penetration testing
- [ ] Security incident response plan
- [ ] Regular security audits
- [ ] Compliance monitoring
- [ ] Threat intelligence feeds
- [ ] Security awareness training
- [ ] Incident documentation

---

## Support & Maintenance

### Contact Information
- **DevOps Team**: devops@yourdomain.com
- **Security Team**: security@yourdomain.com
- **On-call**: +1-xxx-xxx-xxxx

### Documentation Updates
This guide should be updated whenever:
- New services are added
- Security procedures change
- Infrastructure modifications are made
- New monitoring tools are implemented

### Regular Maintenance Schedule
- **Daily**: Health checks, log review
- **Weekly**: Security updates, backup verification
- **Monthly**: Performance review, capacity planning
- **Quarterly**: Security audit, disaster recovery testing
- **Annually**: Full infrastructure review, compliance audit

---

*Last updated: January 2024*
*Version: 1.0*