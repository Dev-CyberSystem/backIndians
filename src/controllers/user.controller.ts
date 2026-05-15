import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as userService from '../services/user.service';

export async function listUsers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const users = await userService.listUsers();
    res.json({ success: true, data: users });
  } catch (err) { next(err); }
}

export async function createUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await userService.createUser(req.body);
    res.status(201).json({ success: true, data: user });
  } catch (err) { next(err); }
}

export async function updateUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await userService.updateUser(parseInt(req.params.id), req.body);
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
}

export async function deleteUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await userService.softDeleteUser(parseInt(req.params.id));
    res.json({ success: true, data: { message: 'Usuario desactivado' } });
  } catch (err) { next(err); }
}
