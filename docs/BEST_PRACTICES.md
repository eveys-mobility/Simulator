# Eveys Charge Point Simulator - Best Practices Guide

## Table of Contents

1. [Development Best Practices](#development-best-practices)
2. [Testing Best Practices](#testing-best-practices)
3. [Configuration Best Practices](#configuration-best-practices)
4. [Security Best Practices](#security-best-practices)
5. [Performance Best Practices](#performance-best-practices)
6. [Deployment Best Practices](#deployment-best-practices)
7. [Maintenance Best Practices](#maintenance-best-practices)
8. [Integration Best Practices](#integration-best-practices)

## Development Best Practices

### 1. Environment Setup

**DO:**

- ✅ Use Node.js LTS versions (18.x or 20.x)
- ✅ Keep dependencies up to date
- ✅ Use environment variables for configuration
- ✅ Separate development and production configs
- ✅ Use version control (Git)

**DON'T:**

- ❌ Hardcode configuration values
- ❌ Commit `.env` files to version control
- ❌ Use outdated Node.js versions
- ❌ Mix development and production settings

**Example `.env` structure:**

```env
# Development
OCPP_SERVER_URL=ws://localhost:8180/steve/websocket/CentralSystemService
CHARGE_POINT_ID=DEV-CP-001
NODE_ENV=development

# Production (separate file: .env.production)
OCPP_SERVER_URL=wss://prod.charging.com:443/ocpp
CHARGE_POINT_ID=PROD-CP-001
NODE_ENV=production
```

### 2. Code Organization

**DO:**

- ✅ Follow the existing project structure
- ✅ Keep components focused and single-purpose
- ✅ Use TypeScript for type safety
- ✅ Write self-documenting code
- ✅ Add comments for complex logic

**DON'T:**

- ❌ Create god objects or classes
- ❌ Mix concerns in single files
- ❌ Ignore TypeScript errors
- ❌ Skip code documentation

**Example component structure:**

```typescript
// Good: Single responsibility
class AuthorizationManager {
  authorize(idTag: string): Promise<IdTagInfo> {
    // Clear, focused purpose
  }
}

// Bad: Multiple responsibilities
class Manager {
  authorize() { }
  startTransaction() { }
  sendMeterValues() { }
  // Too many unrelated responsibilities
}
```

### 3. Error Handling

**DO:**

- ✅ Use try-catch blocks for async operations
- ✅ Log errors with context
- ✅ Provide meaningful error messages
- ✅ Handle edge cases
- ✅ Implement retry logic where appropriate

**DON'T:**

- ❌ Swallow errors silently
- ❌ Use generic error messages
- ❌ Ignore error scenarios
- ❌ Crash on recoverable errors

**Example:**

```typescript
// Good
try {
  const response = await this.chargePoint.sendStartTransaction(
    connectorId,
    idTag,
    meterValue
  );
  
  if (response.idTagInfo.status !== 'Accepted') {
    throw new Error(`Transaction rejected: ${response.idTagInfo.status}`);
  }
} catch (error) {
  console.error(`[TransactionManager] Failed to start transaction:`, {
    connectorId,
    idTag,
    error: error.message
  });
  throw error; // Re-throw for caller to handle
}

// Bad
try {
  await this.chargePoint.sendStartTransaction(connectorId, idTag, meterValue);
} catch (error) {
  // Silent failure - bad!
}
```

### 4. Logging

**DO:**

- ✅ Use consistent log prefixes
- ✅ Include relevant context
- ✅ Log at appropriate levels
- ✅ Log important state changes
- ✅ Include timestamps

**DON'T:**

- ❌ Log sensitive data (passwords, tokens)
- ❌ Over-log in production
- ❌ Use console.log in production code
- ❌ Log without context

**Example:**

```typescript
// Good
console.log(`[TransactionManager] Starting transaction`, {
  connectorId,
  idTag: idTag.substring(0, 4) + '***', // Mask sensitive data
  transactionId
});

// Bad
console.log('Starting'); // No context
console.log(idTag); // Sensitive data exposed
```

## Testing Best Practices

### 1. Test Strategy

**DO:**

- ✅ Test critical paths first
- ✅ Test edge cases and error scenarios
- ✅ Use the simulator for integration testing
- ✅ Automate repetitive tests
- ✅ Document test scenarios

**DON'T:**

- ❌ Test only happy paths
- ❌ Skip error scenario testing
- ❌ Rely solely on manual testing
- ❌ Test in production

**Test Priority:**

1. **Critical:** Authorization, transaction start/stop
2. **High:** Meter values, configuration changes
3. **Medium:** Scenarios, remote commands
4. **Low:** UI elements, cosmetic features

### 2. Testing Workflow

**Recommended Sequence:**

```
1. Basic Connectivity
   - Connect to OCPP server
   - Verify BootNotification
   - Check Heartbeat

2. Authorization
   - Test with known tags
   - Test with unknown tags
   - Test offline behavior
   - Test concurrent prevention

3. Transactions
   - Start transaction
   - Monitor meter values
   - Pause/resume
   - Stop transaction

4. Configuration
   - Read configuration
   - Update configuration
   - Verify changes applied

5. Scenarios
   - Test each scenario
   - Verify OCPP messages
   - Check state transitions

6. Edge Cases
   - Network disconnection
   - Invalid inputs
   - Concurrent operations
   - Resource limits
```

### 3. Load Testing

**DO:**

- ✅ Start with single simulator
- ✅ Gradually increase load
- ✅ Monitor system resources
- ✅ Test realistic scenarios
- ✅ Document results

**Example Load Test:**

```bash
# Run 10 simulators
for i in {1..10}; do
  CHARGE_POINT_ID=CP-$i npm run dev &
done

# Monitor performance
top
netstat -an | grep ESTABLISHED | wc -l
```

### 4. Regression Testing

**DO:**

- ✅ Test after each change
- ✅ Maintain test checklist
- ✅ Verify existing functionality
- ✅ Document test results

**Test Checklist:**

- [ ] Connection to OCPP server
- [ ] Authorization with default tags
- [ ] Start transaction
- [ ] Meter value reporting
- [ ] Stop transaction
- [ ] Configuration changes
- [ ] Scenario execution
- [ ] WebSocket updates

## Configuration Best Practices

### 1. Configuration Management

**DO:**

- ✅ Start with default values
- ✅ Change one setting at a time
- ✅ Document configuration changes
- ✅ Test configuration impact
- ✅ Backup working configurations

**DON'T:**

- ❌ Change multiple settings simultaneously
- ❌ Use untested configurations in production
- ❌ Ignore configuration validation errors
- ❌ Forget to document changes

### 2. Key Configuration Settings

**Critical Settings:**

```env
# Connection
OCPP_SERVER_URL=ws://your-server.com:port/path
CHARGE_POINT_ID=unique-identifier

# Timing (adjust based on needs)
HEARTBEAT_INTERVAL=60          # Seconds
METER_VALUE_INTERVAL=60        # Seconds

# Authorization
LocalAuthListEnabled=true
AuthorizationCacheEnabled=true
AllowOfflineTxForUnknownId=false

# Transaction
TransactionMessageAttempts=3
TransactionMessageRetryInterval=20
```

**Performance Tuning:**

```
# High-frequency testing
MeterValueSampleInterval=5     # 5 seconds
HeartbeatInterval=30           # 30 seconds

# Production
MeterValueSampleInterval=60    # 1 minute
HeartbeatInterval=300          # 5 minutes

# Load testing
MeterValueSampleInterval=300   # 5 minutes
HeartbeatInterval=600          # 10 minutes
```

### 3. Configuration Validation

**DO:**

- ✅ Validate before applying
- ✅ Check value ranges
- ✅ Verify data types
- ✅ Test configuration impact

**Example Validation:**

```typescript
// Good
if (interval < 5 || interval > 3600) {
  throw new Error('MeterValueSampleInterval must be between 5 and 3600 seconds');
}

// Bad
// No validation - could cause issues
this.interval = interval;
```

## Security Best Practices

### 1. Network Security

**DO:**

- ✅ Use WSS (WebSocket Secure) in production
- ✅ Validate SSL certificates
- ✅ Use firewall rules
- ✅ Limit network exposure
- ✅ Monitor connections

**DON'T:**

- ❌ Use WS (unencrypted) in production
- ❌ Disable SSL verification
- ❌ Expose unnecessary ports
- ❌ Allow unrestricted access

**Example:**

```env
# Development
OCPP_SERVER_URL=ws://localhost:8180/ocpp

# Production
OCPP_SERVER_URL=wss://charging.example.com:443/ocpp
```

### 2. Data Security

**DO:**

- ✅ Mask sensitive data in logs
- ✅ Secure configuration files
- ✅ Use environment variables for secrets
- ✅ Implement access controls
- ✅ Regular security audits

**DON'T:**

- ❌ Log full ID tags or credentials
- ❌ Commit secrets to version control
- ❌ Store passwords in plain text
- ❌ Share sensitive data

### 3. Authorization Security

**DO:**

- ✅ Use strong ID tag formats
- ✅ Implement tag expiry
- ✅ Enable concurrent transaction prevention
- ✅ Monitor authorization attempts
- ✅ Use local authorization list

**Example:**

```typescript
// Good: Masked logging
console.log(`Authorization for tag: ${idTag.substring(0, 4)}***`);

// Bad: Full tag exposed
console.log(`Authorization for tag: ${idTag}`);
```

## Performance Best Practices

### 1. Resource Optimization

**DO:**

- ✅ Monitor memory usage
- ✅ Limit log file sizes
- ✅ Clean up old data
- ✅ Use efficient data structures
- ✅ Optimize database queries

**DON'T:**

- ❌ Keep unlimited history
- ❌ Log excessively
- ❌ Ignore memory leaks
- ❌ Use inefficient algorithms

**Example:**

```typescript
// Good: Circular buffer for history
if (this.transactions.length > MAX_HISTORY) {
  this.transactions.shift(); // Remove oldest
}

// Bad: Unlimited growth
this.transactions.push(transaction); // Memory leak!
```

### 2. Network Optimization

**DO:**

- ✅ Use appropriate intervals
- ✅ Batch operations when possible
- ✅ Implement connection pooling
- ✅ Handle network errors gracefully
- ✅ Use compression if available

**Interval Guidelines:**

```
Development/Testing:
- Heartbeat: 30-60 seconds
- Meter Values: 5-30 seconds

Production:
- Heartbeat: 300-600 seconds
- Meter Values: 60-300 seconds

Load Testing:
- Heartbeat: 600+ seconds
- Meter Values: 300+ seconds
```

### 3. Caching Strategy

**DO:**

- ✅ Use authorization cache
- ✅ Set appropriate TTL
- ✅ Monitor cache hit rates
- ✅ Clear cache when needed
- ✅ Limit cache size

**Configuration:**

```typescript
// Recommended cache settings
{
  maxEntries: 100,           // LRU eviction
  ttl: 24 * 60 * 60 * 1000, // 24 hours
  cleanupInterval: 60 * 60 * 1000 // 1 hour
}
```

## Deployment Best Practices

### 1. Production Deployment

**DO:**

- ✅ Use production builds
- ✅ Set NODE_ENV=production
- ✅ Use process managers (PM2, systemd)
- ✅ Implement monitoring
- ✅ Set up logging
- ✅ Plan for scaling

**DON'T:**

- ❌ Run development builds in production
- ❌ Use `npm run dev` in production
- ❌ Skip monitoring setup
- ❌ Ignore error logs

**Example PM2 Configuration:**

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'eveys-cps',
    script: 'dist/server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    }
  }]
};
```

### 2. Monitoring

**DO:**

- ✅ Monitor uptime
- ✅ Track error rates
- ✅ Monitor resource usage
- ✅ Set up alerts
- ✅ Log important events

**Key Metrics:**

- Connection status
- Transaction success rate
- Authorization cache hit rate
- Memory usage
- CPU usage
- Network throughput

### 3. Backup and Recovery

**DO:**

- ✅ Backup configuration files
- ✅ Backup transaction history
- ✅ Document recovery procedures
- ✅ Test recovery process
- ✅ Automate backups

**Backup Strategy:**

```bash
# Daily backup script
#!/bin/bash
DATE=$(date +%Y%m%d)
BACKUP_DIR="/backups/eveys-cps/$DATE"

mkdir -p $BACKUP_DIR
cp -r backend/data/* $BACKUP_DIR/
cp backend/.env $BACKUP_DIR/

# Keep last 30 days
find /backups/eveys-cps -type d -mtime +30 -exec rm -rf {} \;
```

## Maintenance Best Practices

### 1. Regular Maintenance

**DO:**

- ✅ Update dependencies regularly
- ✅ Review and clean logs
- ✅ Monitor disk space
- ✅ Check for updates
- ✅ Review configuration

**Maintenance Schedule:**

- **Daily:** Check logs, monitor status
- **Weekly:** Review metrics, check disk space
- **Monthly:** Update dependencies, backup data
- **Quarterly:** Security audit, performance review

### 2. Troubleshooting

**DO:**

- ✅ Check logs first
- ✅ Verify configuration
- ✅ Test connectivity
- ✅ Isolate issues
- ✅ Document solutions

**Troubleshooting Checklist:**

1. Check backend logs
2. Check frontend console
3. Verify OCPP server status
4. Test network connectivity
5. Review recent changes
6. Check resource usage
7. Verify configuration
8. Test with minimal config

### 3. Documentation

**DO:**

- ✅ Document configuration changes
- ✅ Keep runbooks updated
- ✅ Document known issues
- ✅ Maintain change log
- ✅ Document custom modifications

## Integration Best Practices

### 1. API Integration

**DO:**

- ✅ Use RESTful endpoints
- ✅ Handle errors gracefully
- ✅ Implement retry logic
- ✅ Validate responses
- ✅ Use timeouts

**Example:**

```typescript
// Good: Robust API call
async function startCharging(connectorId: number, idTag: string) {
  try {
    const response = await fetch('http://localhost:3001/api/start-charging', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectorId, idTag }),
      timeout: 5000
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Failed to start charging:', error);
    throw error;
  }
}
```

### 2. WebSocket Integration

**DO:**

- ✅ Handle connection events
- ✅ Implement reconnection logic
- ✅ Parse messages safely
- ✅ Handle message types
- ✅ Clean up on disconnect

**Example:**

```typescript
// Good: Robust WebSocket handling
const ws = new WebSocket('ws://localhost:3001/ws');

ws.onopen = () => {
  console.log('Connected');
  reconnectAttempts = 0;
};

ws.onclose = () => {
  console.log('Disconnected');
  scheduleReconnect();
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onmessage = (event) => {
  try {
    const message = JSON.parse(event.data);
    handleMessage(message);
  } catch (error) {
    console.error('Failed to parse message:', error);
  }
};
```

### 3. Third-Party Integration

**DO:**

- ✅ Validate external data
- ✅ Use API versioning
- ✅ Implement rate limiting
- ✅ Handle API changes
- ✅ Monitor integration health

## Summary

Following these best practices will help you:

- **Develop** more reliable and maintainable code
- **Test** more effectively and comprehensively
- **Configure** for optimal performance
- **Secure** your deployment
- **Optimize** resource usage
- **Deploy** with confidence
- **Maintain** long-term stability
- **Integrate** successfully with other systems

Remember: **Best practices evolve**. Stay updated with the latest recommendations and adapt these guidelines to your specific needs.

---

*Eveys - Powering the future of electric mobility*
