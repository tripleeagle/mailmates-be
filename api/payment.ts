import express, { Request, Response, NextFunction, response } from 'express';
import Stripe from 'stripe';
import { verifyIdToken, getFirestore } from '../config/firebase';
import logger from '../config/logger';
import { ApiResponse } from '../types';

const router = express.Router();

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2025-10-29.clover',
});

// Middleware to verify authentication
const authenticateUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.logSecurity('Authentication failed', { reason: 'No token provided', ip: req.ip });
      res.status(401).json({ success: false, error: 'No token provided' });
      return;
    }

    const token = authHeader.substring(7);
    const decodedToken = await verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    logger.logAuth('api_authentication', 'unknown', false, {
      error: (error as Error).message,
      ip: req.ip,
      endpoint: req.originalUrl
    });
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
};

// Product IDs for different plans (should be set in environment variables)
const PRODUCT_IDS = {
  unlimited_monthly: process.env.STRIPE_PRODUCT_ID_UNLIMITED_MONTHLY || '',
  unlimited_annual: process.env.STRIPE_PRODUCT_ID_UNLIMITED_ANNUAL || '',
  pro_monthly: process.env.STRIPE_PRODUCT_ID_PRO_MONTHLY || '',
  pro_annual: process.env.STRIPE_PRODUCT_ID_PRO_ANNUAL || '',
};

type SubscriptionSummary = {
  id: string;
  status: Stripe.Subscription.Status;
  created: Date;
  planType: string;
  billingPeriod: string;
  nextBillingDate: Date | null;
  nextPaymentAmount: number | null;
  nextPaymentCurrency: string | null;
};

const retrieveUpcomingInvoice = async (subscriptionId: string): Promise<Stripe.Invoice | null> => {
  try {
    return await stripe.invoices.createPreview({
      subscription: subscriptionId,
    });
  } catch (error) {
    const errorWithCode = error as { code?: string; message?: string };

    if (errorWithCode?.code === 'invoice_upcoming_none') {
      logger.info('No upcoming invoice for subscription', { subscriptionId });
      return null;
    }

    logger.error('Failed to retrieve upcoming invoice', {
      subscriptionId,
      error: (error as Error).message,
      code: errorWithCode?.code,
    });
    return null;
  }
};

const getSubscriptionDetails = async (subscriptionId: string): Promise<SubscriptionSummary | null> => {
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['items.data.price'],
    });
    const upcomingInvoice = await retrieveUpcomingInvoice(subscription.id);
    
    return {
      id: subscription.id,
      status: subscription.status,
      created: new Date(subscription.created * 1000),
      planType: subscription.metadata?.planType || 'unknown',
      billingPeriod: subscription.metadata?.billingPeriod || 'unknown',
      nextBillingDate: upcomingInvoice?.period_end ? new Date(upcomingInvoice.period_end * 1000) : null,
      nextPaymentAmount: upcomingInvoice?.amount_due || null,
      nextPaymentCurrency: upcomingInvoice?.currency || null,
    }
  } catch (error) {
    logger.error('Failed to retrieve subscription details', {
      subscriptionId,
      error: (error as Error).message,
    });
    return null;
  }
};

const createCheckoutSessionHandler = async (req: Request, res: Response<ApiResponse<{ sessionId: string; url: string }>>) => {
  try {
    const userId = req.user!.uid;
    const userEmail = req.user!.email;
    const { planType, billingPeriod } = req.body;

    if (!userEmail) {
      res.status(400).json({
        success: false,
        error: 'User email not available'
      });
      return;
    }

    // Validate plan type and billing period
    const validPlans = ['unlimited', 'pro'];
    const validPeriods = ['monthly', 'annual'];

    if (!validPlans.includes(planType) || !validPeriods.includes(billingPeriod)) {
      res.status(400).json({
        success: false,
        error: 'Invalid plan type or billing period'
      });
      return;
    }

    // Get the product ID for the specific plan and billing period
    const productIdKey = `${planType}_${billingPeriod}` as keyof typeof PRODUCT_IDS;
    const productId = PRODUCT_IDS[productIdKey];

    if (!productId || productId.trim() === '') {
      logger.error('Stripe product ID not configured', { 
        planType, 
        billingPeriod,
        productIdKey,
        configuredProductIds: {
          unlimited_monthly: PRODUCT_IDS.unlimited_monthly ? 'configured' : 'missing',
          unlimited_annual: PRODUCT_IDS.unlimited_annual ? 'configured' : 'missing',
          pro_monthly: PRODUCT_IDS.pro_monthly ? 'configured' : 'missing',
          pro_annual: PRODUCT_IDS.pro_annual ? 'configured' : 'missing',
        }
      });
      res.status(500).json({
        success: false,
        error: 'Payment configuration error: Product ID not found for the selected plan'
      });
      return;
    }

    // Retrieve the product and get its default price
    const product = await stripe.products.retrieve(productId);
    
    // Get the default price for this product (first active price)
    const prices = await stripe.prices.list({
      product: productId,
      active: true,
      limit: 1,
    });

    if (prices.data.length === 0) {
      logger.error('No active price found for product', { productId });
      res.status(500).json({
        success: false,
        error: 'No active price found for the selected product'
      });
      return;
    }

    const priceId = prices.data[0].id;

    // Get frontend URL for success/cancel redirects
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const successUrl = `${frontendUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${frontendUrl}/payment/cancel`;

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      customer_email: userEmail,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        userId,
        userEmail,
        planType,
        billingPeriod,
      },
      subscription_data: {
        metadata: {
          userId,
          userEmail,
          planType,
          billingPeriod,
        },
      },
    });

    logger.info('Checkout session created', {
      userId,
      sessionId: session.id,
      planType,
      billingPeriod,
    });

    res.json({
      success: true,
      data: {
        sessionId: session.id,
        url: session.url || '',
      },
    });
  } catch (error) {
    logger.error('Failed to create checkout session', {
      userId: req.user?.uid || 'unknown',
      error: (error as Error).message,
    });
    res.status(500).json({
      success: false,
      error: 'Failed to create checkout session',
    });
  }
};

// Create checkout session (original endpoint)
router.post('/checkout', authenticateUser, createCheckoutSessionHandler);

// Create checkout session (original endpoint)
router.post('/create-checkout-session', authenticateUser, createCheckoutSessionHandler);

// Get subscription status
router.get('/subscription', authenticateUser, async (req: Request, res: Response<ApiResponse<{ subscription: any }>>) => {
  try {
    const userId = req.user!.uid;
    const userEmail = req.user!.email;

    if (!userEmail) {
      res.status(400).json({
        success: false,
        error: 'User email not available'
      });
      return;
    }

    // Find customer by email
    const customers = await stripe.customers.list({
      email: userEmail,
      limit: 1,
    });

    if (customers.data.length === 0) {
      res.json({
        success: true,
        data: {
          subscription: null,
        },
      });
      return;
    }

    const customer = customers.data[0];

    // Get active subscriptions
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.id,
      status: 'active',
      limit: 1,
    });

    if (subscriptions.data.length === 0) {
      res.json({
        success: true,
        data: {
          subscription: null,
        },
      });
      return;
    }

    const subscription = subscriptions.data[0];

    const subscriptionSummary = await getSubscriptionDetails(subscription.id);

    if (!subscriptionSummary) {
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve subscription details',
      });
      return;
    }

    res.json({
      success: true,
      data: {
        subscription: {
          id: subscriptionSummary.id,
          status: subscriptionSummary.status,
          created: subscriptionSummary.created,
          planType: subscriptionSummary.planType,
          billingPeriod: subscriptionSummary.billingPeriod,
          nextBillingDate: subscriptionSummary.nextBillingDate,
          nextPaymentAmount: subscriptionSummary.nextPaymentAmount,
          nextPaymentCurrency: subscriptionSummary.nextPaymentCurrency
        },
      },
    });
  } catch (error) {
    logger.error('Failed to get subscription', {
      userId: req.user?.uid || 'unknown',
      error: (error as Error).message,
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve subscription',
    });
  }
});

// Cancel subscription
router.post('/cancel-subscription', authenticateUser, async (req: Request, res: Response<ApiResponse>) => {
  try {
    const userId = req.user!.uid;
    const userEmail = req.user!.email;

    if (!userEmail) {
      res.status(400).json({
        success: false,
        error: 'User email not available'
      });
      return;
    }

    // Find customer by email
    const customers = await stripe.customers.list({
      email: userEmail,
      limit: 1,
    });

    if (customers.data.length === 0) {
      res.status(404).json({
        success: false,
        error: 'No subscription found'
      });
      return;
    }

    const customer = customers.data[0];

    // Get active subscriptions
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.id,
      status: 'active',
      limit: 1,
    });

    if (subscriptions.data.length === 0) {
      res.status(404).json({
        success: false,
        error: 'No active subscription found'
      });
      return;
    }

    const subscription = subscriptions.data[0];

    // Cancel the subscription
    await stripe.subscriptions.cancel(subscription.id);

    logger.info('Subscription cancelled', {
      userId,
      subscriptionId: subscription.id,
    });

    res.json({
      success: true,
      message: 'Subscription cancelled successfully',
    });
  } catch (error) {
    logger.error('Failed to cancel subscription', {
      userId: req.user?.uid || 'unknown',
      error: (error as Error).message,
    });
    res.status(500).json({
      success: false,
      error: 'Failed to cancel subscription',
    });
  }
});

// Stripe webhook handler
router.post('/webhook', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'];

  if (!sig) {
    logger.warn('Stripe webhook called without signature');
    res.status(400).send('Missing signature');
    return;
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

  if (!webhookSecret) {
    logger.error('Stripe webhook secret not configured');
    res.status(500).send('Webhook secret not configured');
    return;
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    logger.error('Webhook signature verification failed', {
      error: (err as Error).message,
    });
    res.status(400).send(`Webhook Error: ${(err as Error).message}`);
    return;
  }

  const db = getFirestore();

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      const userEmail = session.metadata?.userEmail;
      const planType = session.metadata?.planType;
      const billingPeriod = session.metadata?.billingPeriod;

      if (userId && userEmail) {
        try {
          let subscriptionSummary: SubscriptionSummary | null = null;
          const subscriptionId = typeof session.subscription === 'string'
            ? session.subscription
            : typeof (session.subscription as Stripe.Subscription | undefined)?.id === 'string'
              ? (session.subscription as Stripe.Subscription).id
              : null;

          if (subscriptionId) {
            subscriptionSummary = await getSubscriptionDetails(subscriptionId);
          }

          // Update user subscription in Firestore
          const userQuery = await db.collection('users').where('email', '==', userEmail).limit(1).get();
          
          if (!userQuery.empty) {
            const userRef = userQuery.docs[0].ref;
            
            await userRef.update({
              subscription: subscriptionSummary,
              updatedAt: new Date(),
            });

            logger.info('Subscription created in database', {
              userId,
              subscriptionId: session.subscription,
              planType,
              billingPeriod,
            });
          }
          else {
            logger.error('User not found in database', {
              userId,
              userEmail,
              metadata: session.metadata
            });
          }
        } catch (error) {
          logger.error('Failed to update user subscription in database', {
            userId,
            error: (error as Error).message,
          });
        }
      }
      break;
    }

    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const userEmail = subscription.metadata?.userEmail;

      if (userEmail) {
        try {
          const userQuery = await db.collection('users').where('email', '==', userEmail).limit(1).get();
          
          if (!userQuery.empty) {
            const userRef = userQuery.docs[0].ref;
            await userRef.update({
              subscription: {
                stripeSubscriptionId: subscription.id,
                planType: subscription.metadata?.planType,
                billingPeriod: subscription.metadata?.billingPeriod,
                status: subscription.status,
                updatedAt: new Date(),
              },
              updatedAt: new Date(),
            });

            logger.info('Subscription updated in database', {
              subscriptionId: subscription.id,
              status: subscription.status,
            });
          }
        } catch (error) {
          logger.error('Failed to update subscription in database', {
            subscriptionId: subscription.id,
            error: (error as Error).message,
          });
        }
      }
      break;
    }

    default:
      logger.info('Unhandled webhook event type', { type: event.type });
  }

  res.json({ received: true });
});

// Debug endpoint to check product ID configuration (remove in production)
router.get('/debug/product-ids', authenticateUser, async (req: Request, res: Response) => {
  res.json({
    configured: {
      unlimited_monthly: PRODUCT_IDS.unlimited_monthly ? '✓' : '✗',
      unlimited_annual: PRODUCT_IDS.unlimited_annual ? '✓' : '✗',
      pro_monthly: PRODUCT_IDS.pro_monthly ? '✓' : '✗',
      pro_annual: PRODUCT_IDS.pro_annual ? '✓' : '✗',
    },
    raw: {
      unlimited_monthly: PRODUCT_IDS.unlimited_monthly,
      unlimited_annual: PRODUCT_IDS.unlimited_annual,
      pro_monthly: PRODUCT_IDS.pro_monthly,
      pro_annual: PRODUCT_IDS.pro_annual,
    }
  });
});

export default router;

