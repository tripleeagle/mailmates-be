# Firebase Configuration Validation

This document describes the Firebase configuration validation and connectivity testing implemented in the backend.

## Overview

The backend now includes comprehensive Firebase initialization with validation and connectivity testing to ensure that:

1. **Configuration is correct** - All required environment variables are present and valid
2. **Firestore is accessible** - The database connection is working properly
3. **Proper error handling** - Clear logging and appropriate error responses

## Features

### 1. Configuration Validation

The system validates the following environment variables:
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

It also validates that the private key is in proper PEM format.

### 2. Firestore Connectivity Testing

Performs a simple read operation to verify that Firestore is accessible and responding within a 5-second timeout.

### 3. Comprehensive Initialization

The `initializeFirebaseWithValidation()` function performs all checks in sequence:
1. Configuration validation
2. Firebase Admin SDK initialization
3. Firestore connectivity testing

## Usage

### During Server Startup

The server automatically runs Firebase validation during initialization. If validation fails:

- **Development**: Server starts with warnings, but authentication features won't work
- **Production**: Server exits with error code 1 to prevent deployment with broken Firebase

### Manual Testing

You can test Firebase configuration independently using:

```bash
npm run test:firebase
```

This script will:
- Validate configuration
- Initialize Firebase
- Test Firestore connectivity
- Display detailed results and troubleshooting tips

### Health Check Endpoint

The `/health` endpoint now includes Firebase status:

```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "version": "1.0.0",
  "services": {
    "firebase": "connected",
    "firestore": "available"
  }
}
```

## Error Handling

### Configuration Errors

Missing or invalid environment variables are logged with specific details:

```
Firebase configuration validation failed
Missing environment variables: ['FIREBASE_PROJECT_ID', 'FIREBASE_PRIVATE_KEY']
```

### Connectivity Errors

Firestore connection issues are logged with timeout and error details:

```
Firestore connectivity test failed
Error: Firestore connection timeout
```

### Production Behavior

In production environments, the server will exit if Firebase initialization fails, preventing deployment of a broken service.

## Troubleshooting

### Common Issues

1. **Missing Environment Variables**
   - Ensure all required variables are set in your `.env` file
   - Check that variable names match exactly

2. **Invalid Private Key Format**
   - Ensure the private key includes proper PEM headers/footers
   - Check that `\n` characters are properly escaped

3. **Network Connectivity**
   - Verify internet connection to Firebase services
   - Check firewall settings
   - Ensure Firestore is enabled in your Firebase project

4. **Permissions**
   - Verify your service account has necessary permissions
   - Check that Firestore API is enabled in Google Cloud Console

### Testing Commands

```bash
# Test Firebase configuration
npm run test:firebase

# Start development server with validation
npm run dev

# Check health endpoint
curl http://localhost:5100/health
```

## Implementation Details

### Files Modified

- `config/firebase.ts` - Added validation and connectivity testing functions
- `server.ts` - Updated initialization to use validation
- `scripts/test-firebase.ts` - New standalone test script
- `package.json` - Added test script

### New Functions

- `validateFirebaseConfig()` - Validates environment variables
- `testFirestoreConnectivity()` - Tests database connectivity
- `initializeFirebaseWithValidation()` - Comprehensive initialization

## Security Considerations

- Private keys are validated but not logged
- Only project ID and client email are logged for debugging
- Production environments exit on validation failure
- Health endpoint returns 503 status when services are unavailable
