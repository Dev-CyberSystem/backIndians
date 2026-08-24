# 10 — Entrega entre sesiones

> Este documento se actualiza al final de cada sesión de trabajo importante. Refleja SOLO la sesión más reciente — no es un historial acumulado (para eso está `git log` y [08-DECISIONS.md](08-DECISIONS.md)).

---

## Última actualización: 2026-08-24 — Centro de ayuda de la tienda

Rama: `feature/centro-de-ayuda` en **frontIndians** (el backend no se tocó: es contenido y presentación). No mergeada, no releaseada.

### De dónde salió

El usuario trajo el documento *"INDIANS — Centro de ayuda completo v1.0"* (agosto 2026, 18 páginas: arquitectura, textos de atención, políticas de envíos/cambios/devoluciones/garantía/talles y especificaciones de implementación) y pidió adaptarlo a la sección de ayuda de la tienda.

La página `/tienda/ayuda` ya existía, con cuatro bloques (envíos, cambios, talles, FAQ). El trabajo real no fue escribir texto: fue **resolver las contradicciones** entre lo que el documento propone, lo que la página decía y lo que el sistema hace de verdad.

### Contradicciones encontradas (verificadas contra el código, no contra el documento)

| Documento | Sistema real | Resolución |
|---|---|---|
| Solo Mercado Pago | `StoreCheckoutPage.tsx:42` ofrece MP + efectivo + transferencia | Se publica "Mercado Pago" — **falta sacarlos del checkout** |
| No hay retiro en local | `shipping_type: 'pickup'` es el **default** del checkout y los T&C lo mencionan | Se mantiene el retiro: la ayuda lo describe |
| Cambios: 15 días hábiles | La ayuda publicaba 30 días corridos | Se adoptan los 15 días hábiles |
| Envío: 7 a 9 días hábiles | La ayuda publicaba 3-7 días + 24-48 h de despacho | Se adoptan los 7 a 9 días hábiles |
| Garantía: 6 meses | La ayuda no hablaba de garantía | Se publica la garantía legal de 6 meses (Ley 24.240) |
| No publicar tabla de talles genérica | Ya había una publicada | Se **mantienen** las tablas y se suma el instructivo de medición |

Las cuatro decisiones que no eran técnicas (pagos, plazos, talles, estructura de rutas) las tomó el usuario explícitamente.

### Qué se hizo

**Contenido separado de la UI**: `frontIndians/src/pages/store/help/helpContent.ts` — 11 categorías, 63 preguntas y la constante `HELP_POLICY` con los plazos publicados en un solo lugar. Se puede corregir un texto de atención sin tocar un componente.

**Página** (`StoreHelpPage.tsx`, reescrita): buscador que normaliza acentos, cuatro acciones rápidas, índice de categorías, política destacada por sección, pasos del cambio, tablas de talles y medición, canales de contacto reales tomados de Settings (`store_whatsapp`, `company_email`, `store_instagram`, `store_pickup_address`).

**Acordeones con `<details>` nativo** en vez de estado en React: trae teclado y semántica gratis, el navegador lo abre solo cuando el hash apunta adentro, y la respuesta se monta siempre (lo que hace válido el JSON-LD). De paso, sacó el `setState` dentro de un efecto que tenía la versión anterior.

**Deep links**: cada pregunta tiene ancla `#faq-<id>` con botón "copiar enlace" — para que atención mande la respuesta exacta. Las anclas viejas (`#envios`, `#cambios`, `#talles`) siguen funcionando, y `#faq`, que era el bloque único de la versión anterior y está en correos ya enviados, redirige a `#pedidos` en vez de quedar muerta.

**SEO**: `FaqJsonLd` nuevo en `components/seo/JsonLd.tsx` → emite `FAQPage` con las 63 preguntas.

**Consistencia**: el default de `store_announcement` en `StoreLayout` decía "Cambios sin cargo dentro de los 30 días" — se actualizó a los 15 días hábiles. Los links de Ayuda del footer se ampliaron (Centro de ayuda, Garantía, Contacto).

### Validación

- `tsc --noEmit` limpio · `npm run build` OK · Vitest **47/47** · ESLint sin errores nuevos (los 5 de `StoreLayout.tsx` son preexistentes: se contaron antes y después del cambio).
- Prueba en navegador real (Playwright, dev server): 11 secciones y 63 preguntas renderizadas, JSON-LD `FAQPage` presente, buscador filtrando (14 resultados para "talle", mensaje de sin resultados OK), deep link `#faq-cuanto-tarda` abriendo la respuesta correcta, alias `#faq` scrolleando, mobile 390px sin scroll horizontal.

### Qué falta (lo importante para la próxima sesión)

1. **El checkout contradice la ayuda**. La ayuda ya dice que se paga con Mercado Pago; el checkout sigue ofreciendo efectivo y transferencia. **No desplegar la ayuda sin resolver esto**, o un comprador puede pagar por transferencia y leer que no se aceptan transferencias. Sacarlos implica además tocar los T&C (sección 8), decidir qué pasa con `bank_transfer_*` en Settings y con la cuenta de caja de efectivo. Anotado en [09-CURRENT-STATUS.md](09-CURRENT-STATUS.md).
2. **Costo del primer cambio de talle**: sin definir (el texto hoy dice que se informa antes de confirmar). El documento recomienda el primero sin cargo.
3. **Medidas reales por producto**: las tablas publicadas son de referencia general.
4. Merge de `feature/centro-de-ayuda` y `npm run deploy` del frontend (FTP) — el backend no cambió.

### Cómo retomar

```bash
cd frontIndians && git checkout feature/centro-de-ayuda
npm run dev            # /tienda/ayuda
```

El contenido está todo en `src/pages/store/help/helpContent.ts`; los plazos, en `HELP_POLICY` al principio de ese archivo.
