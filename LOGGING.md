# Logging System

This backend uses Winston for console logging with multiple log levels and specialized logging methods.

## Features

- **Multiple Log Levels**: error, warn, info, http, debug
- **Console Transport**: Colored console output with structured metadata
- **Specialized Loggers**: Auth, AI, Security, Performance logging
- **Request Logging**: Detailed HTTP request/response logging

## Configuration

Set the log level using the `LOG_LEVEL` environment variable:

```bash
LOG_LEVEL=debug  # Most verbose
LOG_LEVEL=info   # Default
LOG_LEVEL=warn   # Warnings and errors only
LOG_LEVEL=error  # Errors only
```

## Usage

### Basic Logging

```javascript
const logger = require('./config/logger');

// Basic logging
logger.info('Server started');
logger.error('Database connection failed');
logger.warn('High memory usage detected');

// With metadata
logger.info('User action', {
  userId: '123',
  action: 'login',
  ip: '192.168.1.1'
});
```

### Specialized Logging

```javascript
// Authentication logging
logger.logAuth('login', userId, true, { ip: req.ip });

// AI service logging
logger.logAI('openai', 'email_generation', userId, {
  inputTokens: 100,
  outputTokens: 50
});

// Security event logging
logger.logSecurity('rate_limit_exceeded', { ip: req.ip });

// Performance logging
logger.logPerformance('database_query', 150, { table: 'users' });

// Error logging with context
logger.logError(error, {
  userId: req.user?.uid,
  endpoint: req.originalUrl
});
```

## Log Formats

### Console Output
```
2024-01-15 10:30:45 [INFO]: Server started successfully
  {
    "port": 3000,
    "environment": "development"
  }
```

## Monitoring and Alerts

Consider setting up log monitoring for:

- **Error Rates**: Monitor console output for error spikes
- **Authentication Failures**: Watch for failed login attempts
- **Performance Issues**: Track slow operations
- **Security Events**: Monitor rate limiting and suspicious activity

## Best Practices

1. **Use Appropriate Log Levels**:
   - `error`: System errors that need immediate attention
   - `warn`: Warning conditions that should be monitored
   - `info`: General application flow information
   - `debug`: Detailed debugging information

2. **Include Context**: Always include relevant metadata like userId, IP, request ID

3. **Avoid Logging Sensitive Data**: Never log passwords, tokens, or personal information

4. **Use Structured Logging**: Include metadata as objects for better parsing

5. **Monitor Log Volume**: Be mindful of log size and rotation settings

## Environment-Specific Settings

### Development
```bash
LOG_LEVEL=debug
```

### Production
```bash
LOG_LEVEL=info
```

### Testing
```bash
LOG_LEVEL=error
```

## Integration with Monitoring Services

The console logs can be easily integrated with monitoring services by:

- **Process Managers**: Use PM2, Docker, or systemd to capture stdout/stderr
- **Log Aggregators**: Configure log forwarding from your deployment environment
- **Cloud Services**: Use platform-specific logging services (AWS CloudWatch, Google Cloud Logging, etc.)
- **Container Orchestration**: Kubernetes and Docker provide built-in log aggregation

For production deployments, consider using a process manager or container orchestration that can capture and forward console output to your preferred monitoring solution.
