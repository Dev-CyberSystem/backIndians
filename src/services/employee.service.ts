/**
 * Legajo de empleados + histórico de novedades.
 *
 * - Módulo restringido a `admin` en las rutas (datos de nómina).
 * - Baja = lógica (`active=false` + `termination_date`). El borrado real existe
 *   pero queda para `admin` y no se usa en la operación normal.
 * - Las novedades (`employee_events`) son un registro pensado como inmutable:
 *   se crean y se listan; no se editan; solo se borran (admin) si se cargaron
 *   por error. Una novedad `salary_change` actualiza `current_remuneration` del
 *   empleado en la misma transacción y deja el snapshot del sueldo anterior.
 */

import { Op } from 'sequelize';
import { sequelize } from '../config/db';
import { Employee, EmployeeEvent, User } from '../models';
import type { EmployeeEventType } from '../models/EmployeeEvent';
import { AppError } from '../middlewares/errorHandler';

export interface EmployeeInput {
  full_name: string;
  dni: string;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  hire_date: string;
  termination_date?: string | null;
  current_remuneration?: number | string | null;
  sector?: string | null;
  notes?: string | null;
}

export interface EmployeeEventInput {
  type: EmployeeEventType;
  title: string;
  body?: string | null;
  event_date?: string | null;
  amount?: number | string | null;
}

const EVENT_TYPES: EmployeeEventType[] = [
  'salary_change', 'sanction', 'notification', 'sick_leave',
  'leave', 'onboarding', 'offboarding', 'other',
];

const AUTHOR_INCLUDE = { model: User, as: 'author', attributes: ['id', 'name'] };

function cleanStr(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
}

/** Deja solo dígitos. */
function normalizeDni(raw: string): string {
  return (raw || '').replace(/\D/g, '');
}

function resolveDni(raw: string | null | undefined): string {
  const digits = normalizeDni(String(raw ?? ''));
  if (digits.length < 7 || digits.length > 9) {
    throw new AppError('El DNI debe tener entre 7 y 9 dígitos', 400);
  }
  return digits;
}

/** Valida 'YYYY-MM-DD'. Devuelve la cadena o lanza. */
function resolveDate(raw: string | null | undefined, field: string): string {
  const s = String(raw ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
    throw new AppError(`Fecha inválida en "${field}" (formato AAAA-MM-DD)`, 400);
  }
  return s;
}

function resolveAmount(raw: number | string | null | undefined): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = typeof raw === 'string' ? parseFloat(raw) : raw;
  if (!Number.isFinite(n) || n < 0) throw new AppError('El monto no es válido', 400);
  return Math.round(n * 100) / 100;
}

// ─── Empleados ──────────────────────────────────────────────────────────────

export async function listEmployees(opts: {
  search?: string;
  sector?: string;
  includeInactive?: boolean;
  page?: number;
  limit?: number;
} = {}) {
  const term = opts.search?.trim();
  const sector = opts.sector?.trim();
  const limit = Math.min(Math.max(opts.limit ?? 24, 1), 200);
  const page = Math.max(opts.page ?? 1, 1);
  const offset = (page - 1) * limit;

  const where: Record<symbol | string, unknown> = {
    ...(opts.includeInactive ? {} : { active: true }),
    ...(sector ? { sector } : {}),
  };

  if (term) {
    const digits = normalizeDni(term);
    where[Op.or] = [
      { full_name: { [Op.like]: `%${term}%` } },
      { email: { [Op.like]: `%${term}%` } },
      ...(digits ? [{ dni: { [Op.like]: `%${digits}%` } }] : []),
    ];
  }

  const { rows, count } = await Employee.findAndCountAll({
    where,
    order: [['full_name', 'ASC']],
    limit,
    offset,
  });

  return { rows, count, page, limit };
}

/** Sectores distintos ya cargados (para poblar el filtro del frontend). */
export async function listEmployeeSectors(): Promise<string[]> {
  const rows = (await Employee.findAll({
    attributes: ['sector'],
    where: { sector: { [Op.ne]: null } },
    group: ['sector'],
    order: [['sector', 'ASC']],
    raw: true,
  })) as unknown as Array<{ sector: string | null }>;
  return rows.map((r) => r.sector).filter((s): s is string => !!s && s.trim() !== '');
}

export async function getEmployee(id: number): Promise<Employee> {
  const employee = await Employee.findByPk(id, {
    include: [
      { model: EmployeeEvent, as: 'events', include: [AUTHOR_INCLUDE] },
    ],
    order: [
      [{ model: EmployeeEvent, as: 'events' }, 'event_date', 'DESC'],
      [{ model: EmployeeEvent, as: 'events' }, 'createdAt', 'DESC'],
    ],
  });
  if (!employee) throw new AppError('El empleado no existe', 404);
  return employee;
}

export async function createEmployee(input: EmployeeInput, userId?: number): Promise<Employee> {
  const full_name = input.full_name?.trim();
  if (!full_name) throw new AppError('El nombre completo es obligatorio', 400);

  const dni = resolveDni(input.dni);
  const hire_date = resolveDate(input.hire_date, 'fecha de ingreso');
  const termination_date = input.termination_date
    ? resolveDate(input.termination_date, 'fecha de egreso')
    : null;

  return sequelize.transaction(async (t) => {
    const dup = await Employee.findOne({ where: { dni }, transaction: t });
    if (dup) throw new AppError(`Ya existe un empleado con el DNI ${dni} (${dup.full_name})`, 409);

    return Employee.create(
      {
        full_name,
        dni,
        address: cleanStr(input.address),
        email: cleanStr(input.email),
        phone: cleanStr(input.phone),
        hire_date,
        termination_date,
        current_remuneration: resolveAmount(input.current_remuneration),
        sector: cleanStr(input.sector),
        notes: cleanStr(input.notes),
        active: true,
        created_by_user_id: userId ?? null,
        updated_by_user_id: userId ?? null,
      },
      { transaction: t }
    );
  });
}

export async function updateEmployee(
  id: number,
  input: Partial<EmployeeInput>,
  userId?: number
): Promise<Employee> {
  return sequelize.transaction(async (t) => {
    const employee = await Employee.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!employee) throw new AppError('El empleado no existe', 404);

    if (input.full_name !== undefined) {
      const full_name = input.full_name.trim();
      if (!full_name) throw new AppError('El nombre completo es obligatorio', 400);
      employee.full_name = full_name;
    }
    if (input.dni !== undefined) {
      const dni = resolveDni(input.dni);
      const dup = await Employee.findOne({ where: { dni, id: { [Op.ne]: id } }, transaction: t });
      if (dup) throw new AppError(`Ya existe un empleado con el DNI ${dni} (${dup.full_name})`, 409);
      employee.dni = dni;
    }
    if (input.hire_date !== undefined) employee.hire_date = resolveDate(input.hire_date, 'fecha de ingreso');
    if (input.termination_date !== undefined) {
      employee.termination_date = input.termination_date
        ? resolveDate(input.termination_date, 'fecha de egreso')
        : null;
    }
    if (input.current_remuneration !== undefined) {
      employee.current_remuneration = resolveAmount(input.current_remuneration);
    }
    if (input.address !== undefined) employee.address = cleanStr(input.address);
    if (input.email !== undefined) employee.email = cleanStr(input.email);
    if (input.phone !== undefined) employee.phone = cleanStr(input.phone);
    if (input.sector !== undefined) employee.sector = cleanStr(input.sector);
    if (input.notes !== undefined) employee.notes = cleanStr(input.notes);
    employee.updated_by_user_id = userId ?? employee.updated_by_user_id ?? null;

    await employee.save({ transaction: t });
    return employee;
  });
}

/**
 * Baja/alta lógica. Al dar de baja, si no viene `terminationDate` se usa hoy.
 * Al reactivar se limpia la fecha de egreso.
 */
export async function setEmployeeActive(
  id: number,
  active: boolean,
  terminationDate?: string | null
): Promise<Employee> {
  const employee = await Employee.findByPk(id);
  if (!employee) throw new AppError('El empleado no existe', 404);

  employee.active = active;
  if (!active) {
    employee.termination_date = terminationDate
      ? resolveDate(terminationDate, 'fecha de egreso')
      : new Date().toISOString().slice(0, 10);
  } else {
    employee.termination_date = null;
  }
  await employee.save();
  return employee;
}

export async function deleteEmployee(id: number): Promise<void> {
  const employee = await Employee.findByPk(id);
  if (!employee) throw new AppError('El empleado no existe', 404);
  await employee.destroy(); // employee_events cae por FK ON DELETE CASCADE
}

// ─── Novedades ─────────────────────────────────────────────────────────────

export async function addEmployeeEvent(
  employeeId: number,
  input: EmployeeEventInput,
  userId?: number
): Promise<EmployeeEvent> {
  if (!EVENT_TYPES.includes(input.type)) {
    throw new AppError('Tipo de novedad inválido', 400);
  }
  const title = input.title?.trim();
  if (!title) throw new AppError('El título de la novedad es obligatorio', 400);

  const event_date = input.event_date
    ? resolveDate(input.event_date, 'fecha de la novedad')
    : new Date().toISOString().slice(0, 10);

  return sequelize.transaction(async (t) => {
    const employee = await Employee.findByPk(employeeId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!employee) throw new AppError('El empleado no existe', 404);

    let amount: number | null = null;
    let previous_amount: number | null = null;

    if (input.type === 'salary_change') {
      amount = resolveAmount(input.amount);
      if (amount === null) {
        throw new AppError('Una novedad de cambio de sueldo requiere el nuevo monto', 400);
      }
      previous_amount = employee.current_remuneration ?? null;
      employee.current_remuneration = amount;
      employee.updated_by_user_id = userId ?? employee.updated_by_user_id ?? null;
      await employee.save({ transaction: t });
    } else {
      amount = resolveAmount(input.amount); // permitido informativamente en otros tipos
    }

    const event = await EmployeeEvent.create(
      {
        employee_id: employeeId,
        type: input.type,
        title,
        body: cleanStr(input.body),
        event_date,
        amount,
        previous_amount,
        created_by_user_id: userId ?? null,
      },
      { transaction: t }
    );

    return EmployeeEvent.findByPk(event.id, { include: [AUTHOR_INCLUDE], transaction: t }) as Promise<EmployeeEvent>;
  });
}

export async function listEmployeeEvents(employeeId: number): Promise<EmployeeEvent[]> {
  const employee = await Employee.findByPk(employeeId);
  if (!employee) throw new AppError('El empleado no existe', 404);
  return EmployeeEvent.findAll({
    where: { employee_id: employeeId },
    include: [AUTHOR_INCLUDE],
    order: [['event_date', 'DESC'], ['createdAt', 'DESC']],
  });
}

/**
 * Borra una novedad cargada por error (solo `admin` vía ruta). NO revierte el
 * `current_remuneration` de un `salary_change`: si hace falta corregir el sueldo,
 * se carga una nueva novedad de cambio de sueldo con el valor correcto.
 */
export async function deleteEmployeeEvent(employeeId: number, eventId: number): Promise<void> {
  const event = await EmployeeEvent.findOne({ where: { id: eventId, employee_id: employeeId } });
  if (!event) throw new AppError('La novedad no existe', 404);
  await event.destroy();
}
