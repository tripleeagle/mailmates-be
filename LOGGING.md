# Logging System

This backend uses Winston for comprehensive logging with multiple transports and log levels...

## Features

- **Multiple Log Levels**: error, warn, info, http, debug
- **Multiple Transports**: Console, File (rotated daily)
- **Structured Logging**: JSON format for files, colored console output
- **Log Rotation**: Daily rotation with configurable retention
- **Specialized Loggers**: Auth, AI, Security, Performance logging
- **Request Logging**: Detailed HTTP request/response logging

## Log Files

Logs are stored in the `logs/` directory with the following structure:

- `combined-YYYY-MM-DD.log` - All logs (info level and above)
- `error-YYYY-MM-DD.log` - Error logs only
- `access-YYYY-MM-DD.log` - HTTP access logs

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

## Log Management

Use the provided scripts to manage logs:

```bash
# List all log files
npm run logs:list

# View last 50 lines of today's combined log
npm run logs:tail

# View last 100 lines of specific log file
npm run logs:tail combined-2024-01-15.log 100

# Clear all log files
npm run logs:clear
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

### File Output (JSON)
```json
{
  "timestamp": "2024-01-15T10:30:45.123Z",
  "level": "info",
  "message": "Server started successfully",
  "meta": {
    "port": 3000,
    "environment": "development"
  }
}
```

## Monitoring and Alerts

Consider setting up log monitoring for:

- **Error Rates**: Monitor error log files for spikes
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

The structured JSON logs can be easily integrated with monitoring services like:

- **ELK Stack** (Elasticsearch, Logstash, Kibana)
- **Splunk**
- **Datadog**
- **New Relic**
- **CloudWatch** (AWS)

Simply point your log shipping tool to the `logs/` directory.
