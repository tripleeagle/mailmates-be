# Deploying AI Email Assistant Backend to Vercel Serverless Functions

This guide walks you through deploying your Express.js backend API to Vercel as serverless functions.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Project Structure Overview](#project-structure-overview)
- [Pre-deployment Setup](#pre-deployment-setup)
- [Vercel Configuration](#vercel-configuration)
- [Environment Variables](#environment-variables)
- [Deployment Steps](#deployment-steps)
- [Testing Your Deployment](#testing-your-deployment)
- [Monitoring and Logs](#monitoring-and-logs)
- [Troubleshooting](#troubleshooting)
- [Performance Optimization](#performance-optimization)

## Prerequisites

- Node.js 18+ installed locally
- Vercel CLI installed (`npm i -g vercel`)
- Vercel account (free tier available)
- All required API keys and service accounts configured

## Project Structure Overview

Your backend is structured as a traditional Express.js application with the following key components:

```
backend/
├── server.ts              # Main Express app
├── routes/                # API route handlers
│   ├── auth.ts
│   ├── generate.ts
│   ├── user.ts
│   └── usage.ts
├── services/              # Business logic
├── config/                # Configuration files
├── middleware/            # Custom middleware
├── types/                 # TypeScript type definitions
├── vercel.json           # Vercel configuration
└── package.json          # Dependencies and scripts
```

## Pre-deployment Setup

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Build the Project

```bash
npm run build
```

This compiles your TypeScript code to the `dist/` directory.

### 3. Verify Build Output

Ensure the build creates:
- `dist/server.js` - Main server file
- `dist/routes/*.js` - Route handlers
- `dist/services/*.js` - Service files
- `dist/config/*.js` - Configuration files

## Vercel Configuration

Your `vercel.json` is already configured for serverless deployment:

```json
{
  "version": 2,
  "buildCommand": "npm run build",
  "builds": [
    {
      "src": "dist/server.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "dist/server.js"
    }
  ],
  "env": {
    "NODE_ENV": "production"
  },
  "functions": {
    "dist/server.js": {
      "maxDuration": 30
    }
  }
}
```

### Key Configuration Notes:

- **Single Function**: All routes are handled by one serverless function
- **Max Duration**: 30 seconds (Vercel Pro allows up to 60s)
- **Build Command**: Uses your existing `npm run build` script
- **Routing**: All requests (`(.*)`) are routed to the main server file

## Environment Variables

### Required Environment Variables

Set these in your Vercel dashboard or via CLI:

#### Server Configuration
```bash
NODE_ENV=production
FRONTEND_URL=https://your-frontend-domain.com
```

#### Firebase Configuration
```bash
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY_ID=your-private-key-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
FIREBASE_CLIENT_ID=your-client-id
FIREBASE_STORAGE_BUCKET=your-project.appspot.com
```

#### AI API Keys
```bash
OPENAI_API_KEY=sk-your-openai-api-key
ANTHROPIC_API_KEY=sk-ant-your-anthropic-api-key
GOOGLE_AI_API_KEY=your-google-ai-api-key
```

#### Security
```bash
JWT_SECRET=your-jwt-secret-key
CORS_ORIGIN=https://mail.google.com,chrome-extension://*
```

### Setting Environment Variables

#### Option 1: Vercel Dashboard
1. Go to your project in Vercel dashboard
2. Navigate to Settings → Environment Variables
3. Add each variable with appropriate values

#### Option 2: Vercel CLI
```bash
vercel env add NODE_ENV
vercel env add FIREBASE_PROJECT_ID
# ... repeat for each variable
```

## Deployment Steps

### 1. Login to Vercel

```bash
vercel login
```

### 2. Initialize Project (First Time)

```bash
vercel
```

Follow the prompts:
- Set up and deploy? **Yes**
- Which scope? **Your account**
- Link to existing project? **No** (for first deployment)
- Project name: **ai-email-assistant-backend** (or your preferred name)
- Directory: **./backend** (or just `.` if running from backend directory)
- Override settings? **No**

### 3. Deploy

```bash
vercel --prod
```

### 4. Verify Deployment

After deployment, you'll get a URL like:
```
https://ai-email-assistant-backend.vercel.app
```

## Testing Your Deployment

### 1. Health Check

```bash
curl https://your-app.vercel.app/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "version": "1.0.0"
}
```

### 2. Test API Endpoints

```bash
# Test authentication endpoint
curl -X POST https://your-app.vercel.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "password"}'

# Test generation endpoint (with auth token)
curl -X POST https://your-app.vercel.app/api/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"prompt": "Write an email", "model": "gpt-3.5-turbo"}'
```

### 3. Test CORS

Ensure your Chrome extension can make requests:
```javascript
fetch('https://your-app.vercel.app/api/health', {
  method: 'GET',
  headers: {
    'Content-Type': 'application/json'
  }
})
.then(response => response.json())
.then(data => console.log(data));
```

## Monitoring and Logs

### 1. View Logs

```bash
# View recent logs
vercel logs

# Follow logs in real-time
vercel logs --follow

# View logs for specific deployment
vercel logs [deployment-url]
```

### 2. Monitor Performance

- **Vercel Dashboard**: Real-time metrics and analytics
- **Function Logs**: Detailed execution logs
- **Error Tracking**: Automatic error detection and reporting

### 3. Health Monitoring

Your app includes a health check endpoint at `/health` that returns:
- Server status
- Timestamp
- Version information

## Troubleshooting

### Common Issues

#### 1. Build Failures

**Problem**: TypeScript compilation errors
**Solution**:
```bash
# Check for TypeScript errors
npm run type-check

# Fix any type issues
npm run build
```

#### 2. Environment Variables Not Loading

**Problem**: `process.env` variables are undefined
**Solution**:
- Verify variables are set in Vercel dashboard
- Check variable names match exactly (case-sensitive)
- Redeploy after adding new variables

#### 3. CORS Issues

**Problem**: Chrome extension can't make requests
**Solution**:
- Verify `CORS_ORIGIN` includes your extension ID
- Check that `chrome-extension://*` is in the origin list
- Ensure credentials are properly configured

#### 4. Function Timeout

**Problem**: Requests timing out after 30 seconds
**Solution**:
- Optimize AI API calls
- Implement request batching
- Consider upgrading to Vercel Pro for 60s timeout

#### 5. Firebase Connection Issues

**Problem**: Firebase Admin SDK not initializing
**Solution**:
- Verify all Firebase environment variables are set
- Check private key format (newlines as `\n`)
- Ensure service account has proper permissions

### Debug Commands

```bash
# Check deployment status
vercel ls

# View deployment details
vercel inspect [deployment-url]

# Check environment variables
vercel env ls

# Redeploy with debug info
vercel --debug
```

## Performance Optimization

### 1. Cold Start Optimization

- **Keep dependencies minimal**: Only import what you need
- **Lazy load heavy modules**: Import AI SDKs only when needed
- **Optimize bundle size**: Use tree-shaking and code splitting

### 2. Memory Management

- **Reuse connections**: Initialize Firebase once per function execution
- **Clean up resources**: Properly close database connections
- **Monitor memory usage**: Use Vercel's built-in monitoring

### 3. Caching Strategies

- **Response caching**: Cache AI responses when appropriate
- **Static assets**: Use Vercel's CDN for static files
- **Database queries**: Implement query result caching

### 4. Rate Limiting

Your app includes rate limiting (default: 500 requests per 15 minutes per IP). Configure via environment variables:

```bash
# In your .env or Vercel environment variables
RATE_LIMIT_WINDOW_MS=900000    # 15 minutes in milliseconds
RATE_LIMIT_MAX_REQUESTS=500    # Max requests per window
```

The rate limiter will use these environment variables in `server.ts` and `api/index.ts`:

```typescript
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '500', 10),
  // ... other options
});
```

## Production Checklist

Before going live, ensure:

- [ ] All environment variables are set
- [ ] CORS is configured for your domains
- [ ] Rate limiting is appropriate for your use case
- [ ] Error handling is comprehensive
- [ ] Logging is properly configured
- [ ] Health check endpoint is working
- [ ] All API endpoints are tested
- [ ] Firebase permissions are correct
- [ ] AI API keys have proper quotas
- [ ] Monitoring and alerting are set up

## Next Steps

1. **Set up custom domain** (optional)
2. **Configure monitoring alerts**
3. **Set up CI/CD pipeline** for automatic deployments
4. **Implement API versioning** for future updates
5. **Add API documentation** (Swagger/OpenAPI)

## Support

- [Vercel Documentation](https://vercel.com/docs)
- [Vercel CLI Reference](https://vercel.com/docs/cli)
- [Express.js on Vercel](https://vercel.com/guides/express-js-on-vercel)
- [Serverless Functions Guide](https://vercel.com/docs/functions)

---

**Note**: This deployment uses Vercel's serverless functions, which means your Express app runs as a single function handling all routes. This is efficient for most use cases but consider splitting into multiple functions if you have very different workloads per route.


