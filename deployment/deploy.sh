#!/bin/bash

# Production Deployment Script for EdTech Platform
# This script handles the complete deployment process

set -euo pipefail

# Configuration
DEPLOYMENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="/opt/backups/edtech"
LOG_FILE="/var/log/edtech-deployment.log"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE"
    exit 1
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1" | tee -a "$LOG_FILE"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1" | tee -a "$LOG_FILE"
}

# Check if running as root
check_permissions() {
    if [[ $EUID -eq 0 ]]; then
        error "This script should not be run as root for security reasons"
    fi
}

# Validate environment
validate_environment() {
    log "Validating deployment environment..."
    
    # Check required tools
    for tool in docker docker-compose nginx openssl; do
        if ! command -v "$tool" &> /dev/null; then
            error "Required tool '$tool' is not installed"
        fi
    done
    
    # Check disk space (minimum 5GB)
    available_space=$(df "$DEPLOYMENT_DIR" | awk 'NR==2 {print $4}')
    if [[ $available_space -lt 5242880 ]]; then
        error "Insufficient disk space. At least 5GB required"
    fi
    
    # Check memory (minimum 2GB)
    total_memory=$(free -m | awk 'NR==2{print $2}')
    if [[ $total_memory -lt 2048 ]]; then
        warning "Low memory detected. Recommended: 2GB+, Available: ${total_memory}MB"
    fi
    
    success "Environment validation passed"
}

# Create backup
create_backup() {
    log "Creating backup..."
    
    mkdir -p "$BACKUP_DIR"
    
    # Backup database (if using external database)
    # This would need to be customized based on your database setup
    
    # Backup current deployment
    if [[ -d "/opt/edtech" ]]; then
        tar -czf "$BACKUP_DIR/edtech_backup_$TIMESTAMP.tar.gz" -C /opt edtech
        success "Backup created: $BACKUP_DIR/edtech_backup_$TIMESTAMP.tar.gz"
    else
        warning "No existing deployment found, skipping backup"
    fi
}

# Generate SSL certificates
generate_ssl_certificates() {
    log "Generating SSL certificates..."
    
    local ssl_dir="$DEPLOYMENT_DIR/ssl"
    mkdir -p "$ssl_dir"
    
    if [[ ! -f "$ssl_dir/cert.pem" || ! -f "$ssl_dir/key.pem" ]]; then
        # Generate self-signed certificate for development/testing
        # In production, use proper certificates from Let's Encrypt or other CA
        openssl req -x509 -newkey rsa:4096 -keyout "$ssl_dir/key.pem" -out "$ssl_dir/cert.pem" \
            -days 365 -nodes -subj "/C=US/ST=State/L=City/O=EdTech/CN=localhost"
        
        success "SSL certificates generated"
        warning "Using self-signed certificates. Replace with proper certificates in production"
    else
        success "SSL certificates already exist"
    fi
}

# Build Docker images
build_images() {
    log "Building Docker images..."
    
    cd "$DEPLOYMENT_DIR"
    
    # Build backend image
    docker build -t edtech-backend:latest ./backend
    
    # Build frontend image
    docker build -t edtech-frontend:latest ./frontend
    
    success "Docker images built successfully"
}

# Run security scans
security_scan() {
    log "Running security scans..."
    
    # Install Trivy if not available
    if ! command -v trivy &> /dev/null; then
        log "Installing Trivy security scanner..."
        curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin
    fi
    
    # Scan images
    trivy image --severity HIGH,CRITICAL edtech-backend:latest
    trivy image --severity HIGH,CRITICAL edtech-frontend:latest
    
    success "Security scans completed"
}

# Deploy services
deploy_services() {
    log "Deploying services..."
    
    cd "$DEPLOYMENT_DIR"
    
    # Stop existing services
    docker-compose -f docker-compose.prod.yml down --remove-orphans
    
    # Remove old images
    docker system prune -f
    
    # Start services
    docker-compose -f docker-compose.prod.yml up -d
    
    success "Services deployed successfully"
}

# Configure Nginx
configure_nginx() {
    log "Configuring Nginx..."
    
    # Copy Nginx configuration
    sudo cp "$DEPLOYMENT_DIR/nginx.conf" /etc/nginx/sites-available/edtech
    
    # Enable site
    sudo ln -sf /etc/nginx/sites-available/edtech /etc/nginx/sites-enabled/
    
    # Test configuration
    sudo nginx -t
    
    # Reload Nginx
    sudo systemctl reload nginx
    
    success "Nginx configured successfully"
}

# Health checks
health_checks() {
    log "Running health checks..."
    
    # Wait for services to start
    sleep 30
    
    # Check backend health
    if ! curl -f -k https://localhost/health &> /dev/null; then
        error "Backend health check failed"
    fi
    
    # Check frontend
    if ! curl -f -k https://localhost &> /dev/null; then
        error "Frontend health check failed"
    fi
    
    # Check API endpoints
    if ! curl -f -k https://localhost/api/batches/published &> /dev/null; then
        error "API health check failed"
    fi
    
    success "All health checks passed"
}

# Performance optimization
optimize_performance() {
    log "Applying performance optimizations..."
    
    # Optimize Docker containers
    echo 'vm.max_map_count=262144' | sudo tee -a /etc/sysctl.conf
    echo 'fs.file-max=65536' | sudo tee -a /etc/sysctl.conf
    sudo sysctl -p
    
    # Optimize Nginx worker processes
    sudo sed -i 's/worker_processes.*/worker_processes auto;/' /etc/nginx/nginx.conf
    sudo sed -i 's/worker_connections.*/worker_connections 1024;/' /etc/nginx/nginx.conf
    
    # Restart services
    sudo systemctl restart nginx
    
    success "Performance optimizations applied"
}

# Setup monitoring
setup_monitoring() {
    log "Setting up monitoring..."
    
    # Create monitoring script
    cat > "$DEPLOYMENT_DIR/scripts/monitor.sh" << 'EOF'
#!/bin/bash
# Monitoring script for EdTech Platform

HEALTH_ENDPOINT="https://localhost/health"
LOG_FILE="/var/log/edtech-monitor.log"
ALERT_EMAIL="admin@edtech.com"

check_health() {
    if ! curl -f -k "$HEALTH_ENDPOINT" &> /dev/null; then
        echo "$(date): Health check failed" >> "$LOG_FILE"
        # Send alert (configure mail server)
        # echo "Health check failed on $(hostname)" | mail -s "EdTech Alert" "$ALERT_EMAIL"
        return 1
    fi
    return 0
}

# Check container status
if ! docker ps | grep -q "edtech-backend"; then
    echo "$(date): Backend container not running" >> "$LOG_FILE"
    return 1
fi

if ! docker ps | grep -q "edtech-frontend"; then
    echo "$(date): Frontend container not running" >> "$LOG_FILE"
    return 1
fi

# Check disk space
DISK_USAGE=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')
if [[ $DISK_USAGE -gt 80 ]]; then
    echo "$(date): High disk usage: ${DISK_USAGE}%" >> "$LOG_FILE"
fi

# Check memory usage
MEMORY_USAGE=$(free | awk 'NR==2{printf "%.0f", $3/$2*100}')
if [[ $MEMORY_USAGE -gt 80 ]]; then
    echo "$(date): High memory usage: ${MEMORY_USAGE}%" >> "$LOG_FILE"
fi

exit 0
EOF
    
    chmod +x "$DEPLOYMENT_DIR/scripts/monitor.sh"
    
    # Add to crontab
    (crontab -l 2>/dev/null; echo "*/5 * * * * $DEPLOYMENT_DIR/scripts/monitor.sh") | crontab -
    
    success "Monitoring setup completed"
}

# Cleanup
cleanup() {
    log "Cleaning up..."
    
    # Remove old Docker images
    docker system prune -f
    
    # Clean up old backups (keep last 5)
    if [[ -d "$BACKUP_DIR" ]]; then
        ls -t "$BACKUP_DIR"/*.tar.gz 2>/dev/null | tail -n +6 | xargs -r rm
    fi
    
    success "Cleanup completed"
}

# Main deployment function
main() {
    log "Starting EdTech Platform deployment..."
    
    check_permissions
    validate_environment
    create_backup
    generate_ssl_certificates
    build_images
    security_scan
    deploy_services
    configure_nginx
    health_checks
    optimize_performance
    setup_monitoring
    cleanup
    
    success "Deployment completed successfully!"
    log "Access your application at: https://your-domain.com"
    log "API endpoint: https://your-domain.com/api"
    log "Health check: https://your-domain.com/health"
    
    # Display service status
    docker-compose -f docker-compose.prod.yml ps
}

# Handle script interruption
trap 'error "Deployment interrupted"' INT TERM

# Run main function
main "$@"