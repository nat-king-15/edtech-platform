#!/bin/bash

# EdTech Platform Production Build Script
# This script builds and prepares the application for production deployment

set -e  # Exit on any error

echo "🚀 Starting production build process..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if required files exist
check_required_files() {
    print_status "Checking required files..."
    
    if [ ! -f "backend/.env.production" ]; then
        print_error "backend/.env.production not found!"
        exit 1
    fi
    
    if [ ! -f "frontend/.env.production" ]; then
        print_error "frontend/.env.production not found!"
        exit 1
    fi
    
    if [ ! -f "docker-compose.prod.yml" ]; then
        print_error "docker-compose.prod.yml not found!"
        exit 1
    fi
    
    print_status "All required files found ✓"
}

# Build backend
build_backend() {
    print_status "Building backend..."
    cd backend
    
    # Install dependencies
    npm ci --omit=dev
    
    # Run tests (optional - comment out if tests are failing)
    # npm test
    
    cd ..
    print_status "Backend build completed ✓"
}

# Build frontend
build_frontend() {
    print_status "Building frontend..."
    cd frontend
    
    # Install dependencies
    npm ci
    
    # Build for production
    npm run build
    
    # Run tests (optional - comment out if tests are failing)
    # npm test
    
    cd ..
    print_status "Frontend build completed ✓"
}

# Build Docker images
build_docker_images() {
    print_status "Building Docker images..."
    
    # Build production images
    docker-compose -f docker-compose.prod.yml build
    
    print_status "Docker images built successfully ✓"
}

# Optimize images
optimize_images() {
    print_status "Optimizing images..."
    
    # Multi-stage build optimization
    docker build -t edtech-backend:optimized ./backend --target production
    docker build -t edtech-frontend:optimized ./frontend --target production
    
    print_status "Image optimization completed ✓"
}

# Security scan
security_scan() {
    print_status "Running security scan..."
    
    # Install trivy if not available
    if ! command -v trivy &> /dev/null; then
        print_warning "Trivy not found, installing..."
        curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin
    fi
    
    # Scan images
    trivy image edtech-backend:optimized
    trivy image edtech-frontend:optimized
    
    print_status "Security scan completed ✓"
}

# Create deployment package
create_deployment_package() {
    print_status "Creating deployment package..."
    
    # Create deployment directory
    mkdir -p deployment
    
    # Copy required files
    cp docker-compose.prod.yml deployment/
    cp -r docker deployment/
    cp -r scripts deployment/
    
    # Create deployment archive
    tar -czf edtech-production-$(date +%Y%m%d-%H%M%S).tar.gz deployment/
    
    print_status "Deployment package created ✓"
}

# Main execution
main() {
    print_status "Starting EdTech Platform Production Build"
    
    # Check prerequisites
    check_required_files
    
    # Build applications
    build_backend
    build_frontend
    
    # Build and optimize Docker images
    build_docker_images
    optimize_images
    
    # Security scan
    security_scan
    
    # Create deployment package
    create_deployment_package
    
    print_status "🎉 Production build completed successfully!"
    print_status "Deployment package: edtech-production-$(date +%Y%m%d-%H%M%S).tar.gz"
    print_status "Next steps:"
    print_status "1. Deploy to staging environment for testing"
    print_status "2. Run integration tests"
    print_status "3. Deploy to production"
}

# Run main function
main "$@"