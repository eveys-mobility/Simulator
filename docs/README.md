# Eveys Charge Point Simulator - Documentation

Welcome to the comprehensive documentation for **Eveys Charge Point Simulator (Eveys CPS)**, a professional-grade OCPP 1.6J charge point simulator designed for testing, development, and validation of electric vehicle charging infrastructure.

## 📚 Documentation Index

### Getting Started

1. **[Product Introduction](PRODUCT_INTRODUCTION.md)**
   - What is Eveys CPS and why use it
   - Key features and capabilities
   - Use cases and benefits
   - Comparison with alternatives
   - Success stories

2. **[Installation Guide](INSTALLATION.md)**
   - System requirements
   - Step-by-step installation
   - Configuration setup
   - Verification procedures
   - Troubleshooting installation issues

3. **[Quick Start Guide](../README.md#quick-start)**
   - 5-minute setup
   - First connection
   - Starting your first charging session
   - Basic operations

### User Documentation

4. **[User Guide](USER_GUIDE.md)**
   - Complete user manual
   - User interface walkthrough
   - Basic and advanced operations
   - Authorization management
   - Configuration management
   - Scenario testing
   - Troubleshooting

5. **[Feature Documentation](../FEATURES.md)**
   - Detailed feature descriptions
   - Authorization system
   - Configuration management
   - Transaction management
   - Performance characteristics
   - Compliance information

### Technical Documentation

6. **[Architecture Documentation](ARCHITECTURE.md)**
   - System architecture overview
   - Component descriptions
   - Data flow diagrams
   - OCPP communication details
   - Authorization flow
   - Transaction lifecycle
   - How it works

7. **[API Reference](API_REFERENCE.md)** *(Coming Soon)*
   - REST API endpoints
   - WebSocket events
   - Request/response formats
   - Authentication
   - Error codes

8. **[Configuration Guide](CONFIGURATION.md)** *(Coming Soon)*
   - All 90+ configuration keys
   - Configuration categories
   - Best practices
   - Examples and use cases

### Best Practices & Guidelines

9. **[Best Practices Guide](BEST_PRACTICES.md)**
   - Development best practices
   - Testing strategies
   - Configuration management
   - Security guidelines
   - Performance optimization
   - Deployment procedures
   - Maintenance recommendations

10. **[Troubleshooting Guide](TROUBLESHOOTING.md)** *(Coming Soon)*
    - Common issues and solutions
    - Debugging techniques
    - Log analysis
    - Performance issues
    - Network problems

### Additional Resources

11. **[FAQ](FAQ.md)** *(Coming Soon)*
    - Frequently asked questions
    - Quick answers
    - Common scenarios

12. **[Contributing Guide](../CONTRIBUTING.md)** *(Coming Soon)*
    - How to contribute
    - Code standards
    - Pull request process
    - Development setup

## 🚀 Production Deployment

### Production Overview

Eveys CPS is designed to be deployed in various environments, from development testing to production load testing. This section covers production deployment considerations.

### Production Requirements

**Minimum Production Specifications:**

- **Server:** 2 CPU cores, 2GB RAM, 10GB storage
- **OS:** Ubuntu 20.04 LTS or later, CentOS 8+, or similar
- **Node.js:** 18.x LTS or 20.x LTS
- **Network:** Stable connection to OCPP central system
- **SSL/TLS:** Required for secure WebSocket (WSS)

**Recommended Production Specifications:**

- **Server:** 4 CPU cores, 4GB RAM, 20GB storage
- **OS:** Latest LTS version
- **Node.js:** Latest LTS version (20.x)
- **Network:** Redundant network connections
- **Monitoring:** Application and infrastructure monitoring
- **Backup:** Automated backup solution

### Production Deployment Steps

1. **Server Preparation**

   ```bash
   # Update system
   sudo apt update && sudo apt upgrade -y
   
   # Install Node.js (using NodeSource)
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt install -y nodejs
   
   # Install PM2 for process management
   sudo npm install -g pm2
   ```

2. **Application Setup**

   ```bash
   # Clone repository
   git clone https://github.com/eveys/charge-point-simulator.git
   cd charge-point-simulator
   
   # Install dependencies
   cd backend && npm ci --production
   cd ../frontend && npm ci --production
   
   # Build applications
   cd ../backend && npm run build
   cd ../frontend && npm run build
   ```

3. **Configuration**

   ```bash
   # Create production environment file
   cd backend
   cp .env.example .env.production
   
   # Edit with production values
   nano .env.production
   ```

   **Production `.env.production` example:**

   ```env
   # OCPP Central System (use WSS for production)
   OCPP_SERVER_URL=wss://charging.production.com:443/ocpp
   CHARGE_POINT_ID=EVEYS-PROD-CP-001
   
   # Production settings
   NODE_ENV=production
   MAX_POWER_KW=22
   CONNECTOR_TYPE=Type2
   VOLTAGE=400
   MAX_CURRENT=32
   
   # API Configuration
   API_PORT=3001
   FRONTEND_URL=https://simulator.production.com
   
   # Optimized intervals for production
   METER_VALUE_INTERVAL=300    # 5 minutes
   HEARTBEAT_INTERVAL=600      # 10 minutes
   ```

4. **Process Management with PM2**

   ```bash
   # Create PM2 ecosystem file
   cat > ecosystem.config.js << 'EOF'
   module.exports = {
     apps: [
       {
         name: 'eveys-cps-backend',
         script: './dist/server.js',
         cwd: './backend',
         instances: 1,
         autorestart: true,
         watch: false,
         max_memory_restart: '1G',
         env_production: {
           NODE_ENV: 'production'
         },
         error_file: './logs/err.log',
         out_file: './logs/out.log',
         log_file: './logs/combined.log',
         time: true
       }
     ]
   };
   EOF
   
   # Start with PM2
   pm2 start ecosystem.config.js --env production
   
   # Save PM2 configuration
   pm2 save
   
   # Setup PM2 to start on system boot
   pm2 startup
   ```

5. **Frontend Deployment**

   **Option A: Using Nginx**

   ```nginx
   # /etc/nginx/sites-available/eveys-cps
   server {
       listen 80;
       server_name simulator.production.com;
       
       # Redirect to HTTPS
       return 301 https://$server_name$request_uri;
   }
   
   server {
       listen 443 ssl http2;
       server_name simulator.production.com;
       
       ssl_certificate /path/to/cert.pem;
       ssl_certificate_key /path/to/key.pem;
       
       root /path/to/charge-point-simulator/frontend/dist;
       index index.html;
       
       location / {
           try_files $uri $uri/ /index.html;
       }
       
       # Proxy API requests to backend
       location /api {
           proxy_pass http://localhost:3001;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
       
       # WebSocket support
       location /ws {
           proxy_pass http://localhost:3001;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "Upgrade";
           proxy_set_header Host $host;
       }
   }
   ```

   **Option B: Using serve package**

   ```bash
   npm install -g serve
   serve -s frontend/dist -p 5173
   ```

6. **Security Hardening**

   ```bash
   # Configure firewall
   sudo ufw allow 22/tcp    # SSH
   sudo ufw allow 80/tcp    # HTTP
   sudo ufw allow 443/tcp   # HTTPS
   sudo ufw enable
   
   # Secure file permissions
   chmod 600 backend/.env.production
   chmod 700 backend/data
   
   # Create dedicated user (optional but recommended)
   sudo useradd -r -s /bin/false eveys-cps
   sudo chown -R eveys-cps:eveys-cps /path/to/charge-point-simulator
   ```

7. **Monitoring Setup**

   ```bash
   # PM2 monitoring
   pm2 install pm2-logrotate
   pm2 set pm2-logrotate:max_size 10M
   pm2 set pm2-logrotate:retain 30
   
   # View logs
   pm2 logs eveys-cps-backend
   
   # Monitor resources
   pm2 monit
   ```

8. **Backup Configuration**

   ```bash
   # Create backup script
   cat > /usr/local/bin/backup-eveys-cps.sh << 'EOF'
   #!/bin/bash
   DATE=$(date +%Y%m%d_%H%M%S)
   BACKUP_DIR="/backups/eveys-cps"
   APP_DIR="/path/to/charge-point-simulator"
   
   mkdir -p $BACKUP_DIR
   
   # Backup data directory
   tar -czf $BACKUP_DIR/data_$DATE.tar.gz -C $APP_DIR/backend data/
   
   # Backup configuration
   cp $APP_DIR/backend/.env.production $BACKUP_DIR/env_$DATE.backup
   
   # Keep only last 30 days
   find $BACKUP_DIR -type f -mtime +30 -delete
   
   echo "Backup completed: $DATE"
   EOF
   
   chmod +x /usr/local/bin/backup-eveys-cps.sh
   
   # Add to crontab (daily at 2 AM)
   (crontab -l 2>/dev/null; echo "0 2 * * * /usr/local/bin/backup-eveys-cps.sh") | crontab -
   ```

### Production Monitoring

**Key Metrics to Monitor:**

- **Application Health:** Uptime, response times, error rates
- **OCPP Connection:** Connection status, message success rate
- **System Resources:** CPU, memory, disk usage, network
- **Transaction Metrics:** Success rate, authorization cache hit rate
- **Performance:** Message latency, throughput

**Recommended Monitoring Tools:**

- **PM2 Plus:** Application monitoring
- **Prometheus + Grafana:** Metrics and visualization
- **ELK Stack:** Log aggregation and analysis
- **Uptime Kuma:** Uptime monitoring
- **New Relic / DataDog:** APM solutions

### Production Maintenance

**Daily Tasks:**

- Check application logs for errors
- Verify OCPP connection status
- Monitor system resources

**Weekly Tasks:**

- Review performance metrics
- Check disk space
- Verify backups completed

**Monthly Tasks:**

- Update dependencies (security patches)
- Review and optimize configuration
- Test backup restoration
- Performance tuning

**Quarterly Tasks:**

- Major version updates
- Security audit
- Capacity planning
- Documentation updates

### Scaling for Production

**Single Instance:**

- Suitable for: 1-10 charge points
- Resources: 2 CPU, 2GB RAM
- Cost: Minimal

**Multiple Instances:**

- Suitable for: 10-100 charge points
- Deploy multiple simulators with different IDs
- Use container orchestration (Docker, Kubernetes)
- Load balancer for frontend

**High Availability:**

- Redundant servers
- Database for shared state
- Load balancing
- Automatic failover

### Production Checklist

Before going to production, ensure:

- [ ] Production environment configured
- [ ] SSL/TLS certificates installed
- [ ] Firewall rules configured
- [ ] PM2 process manager setup
- [ ] Monitoring configured
- [ ] Backup system in place
- [ ] Log rotation configured
- [ ] Security hardening completed
- [ ] Documentation updated
- [ ] Team trained
- [ ] Disaster recovery plan documented
- [ ] Performance baseline established

## 📞 Support

### Community Support

- **GitHub Issues:** [Report bugs and request features](https://github.com/eveys/charge-point-simulator/issues)
- **Discussions:** [Ask questions and share ideas](https://github.com/eveys/charge-point-simulator/discussions)
- **Wiki:** [Additional documentation](https://github.com/eveys/charge-point-simulator/wiki)

### Professional Support

For enterprise support, custom development, or consulting:

- **Email:** <support@eveys.com>
- **Website:** <https://eveys.com>
- **Documentation:** <https://docs.eveys.com>

### Training

Eveys offers professional training for:

- OCPP protocol fundamentals
- Eveys CPS advanced usage
- Custom integration development
- Best practices and optimization

Contact: <training@eveys.com>

## 📄 License

Eveys Charge Point Simulator is released under the MIT License. See [LICENSE](../LICENSE) file for details.

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](../CONTRIBUTING.md) for details on:

- Code of conduct
- Development process
- Submitting pull requests
- Coding standards

## 🔄 Version History

See [CHANGELOG.md](../CHANGELOG.md) for version history and release notes.

## 🌟 About Eveys

**Eveys** is committed to advancing electric vehicle charging infrastructure through innovative software solutions. Our mission is to accelerate the transition to sustainable transportation.

**Products:**

- Eveys Charge Point Simulator
- Eveys Central System
- Eveys Fleet Management Platform
- Eveys Analytics & Reporting

**Vision:** Powering the future of electric mobility

---

**Need help?** Start with the [User Guide](USER_GUIDE.md) or check the [Troubleshooting Guide](TROUBLESHOOTING.md)

**Ready to deploy?** Follow the [Production Deployment](#production-deployment) section above

**Want to contribute?** See the [Contributing Guide](../CONTRIBUTING.md)

---

*Eveys - Powering the future of electric mobility*

*Last Updated: December 2025*
