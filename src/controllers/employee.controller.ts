import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as employeeService from '../services/employee.service';

export async function list(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(
      parseInt((req.query.limit ?? req.query.per_page) as string) || 24,
      200
    );
    const { rows, count } = await employeeService.listEmployees({
      search: (req.query.search as string) || undefined,
      sector: (req.query.sector as string) || undefined,
      includeInactive: req.query.include_inactive === 'true',
      page,
      limit,
    });
    res.json({ success: true, data: rows, meta: { page, limit, total: count } });
  } catch (err) { next(err); }
}

export async function sectors(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, data: await employeeService.listEmployeeSectors() });
  } catch (err) { next(err); }
}

export async function getOne(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const employee = await employeeService.getEmployee(parseInt(req.params.id));
    res.json({ success: true, data: employee });
  } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const employee = await employeeService.createEmployee(req.body, req.user?.id);
    res.status(201).json({ success: true, data: employee });
  } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const employee = await employeeService.updateEmployee(
      parseInt(req.params.id),
      req.body,
      req.user?.id
    );
    res.json({ success: true, data: employee });
  } catch (err) { next(err); }
}

export async function setStatus(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const active = req.body.active === true || req.body.active === 'true';
    const employee = await employeeService.setEmployeeActive(
      parseInt(req.params.id),
      active,
      req.body.termination_date ?? null
    );
    res.json({ success: true, data: employee });
  } catch (err) { next(err); }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await employeeService.deleteEmployee(parseInt(req.params.id));
    res.json({ success: true, data: { message: 'Empleado eliminado' } });
  } catch (err) { next(err); }
}

// ─── Novedades ─────────────────────────────────────────────────────────────

export async function listEvents(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const events = await employeeService.listEmployeeEvents(parseInt(req.params.id));
    res.json({ success: true, data: events });
  } catch (err) { next(err); }
}

export async function addEvent(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const event = await employeeService.addEmployeeEvent(
      parseInt(req.params.id),
      req.body,
      req.user?.id
    );
    res.status(201).json({ success: true, data: event });
  } catch (err) { next(err); }
}

export async function removeEvent(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await employeeService.deleteEmployeeEvent(
      parseInt(req.params.id),
      parseInt(req.params.eventId)
    );
    res.json({ success: true, data: { message: 'Novedad eliminada' } });
  } catch (err) { next(err); }
}
