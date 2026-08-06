# Flujo de Estados de Pedidos — Indians Textil

## Diagrama de flujo

```
                        ┌─────────────────────────────────────────────────────────┐
                        │                   CREACIÓN DEL PEDIDO                   │
                        │              (seller / billing / admin)                  │
                        └─────────────────────┬───────────────────────────────────┘
                                              │
                                              ▼
                              ┌───────────────────────────┐
                              │         PENDIENTE          │
                              │          pending           │
                              │  Cargado por el vendedor   │
                              └───────────────┬────────────┘
                                              │  billing / admin toman el pedido
                                              ▼
                              ┌───────────────────────────┐
                              │        EN REVISIÓN         │◄──────────────────────┐
                              │        under_review        │                       │
                              │  Admin/Billing lo revisa   │                       │
                              └───────────────┬────────────┘                       │
                                              │                                    │
                    ┌─────────────────────────┴─────────────────────────┐          │
                    │  Todo OK                                  Hay obs. │          │
                    ▼                                                    ▼          │
   ┌──────────────────────────────┐                   ┌─────────────────────────┐  │
   │      REVISIÓN DE TALLER      │                   │        OBSERVADO         │  │
   │       workshop_review        │                   │         observed         │  │
   │  Workshop lo revisa          │                   │  Seller corrige y        │  │
   └──────────────┬───────────────┘                   │  reenvía para revisión   │  │
                  │                                   └────────────┬────────────┘  │
       ┌──────────┴──────────┐                                     │               │
       │ Todo OK    Hay obs. │                                     │ Seller envía  │
       ▼            ▼        │                                     │ a revisión    │
  ┌──────────┐      └────────┘                                     │               │
  │   EN     │           │                                         └───────────────┘
  │PRODUCCIÓN│           │ observado — vuelve al seller
  │in_produc.│           │ (mismo estado "observed")
  └────┬─────┘           │
       │                 │ seller corrigue
       ▼                 │ y sube a under_review ───────────────────────────────────┘
  ┌──────────────────────────────┐
  │     CONTROL DE CALIDAD       │
  │       quality_check          │
  └──────────────┬───────────────┘
                 │
                 ▼
  ┌──────────────────────────────┐
  │            LISTO             │
  │            ready             │
  └──────────────────────────────┘
```

## Diagrama simplificado (camino feliz)

```
PENDIENTE → EN REVISIÓN → REVISIÓN DE TALLER → EN PRODUCCIÓN → CONTROL DE CALIDAD → LISTO
```

## Diagrama con observaciones

```
PENDIENTE → EN REVISIÓN ──┐
                          │ hay observaciones
                          ▼
                       OBSERVADO ← (desde Revisión de Taller también)
                          │
                          │ seller corrige
                          ▼
                       EN REVISIÓN (nuevamente)
                          │
                          │ ok
                          ▼
                    REVISIÓN DE TALLER
                          │
                          │ ok
                          ▼
                    EN PRODUCCIÓN → CONTROL DE CALIDAD → LISTO
```

---

## Tabla de transiciones por rol

| Estado actual       | Admin              | Billing                     | Workshop            | Seller             |
|---------------------|--------------------|-----------------------------|---------------------|--------------------|
| **Pendiente**        | En revisión, ❌    | En revisión                 | —                   | —                  |
| **En revisión**      | Observado, Rev. Taller, ❌ | Observado, Rev. Taller | —              | —                  |
| **Observado**        | En revisión, ❌    | —                           | —                   | En revisión        |
| **Rev. de taller**   | En prod., Observado, ❌ | —                      | En prod., Observado | —                  |
| **En producción**    | Control cal., ❌   | —                           | Control de calidad  | —                  |
| **Control calidad**  | Listo, ❌          | —                           | Listo               | —                  |
| **Listo**            | ❌                 | —                           | —                   | —                  |

> ❌ = puede cancelar  
> — = sin acceso a ese estado

---

## Estados y responsables

| Estado              | Código            | Responsable              | Acción                                      |
|---------------------|-------------------|--------------------------|---------------------------------------------|
| Pendiente           | `pending`         | Seller / Admin / Billing | Pedido recién cargado                        |
| En revisión         | `under_review`    | Admin / Billing          | Controlan que todo esté correcto             |
| Revisión de taller  | `workshop_review` | Workshop                 | Taller revisa antes de producir              |
| Observado           | `observed`        | Seller                   | Hay correcciones pendientes — seller las ve |
| En producción       | `in_production`   | Workshop                 | Taller produce las prendas                  |
| Control de calidad  | `quality_check`   | Workshop                 | Revisión final antes de entregar            |
| Listo               | `ready`           | —                        | Pedido terminado                             |
| Cancelado           | `cancelled`       | Admin                    | Pedido anulado (desde cualquier estado)     |

---

## Número de pedido

Formato: `PED-YYYYMMDD-0001`  
- Se reinicia cada día  
- El contador es correlativo dentro del día  
- Ejemplo: `PED-20260514-0001`, `PED-20260514-0002`, …

---

*Generado: 2026-05-14 | Indians Textil*
