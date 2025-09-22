#!/usr/bin/env ts-node

/**
 * Firebase Configuration and Connectivity Test Script
 * 
 * This script tests Firebase configuration and Firestore connectivity
 * without starting the full server. Useful for debugging Firebase issues.
 */

import dotenv from 'dotenv';
import { 
  initializeFirebaseWithValidation, 
  validateFirebaseConfig, 
  testFirestoreConnectivity,
  getFirebaseApp 
} from '../config/firebase';
import logger from '../config/logger';

// Load environment variables
dotenv.config({ path: '.env.local' });
dotenv.config();

async function testFirebaseSetup(): Promise<void> {
  console.log('🔧 Testing Firebase Configuration and Connectivity...\n');

  try {
    // Step 1: Test configuration validation
    console.log('1️⃣  Testing Firebase configuration...');
    const configValid = validateFirebaseConfig();
    
    if (!configValid) {
      console.log('❌ Firebase configuration validation failed');
      console.log('💡 Check your environment variables:');
      console.log('   - FIREBASE_PROJECT_ID');
      console.log('   - FIREBASE_CLIENT_EMAIL');
      console.log('   - FIREBASE_PRIVATE_KEY');
      process.exit(1);
    }
    console.log('✅ Firebase configuration validation passed\n');

    // Step 2: Initialize Firebase with full validation
    console.log('2️⃣  Initializing Firebase Admin SDK...');
    const firebaseApp = await initializeFirebaseWithValidation();
    
    if (!firebaseApp) {
      console.log('❌ Firebase initialization failed');
      process.exit(1);
    }
    console.log('✅ Firebase Admin SDK initialized successfully\n');

    // Step 3: Test Firestore connectivity
    console.log('3️⃣  Testing Firestore connectivity...');
    const firestoreConnected = await testFirestoreConnectivity();
    
    if (!firestoreConnected) {
      console.log('❌ Firestore connectivity test failed');
      process.exit(1);
    }
    console.log('✅ Firestore connectivity test passed\n');

    // Step 4: Display Firebase app info
    const app = getFirebaseApp();
    if (app) {
      console.log('📊 Firebase App Information:');
      console.log(`   Project ID: ${app.options.projectId}`);
      console.log(`   Service Account: ${app.options.credential ? 'Configured' : 'Not configured'}`);
      console.log(`   Storage Bucket: ${app.options.storageBucket || 'Not configured'}`);
    }

    console.log('\n🎉 All Firebase tests passed! Your configuration is working correctly.');
    
  } catch (error) {
    console.log(`❌ Firebase test failed: ${(error as Error).message}`);
    console.log('\n🔍 Troubleshooting tips:');
    console.log('1. Verify your Firebase project credentials');
    console.log('2. Check that your Firebase project has Firestore enabled');
    console.log('3. Ensure your service account has the necessary permissions');
    console.log('4. Verify your network connectivity to Firebase services');
    process.exit(1);
  }
}

// Run the test
testFirebaseSetup().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
