import type { Firestore } from 'firebase-admin/firestore';

import { initializeFirebase, getFirestore } from '../config/firebase';
import logger from '../config/logger';

export type PlanType = 'free' | 'pro' | 'unlimited';
export type UsageTier = 'basic' | 'advanced';

interface UsageCounterDoc {
  userId: string;
  periodKey: string;
  planType: PlanType;
  basicCount: number;
  advancedCount: number;
  updatedAt: Date;
  lastResetAt: Date;
  lastResetReason?: 'monthly' | 'subscription';
}

interface UsageConsumptionResult {
  allowed: boolean;
  tier: UsageTier;
  planType: PlanType;
  limit: number | null;
  remaining: number | null;
  counts: {
    basic: number;
    advanced: number;
  };
  resetsOn: Date;
}

interface UsageSummary {
  planType: PlanType;
  periodKey: string;
  counts: {
    basic: number;
    advanced: number;
  };
  limits: {
    basic: number | null;
    advanced: number | null;
  };
  remaining: {
    basic: number | null;
    advanced: number | null;
  };
  lastResetAt: Date;
  lastResetReason?: 'monthly' | 'subscription';
  resetsOn: Date;
}

const PLAN_LIMITS: Record<PlanType, { basic: number | null; advanced: number | null }> = {
  free: {
    basic: 20,
    advanced: 0,
  },
  pro: {
    basic: 5000,
    advanced: 200,
  },
  unlimited: {
    basic: 12000,
    advanced: 1600,
  },
};

const BASIC_MODELS = new Set([
  'gpt-4o-mini',
  'gpt-4o mini',
  'gpt-4o',
  'gpt-5-mini',
  'gpt-5 mini',
  'gpt-5-nano',
  'gpt-5 nano',
  'default',
]);

const ADVANCED_MODELS = new Set([
  'gpt-5',
  'gpt5',
  'claude-4',
  'claude 4',
  'claude-3.5',
  'claude-3.5-sonnet',
  'claude',
  'gemini-2.5-pro',
  'gemini 2.5 pro',
  'gemini-2.0',
  'gemini',
  'llama-3.1',
  'llama',
  'deepseek-v3',
  'deepseek',
]);

const USERS_COLLECTION = 'users';
const USAGE_SUBCOLLECTION = 'usageRecords';

const getDb = () => {
  initializeFirebase();
  return getFirestore();
};

const normalizeDate = (value: any, fallback: Date): Date => {
  if (!value) {
    return fallback;
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value.toDate === 'function') {
    return value.toDate();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
};

const formatPeriodKey = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${year}-${month}`;
};

const getNextMonthlyReset = (date: Date): Date => {
  const nextMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return nextMonth;
};

const resolvePlanType = (planType?: string | null): PlanType => {
  switch ((planType || '').toLowerCase()) {
    case 'pro':
      return 'pro';
    case 'unlimited':
      return 'unlimited';
    default:
      return 'free';
  }
};

const resolveUsageTier = (model?: string | null): UsageTier => {
  const normalized = (model || '').toLowerCase();
  if (BASIC_MODELS.has(normalized)) {
    return 'basic';
  }
  if (ADVANCED_MODELS.has(normalized)) {
    return 'advanced';
  }

  // Default to advanced for safety if model is unknown
  return 'advanced';
};

const buildCounterSkeleton = (userId: string, planType: PlanType, now: Date): UsageCounterDoc => {
  return {
    userId,
    periodKey: formatPeriodKey(now),
    planType,
    basicCount: 0,
    advancedCount: 0,
    updatedAt: now,
    lastResetAt: now,
    lastResetReason: 'monthly',
  };
};

const computeRemaining = (limit: number | null, usage: number): number | null => {
  if (limit === null) {
    return null;
  }
  return Math.max(limit - usage, 0);
};

const getUsageDocRef = (db: Firestore, userId: string, periodKey: string) => {
  return db
    .collection(USERS_COLLECTION)
    .doc(userId)
    .collection(USAGE_SUBCOLLECTION)
    .doc(periodKey);
};

const usageTrackerService = {
  resolvePlanType,
  resolveUsageTier,

  async consumeUsage(userId: string, plan: PlanType, model: string, requestedAt: Date): Promise<UsageConsumptionResult> {
    const tier = resolveUsageTier(model);
    const db = getDb();
    const now = requestedAt;
    const periodKey = formatPeriodKey(now);
    const docRef = getUsageDocRef(db, userId, periodKey);

    return db.runTransaction<UsageConsumptionResult>(async (tx) => {
      const docSnap = await tx.get(docRef);

      let counter: UsageCounterDoc;

      if (docSnap.exists) {
        const data = docSnap.data() as UsageCounterDoc;
        counter = {
          ...data,
          periodKey,
          userId,
          planType: plan,
          updatedAt: normalizeDate((data as any).updatedAt, now),
          lastResetAt: normalizeDate((data as any).lastResetAt, now),
        };
      } else {
        counter = {
          ...buildCounterSkeleton(userId, plan, now),
          periodKey,
        };
      }

      const planLimits = PLAN_LIMITS[plan];
      const limit = planLimits[tier];

      const currentUsage = tier === 'basic' ? counter.basicCount : counter.advancedCount;

      if (limit !== null && currentUsage >= limit) {
        logger.info('Usage limit reached', { userId, plan, tier, limit });
        return {
          allowed: false,
          tier,
          planType: plan,
          limit,
          remaining: 0,
          counts: {
            basic: counter.basicCount,
            advanced: counter.advancedCount,
          },
          resetsOn: getNextMonthlyReset(now),
        };
      }

      const updatedUsage = currentUsage + 1;

      if (tier === 'basic') {
        counter.basicCount = updatedUsage;
      } else {
        counter.advancedCount = updatedUsage;
      }

      counter.updatedAt = now;

      tx.set(docRef, counter, { merge: true });

      return {
        allowed: true,
        tier,
        planType: plan,
        limit,
        remaining: computeRemaining(limit, updatedUsage),
        counts: {
          basic: counter.basicCount,
          advanced: counter.advancedCount,
        },
        resetsOn: getNextMonthlyReset(now),
      };
    });
  },

  async rollbackUsage(userId: string, model: string, occurredAt: Date): Promise<void> {
    const tier = resolveUsageTier(model);
    const db = getDb();
    const periodKey = formatPeriodKey(occurredAt);
    const docRef = getUsageDocRef(db, userId, periodKey);

    await db.runTransaction(async (tx) => {
      const docSnap = await tx.get(docRef);
      if (!docSnap.exists) {
        return;
      }

      const data = docSnap.data() as UsageCounterDoc;
      const counter: UsageCounterDoc = {
        ...data,
        periodKey,
        userId,
        updatedAt: normalizeDate((data as any).updatedAt, occurredAt),
        lastResetAt: normalizeDate((data as any).lastResetAt, occurredAt),
      };

      if (tier === 'basic' && counter.basicCount > 0) {
        counter.basicCount -= 1;
      } else if (tier === 'advanced' && counter.advancedCount > 0) {
        counter.advancedCount -= 1;
      } else {
        return;
      }

      counter.updatedAt = new Date();
      tx.set(docRef, counter, { merge: true });
    });
  },

  async resetUsage(userId: string, plan: PlanType, reason: 'monthly' | 'subscription', resetDate: Date = new Date()): Promise<void> {
    const db = getDb();
    const periodKey = formatPeriodKey(resetDate);
    const docRef = getUsageDocRef(db, userId, periodKey);
    const counter: UsageCounterDoc = {
      ...buildCounterSkeleton(userId, plan, resetDate),
      periodKey,
      lastResetReason: reason,
      lastResetAt: resetDate,
    };

    await docRef.set(counter, { merge: true });

    logger.info('Usage counters reset', { userId, plan, reason });
  },

  async getUsageSummary(userId: string, plan: PlanType, asOf: Date = new Date()): Promise<UsageSummary> {
    const db = getDb();
    const periodKey = formatPeriodKey(asOf);
    const docRef = getUsageDocRef(db, userId, periodKey);
    const docSnap = await docRef.get();
    const now = asOf;

    let counter: UsageCounterDoc;

    if (docSnap.exists) {
      const data = docSnap.data() as UsageCounterDoc;
      counter = {
        ...data,
        periodKey,
        planType: plan,
        updatedAt: normalizeDate((data as any).updatedAt, now),
        lastResetAt: normalizeDate((data as any).lastResetAt, now),
      };
    } else {
      counter = buildCounterSkeleton(userId, plan, now);
      counter.periodKey = periodKey;
    }

    const limits = PLAN_LIMITS[plan];

    return {
      planType: plan,
      periodKey: counter.periodKey,
      counts: {
        basic: counter.basicCount,
        advanced: counter.advancedCount,
      },
      limits: {
        basic: limits.basic,
        advanced: limits.advanced,
      },
      remaining: {
        basic: computeRemaining(limits.basic, counter.basicCount),
        advanced: computeRemaining(limits.advanced, counter.advancedCount),
      },
      lastResetAt: counter.lastResetAt,
      lastResetReason: counter.lastResetReason,
      resetsOn: getNextMonthlyReset(now),
    };
  },

  PLAN_LIMITS,
};

export type { UsageConsumptionResult, UsageSummary };
export default usageTrackerService;

