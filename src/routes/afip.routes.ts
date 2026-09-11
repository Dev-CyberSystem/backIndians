import { Router, Request, Response, NextFunction } from "express";
import { body, param } from "express-validator";
import { authenticate } from "../middlewares/auth";
import { authorize } from "../middlewares/authorize";
import { validate } from "../middlewares/validate";
import * as ctrl from "../controllers/afip.controller";
import * as fiscal from "../services/afip.service";
import { AfipDocument, AfipTarget } from "../models/AfipDocument";
import { generateFiscalPdf } from "../utils/afip.pdf";

const router = Router();
router.use(authenticate);

const sendValidation = [
  body("tipoComprobante")
    .isIn([1, 6, 11])
    .withMessage("tipoComprobante inválido"),
  body("concepto").isInt({ min: 1, max: 3 }).withMessage("concepto inválido"),
  body("ivaAlicuota").isIn([0, 10.5, 21]).withMessage("ivaAlicuota inválida"),
  body("docTipo").isIn([80, 96]).withMessage("Usar CUIT o DNI"),
  body("docNro").isString().withMessage("docNro requerido"),
  body("condicionIvaReceptor")
    .isInt({ min: 1 })
    .withMessage("condicionIvaReceptor requerido"),
  body("receptorNombre").optional().isString().isLength({ max: 200 }),
  body("receptorDomicilio").optional().isString().isLength({ max: 500 }),
  body("ivaTratamiento").optional().isIn(["gravado", "exento"]),
  ...["fechaServicioDesde", "fechaServicioHasta", "fechaVencimientoPago"].map(
    (k) =>
      body(k).optional().isDate({ format: "YYYY-MM-DD", strictMode: true }),
  ),
  validate,
];

router.post(
  "/invoices/:id/afip",
  authorize("admin", "billing"),
  [param("id").isInt({ min: 1 }), ...sendValidation],
  ctrl.sendInvoice,
);

router.post(
  "/catalog/invoices/:id/afip",
  authorize("admin", "billing"),
  [param("id").isInt({ min: 1 }), ...sendValidation],
  ctrl.sendCatalogInvoice,
);

router.post(
  "/store/orders/:id/afip",
  authorize("admin", "billing"),
  [param("id").isInt({ min: 1 }), ...sendValidation],
  ctrl.sendStoreOrder,
);

router.get("/afip/stats", authorize("admin", "billing"), ctrl.afipStats);

router.get(
  "/afip/config",
  authorize("admin", "billing"),
  async (_req, res, next) => {
    try {
      res.json(await fiscal.getAfipConfig());
    } catch (e) {
      next(e);
    }
  },
);
router.get(
  "/afip/attention",
  authorize("admin", "billing"),
  async (_req, res, next) => {
    try {
      res.json(await fiscal.getFiscalAttention());
    } catch (e) {
      next(e);
    }
  },
);
router.get(
  "/afip/targets/:target/:id/context",
  authorize("admin", "billing"),
  [
    param("target").isIn(["invoice", "catalogInvoice", "storeOrder"]),
    param("id").isInt({ min: 1 }),
    validate,
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(
        await fiscal.getFiscalContext(
          req.params.target as AfipTarget,
          Number(req.params.id),
        ),
      );
    } catch (e) {
      next(e);
    }
  },
);
router.get(
  "/afip/targets/:target/:id",
  authorize("admin", "billing"),
  [
    param("target").isIn(["invoice", "catalogInvoice", "storeOrder"]),
    param("id").isInt({ min: 1 }),
    validate,
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(
        await fiscal.getDocuments(
          req.params.target as AfipTarget,
          Number(req.params.id),
        ),
      );
    } catch (e) {
      next(e);
    }
  },
);
router.get(
  "/afip/documents/:documentId/pdf",
  authorize("admin", "billing"),
  async (req, res, next) => {
    try {
      const doc = await AfipDocument.findByPk(req.params.documentId);
      if (!doc || doc.status !== "sent") {
        res.status(404).json({ error: "Comprobante autorizado no encontrado" });
        return;
      }
      const buffer = await generateFiscalPdf(doc);
      res
        .type("pdf")
        .setHeader(
          "Content-Disposition",
          'attachment; filename="arca-' +
            doc.snapshot.pv +
            "-" +
            doc.snapshot.detail.CbteDesde +
            '.pdf"',
        );
      res.send(buffer);
    } catch (e) {
      next(e);
    }
  },
);
router.post(
  "/afip/documents/:documentId/recover",
  authorize("admin", "billing"),
  async (req, res) => {
    try {
      res.json(await fiscal.recoverDocument(req.params.documentId));
    } catch (e: any) {
      res.status(422).json({ error: e.message });
    }
  },
);
router.post(
  "/afip/documents/:documentId/credit",
  authorize("admin", "billing"),
  [
    body("amount").isFloat({ gt: 0 }),
    body("reason").isString().trim().isLength({ min: 1, max: 500 }),
    body("key").isUUID(),
    validate,
  ],
  async (req: Request, res: Response) => {
    try {
      res.json(
        await fiscal.issueCredit(
          req.params.documentId,
          Number(req.body.amount),
          req.body.reason,
          req.body.key,
          (req as import("../types").AuthRequest).user?.id,
        ),
      );
    } catch (e: any) {
      res.status(422).json({ error: e.message });
    }
  },
);

export default router;
