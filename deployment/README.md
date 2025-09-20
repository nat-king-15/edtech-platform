# EdTech Platform Production Deployment

This directory contains all the necessary files for deploying the EdTech Platform to production.

## Files Included

- `docker-compose.prod.yml` - Production Docker Compose configuration
- `nginx.conf` - Production Nginx reverse proxy configuration
- `backend.env.example` - Example backend environment variables
- `frontend.env.example` - Example frontend environment variables
- `scripts/build-production.sh` - Production build script

## Prerequisites

1. **Docker and Docker Compose** installed on your production server
2. **SSL Certificate** for HTTPS (Let's Encrypt recommended)
3. **Domain name** configured to point to your server
4. **Firebase Project** set up for production
5. **Razorpay Account** for payment processing
6. **Mux Account** for video streaming

## Environment Setup

### 1. Configure Backend Environment

Copy `backend.env.example` to `.env.production` and update the values:

```bash
cp backend.env.example ../backend/.env.production
```

Required environment variables:
- `FIREBASE_PROJECT_ID` - Your Firebase project ID
- `FIREBASE_PRIVATE_KEY` - Firebase service account private key
- `FIREBASE_CLIENT_EMAIL` - Firebase service account email
- `RAZORPAY_KEY_ID` - Razorpay live key ID
- `RAZORPAY_KEY_SECRET` - Razorpay live key secret
- `MUX_TOKEN_ID` - Mux token ID for video streaming
- `MUX_TOKEN_SECRET` - Mux token secret
- `JWT_SECRET` - Strong JWT secret key (minimum 32 characters)
- `EMAIL_USER` - Gmail account for sending emails
- `EMAIL_PASSWORD` - Gmail app password

### 2. Configure Frontend Environment

Copy `frontend.env.example` to `.env.production` and update the values:

```bash
cp frontend.env.example ../frontend/.env.production
```

Required environment variables:
- `NEXT_PUBLIC_API_URL` - Your API URL (https://yourdomain.com/api)
- `NEXT_PUBLIC_FIREBASE_API_KEY` - Firebase web API key
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID` - Firebase project ID
- `NEXT_PUBLIC_RAZORPAY_KEY_ID` - Razorpay live key ID

### 3. Configure Nginx

Update `nginx.conf` with your domain name:
- Replace `yourdomain.com` with your actual domain
- Update SSL certificate paths
- Configure rate limits as needed

### 4. Configure SSL

Place your SSL certificates in the `ssl` directory:
- `ssl/cert.pem` - SSL certificate
- `ssl/key.pem` - SSL private key

For Let's Encrypt, you can use Certbot:
```bash
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

## Deployment Steps

### 1. Build and Deploy

```bash
# Navigate to the root directory
cd ..

# Build the application
bash scripts/build-production.sh

# Start the services
docker-compose -f docker-compose.prod.yml up -d
```

### 2. Verify Deployment

Check that all services are running:
```bash
# Check service status
docker-compose -f docker-compose.prod.yml ps

# Check logs
docker-compose -f docker-compose.prod.yml logs -f

# Test health endpoint
curl -f http://localhost/health
```

### 3. Database Setup

Initialize Firebase Firestore:
```bash
# Deploy Firestore rules and indexes
firebase deploy --only firestore:rules,firestore:indexes

# Set up backup configuration
firebase firestore:backups:create --project your-project-id
```

## Monitoring and Maintenance

### Health Checks

The application includes health check endpoints:
- `https://yourdomain.com/health` - Application health
- `https://yourdomain.com/api/health` - API health

### Logs

View logs for troubleshooting:
```bash
# All services
docker-compose -f docker-compose.prod.yml logs -f

# Specific service
docker-compose -f docker-compose.prod.yml logs -f backend
```

### Updates

To update the application:
```bash
# Pull latest code
git pull origin main

# Rebuild and restart
bash scripts/build-production.sh
docker-compose -f docker-compose.prod.yml up -d --build
```

## Security Considerations

1. **Environment Variables**: Never commit production environment variables to version control
2. **SSL/TLS**: Always use HTTPS in production
3. **Rate Limiting**: Configure appropriate rate limits in Nginx
4. **Firewall**: Configure firewall rules to only allow necessary ports
5. **Database Security**: Use Firebase security rules to protect data
6. **Monitoring**: Set up monitoring and alerting for production issues

## Troubleshooting

### Common Issues

1. **Port conflicts**: Ensure ports 80, 443, 5000, and 3000 are available
2. **SSL certificate issues**: Verify certificate paths and permissions
3. **Environment variables**: Double-check all required environment variables
4. **Docker permissions**: Ensure Docker daemon is running and accessible

### Support

For deployment issues:
1. Check the logs using `docker-compose logs`
2. Verify all environment variables are set correctly
3. Ensure all external services (Firebase, Razorpay, Mux) are configured
4. Test individual components before full deployment

## Performance Optimization

1. **CDN**: Consider using a CDN for static assets
2. **Caching**: Configure Redis caching for frequently accessed data
3. **Database**: Use Firebase indexes for optimal query performance
4. **Monitoring**: Set up application performance monitoring
5. **Scaling**: Use Docker Swarm or Kubernetes for auto-scaling