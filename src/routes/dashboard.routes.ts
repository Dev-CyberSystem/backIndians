import { Router } from 'express';
import { authenticate } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { summary } from '../controllers/dashboard.controller';

const router = Router();

router.get('/summary', authenticate, authorize('admin'), summary);

export default router;
