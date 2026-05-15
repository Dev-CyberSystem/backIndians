import { Router } from 'express';
import { body, param } from 'express-validator';
import { authenticate } from '../middlewares/auth';
import { authorize } from '../middlewares/authorize';
import { validate } from '../middlewares/validate';
import * as ctrl from '../controllers/client.controller';

const router = Router();

router.use(authenticate);

// seller, billing y admin pueden listar y crear clientes
router.get('/', authorize('admin', 'billing', 'seller'), ctrl.listClients);

router.post(
  '/',
  authorize('admin', 'billing', 'seller'),
  [
    body('name').notEmpty().withMessage('Nombre requerido'),
    body('email').optional().isEmail(),
    validate,
  ],
  ctrl.createClient
);

// seller también puede editar clientes (cualquiera, no solo los suyos)
router.put(
  '/:id',
  authorize('admin', 'billing', 'seller'),
  [
    param('id').isInt({ min: 1 }),
    body('email').optional().isEmail(),
    validate,
  ],
  ctrl.updateClient
);

// Solo admin puede eliminar clientes
router.delete(
  '/:id',
  authorize('admin'),
  [param('id').isInt({ min: 1 }), validate],
  ctrl.deleteClient
);

export default router;
