import { Router } from 'express';
import { query } from 'express-validator';
import { authenticate } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { validate } from '../middlewares/validate';
import { summary, sellerStats } from '../controllers/dashboard.controller';

const router = Router();

router.get('/summary', authenticate, authorize('admin', 'billing'), summary);

router.get(
  '/sellers',
  authenticate,
  authorize('admin', 'billing'),
  [
    query('seller_id').optional().isInt({ min: 1 }),
    query('month').optional().matches(/^\d{4}-\d{2}$/),
    query('sort_by').optional().isIn(['revenue', 'orders', 'units']),
    validate,
  ],
  sellerStats
);

export default router;
