import { Router } from 'express';
import authRoutes from './auth.routes';
import userRoutes from './user.routes';
import clientRoutes from './client.routes';
import productRoutes from './product.routes';
import orderRoutes from './order.routes';
import invoiceRoutes from './invoice.routes';
import dashboardRoutes from './dashboard.routes';
import stockRoutes from './stock.routes';
import masterRoutes from './master.routes';
import settingsRoutes from './settings.routes';
import cashRoutes from './cash.routes';

export const router = Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/clients', clientRoutes);
router.use('/products', productRoutes);
router.use('/orders', orderRoutes);
router.use('/invoices', invoiceRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/stock', stockRoutes);
router.use('/master', masterRoutes);
router.use('/settings', settingsRoutes);
router.use('/cash', cashRoutes);
