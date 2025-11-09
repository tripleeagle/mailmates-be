import { getFirestore, initializeFirebase } from '../config/firebase';
import logger from '../config/logger';
import { User, AISettings } from '../types';
import { DecodedIdToken } from 'firebase-admin/auth';

export interface StoredUser extends AISettings {
  uid: string;
  email?: string;
  name?: string;
  firstName?: string | null;
  lastName?: string | null;
  picture?: string;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date;
  subscription?: {
    planType?: string | null;
    [key: string]: unknown;
  } | null;
}

class UserService {
  private get db() {
    // Ensure Firebase is initialized before accessing Firestore
    initializeFirebase();
    return getFirestore();
  }

  /**
   * Store or update user data after successful authentication
   */
  async storeUser(decodedToken: DecodedIdToken): Promise<StoredUser> {
    try {
      if (!decodedToken.email) {
        throw new Error('Email is required for user storage');
      }

      const email = decodedToken.email;
      const userId = decodedToken.uid;
      const nameFromToken = (decodedToken.name || '').trim();
      const nameParts = nameFromToken ? nameFromToken.split(/\s+/) : [];
      const [tokenFirstName, ...tokenLastParts] = nameParts;
      const tokenLastName = tokenLastParts.length > 0 ? tokenLastParts.join(' ') : undefined;
      
      // Query for existing user by email
      const userQuery = await this.db.collection('users').where('email', '==', email).limit(1).get();
      
      const now = new Date();
      let userData: StoredUser;
      let isNewUser = false;
      
      if (!userQuery.empty) {
        // Update existing user with latest login time
        const existingData = userQuery.docs[0].data() as StoredUser;
        userData = {
          ...existingData,
          uid: userId, // Update UID in case it changed
          name: decodedToken.name || existingData.name,
          firstName: existingData.firstName ?? tokenFirstName,
          lastName: existingData.lastName ?? tokenLastName,
          picture: decodedToken.picture || existingData.picture,
          updatedAt: now,
          lastLoginAt: now
        };
        
        // Update the document
        await userQuery.docs[0].ref.set(userData);
      } else {
        // Create new user with default settings
        userData = {
          uid: userId,
          email: email,
          name: decodedToken.name,
          firstName: tokenFirstName,
          lastName: tokenLastName,
          picture: decodedToken.picture,
          language: 'auto',
          tone: 'auto',
          length: 'auto',
          aiModel: 'default',
          customInstructions: ['Less AI, more human'],
          createdAt: now,
          updatedAt: now,
          lastLoginAt: now
        };
        
        // Save new user to Firestore using email as document ID
        await this.db.collection('users').doc(email).set(userData);
        isNewUser = true;
      }
      
      logger.info('User stored/updated successfully', { 
        userId,
        email: userData.email,
        isNewUser
      });
      
      return userData;
    } catch (error) {
      logger.error('Failed to store user data', {
        userId: decodedToken.uid,
        email: decodedToken.email,
        error: (error as Error).message
      });
      throw new Error('Failed to store user data');
    }
  }

  /**
   * Get user data by email
   */
  async getUserByEmail(email: string): Promise<StoredUser | null> {
    try {
      const userQuery = await this.db.collection('users').where('email', '==', email).limit(1).get();
      
      if (userQuery.empty) {
        return null;
      }
      
      return userQuery.docs[0].data() as StoredUser;
    } catch (error) {
      logger.error('Failed to get user data by email', {
        email,
        error: (error as Error).message
      });
      throw new Error('Failed to retrieve user data');
    }
  }

  /**
   * Get user data by UID (for backward compatibility)
   */
  async getUser(userId: string): Promise<StoredUser | null> {
    try {
      const userQuery = await this.db.collection('users').where('uid', '==', userId).limit(1).get();
      
      if (userQuery.empty) {
        return null;
      }
      
      return userQuery.docs[0].data() as StoredUser;
    } catch (error) {
      logger.error('Failed to get user data by UID', {
        userId,
        error: (error as Error).message
      });
      throw new Error('Failed to retrieve user data');
    }
  }

  /**
   * Update user's last login time by email
   */
  async updateLastLoginByEmail(email: string): Promise<void> {
    try {
      const userQuery = await this.db.collection('users').where('email', '==', email).limit(1).get();
      
      if (!userQuery.empty) {
        await userQuery.docs[0].ref.update({
          lastLoginAt: new Date(),
          updatedAt: new Date()
        });
        
        logger.debug('Updated last login time', { email });
      }
    } catch (error) {
      logger.error('Failed to update last login time', {
        email,
        error: (error as Error).message
      });
      // Don't throw error for this non-critical operation
    }
  }

  /**
   * Update user's last login time by UID (for backward compatibility)
   */
  async updateLastLogin(userId: string): Promise<void> {
    try {
      const userQuery = await this.db.collection('users').where('uid', '==', userId).limit(1).get();
      
      if (!userQuery.empty) {
        await userQuery.docs[0].ref.update({
          lastLoginAt: new Date(),
          updatedAt: new Date()
        });
        
        logger.debug('Updated last login time', { userId });
      }
    } catch (error) {
      logger.error('Failed to update last login time', {
        userId,
        error: (error as Error).message
      });
      // Don't throw error for this non-critical operation
    }
  }

  /**
   * Check if user exists in database by email
   */
  async userExistsByEmail(email: string): Promise<boolean> {
    try {
      const userQuery = await this.db.collection('users').where('email', '==', email).limit(1).get();
      return !userQuery.empty;
    } catch (error) {
      logger.error('Failed to check user existence by email', {
        email,
        error: (error as Error).message
      });
      return false;
    }
  }

  /**
   * Check if user exists in database by UID (for backward compatibility)
   */
  async userExists(userId: string): Promise<boolean> {
    try {
      const userQuery = await this.db.collection('users').where('uid', '==', userId).limit(1).get();
      return !userQuery.empty;
    } catch (error) {
      logger.error('Failed to check user existence by UID', {
        userId,
        error: (error as Error).message
      });
      return false;
    }
  }

  /**
   * Update user profile information by email.
   */
  async updateUserProfileByEmail(
    email: string,
    updates: {
      firstName?: string | null;
      lastName?: string | null;
      name?: string | null;
      picture?: string | null;
    }
  ): Promise<StoredUser> {
    try {
      const userQuery = await this.db.collection('users').where('email', '==', email).limit(1).get();

      if (userQuery.empty) {
        throw new Error('User not found');
      }

      const docRef = userQuery.docs[0].ref;
      const existingData = userQuery.docs[0].data() as StoredUser;

      const now = new Date();

      const sanitizedUpdates: Partial<StoredUser> = {
        updatedAt: now
      };

      if (updates.firstName !== undefined) {
        if (updates.firstName === null) {
          sanitizedUpdates.firstName = null;
        } else {
          const normalizedFirst = updates.firstName.trim();
          sanitizedUpdates.firstName = normalizedFirst.length ? normalizedFirst : null;
        }
      }

      if (updates.lastName !== undefined) {
        if (updates.lastName === null) {
          sanitizedUpdates.lastName = null;
        } else {
          const normalizedLast = updates.lastName.trim();
          sanitizedUpdates.lastName = normalizedLast.length ? normalizedLast : null;
        }
      }

      if (updates.picture !== undefined) {
        if (updates.picture === null) {
          sanitizedUpdates.picture = undefined;
        } else {
          const normalizedPicture = updates.picture.trim();
          sanitizedUpdates.picture = normalizedPicture.length ? normalizedPicture : undefined;
        }
      }

      if (updates.name !== undefined) {
        if (updates.name === null) {
          sanitizedUpdates.name = existingData.name;
        } else {
          const normalizedName = updates.name.trim();
          sanitizedUpdates.name = normalizedName.length ? normalizedName : existingData.name;
        }
      } else {
        const fallbackFirst = sanitizedUpdates.firstName ?? existingData.firstName;
        const fallbackLast = sanitizedUpdates.lastName ?? existingData.lastName;
        const recomposedName = [fallbackFirst, fallbackLast].filter(Boolean).join(' ').trim();
        sanitizedUpdates.name = recomposedName || existingData.name;
      }

      await docRef.set(sanitizedUpdates, { merge: true });

      const updatedUser: StoredUser = {
        ...existingData,
        ...sanitizedUpdates
      };

      logger.info('User profile updated', {
        email,
        updatedFields: Object.keys(sanitizedUpdates).filter((field) => field !== 'updatedAt')
      });

      return updatedUser;
    } catch (error) {
      logger.error('Failed to update user profile', {
        email,
        error: (error as Error).message
      });
      throw new Error('Failed to update user profile');
    }
  }
}

export default new UserService();
