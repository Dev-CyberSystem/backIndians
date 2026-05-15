import { Router } from 'express';
import { authenticate } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import * as ctrl from '../controllers/settings.controller';

const router = Router();

router.use(authenticate, authorize('admin', 'billing'));

router.get('/', ctrl.getSettings);
router.put('/', ctrl.updateSettings);

export default router;
