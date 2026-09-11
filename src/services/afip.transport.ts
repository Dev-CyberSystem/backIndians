import * as forge from "node-forge";
import * as soap from "soap";
import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "crypto";
import { sequelize } from "../config/db";
import { AfipAuthTicket } from "../models/AfipDocument";
import { getAllSettings } from "./settings.service";
import { buildTraXml } from "./afip.protocol";

export const WSAA_URL = {
  homo: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms?wsdl",
  prod: "https://wsaa.afip.gov.ar/ws/services/LoginCms?wsdl",
};
export const WSFE_URL = {
  homo: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx?wsdl",
  prod: "https://servicios1.afip.gov.ar/wsfev1/service.asmx?wsdl",
};
export async function assertAfipEnabled(): Promise<void> {
  if ((await getAllSettings()).afip_enabled !== "true")
    throw new Error("La facturación electrónica ARCA está deshabilitada");
}
/** Lock MySQL atado a una conexión. Timeout cero evita agotar el pool esperando. */
export async function withAfipLock<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const manager = (sequelize as any).connectionManager;
  const connection = await manager.getConnection({ type: "WRITE" });
  const name =
    "arca:" + createHash("sha256").update(key).digest("hex").slice(0, 58);
  const query = (sql: string) =>
    new Promise<any[]>((resolve, reject) =>
      connection.query(sql, [name], (err: any, rows: any[]) =>
        err ? reject(err) : resolve(rows),
      ),
    );
  let held = false;
  let broken = false;
  try {
    held =
      Number(
        (await query("SELECT GET_LOCK(?, 0) AS acquired"))[0]?.acquired,
      ) === 1;
    if (!held)
      throw new Error(
        "Hay otra operación ARCA en curso. Reintentar en unos segundos",
      );
    return await fn();
  } finally {
    try {
      if (
        held &&
        Number(
          (await query("SELECT RELEASE_LOCK(?) AS released"))[0]?.released,
        ) !== 1
      )
        broken = true;
    } catch {
      broken = true;
    }
    if (broken) await manager.destroyConnection(connection);
    else await manager.releaseConnection(connection);
  }
}
function tag(xml: string, name: string): string {
  const value = xml.match(
    new RegExp("<" + name + ">([\\s\\S]*?)</" + name + ">"),
  )?.[1];
  if (!value) throw new Error("Respuesta WSAA inválida: falta " + name);
  return value.trim();
}
const timeout = { timeout: 15000 };
async function ticket(env: "homo" | "prod") {
  const suffix = env === "homo" ? "_HOMO" : "_PROD";
  // Compatibilidad con credenciales existentes solo para producción.
  const cert64 =
    process.env["AFIP_CERT_BASE64" + suffix] ||
    (env === "prod" ? process.env.AFIP_CERT_BASE64 : "");
  const key64 =
    process.env["AFIP_KEY_BASE64" + suffix] ||
    (env === "prod" ? process.env.AFIP_KEY_BASE64 : "");
  if (!cert64 || !key64)
    throw new Error(
      "Faltan certificado y clave ARCA del ambiente " +
        env +
        " (AFIP_CERT_BASE64" +
        suffix +
        " / AFIP_KEY_BASE64" +
        suffix +
        ")",
    );
  const certPem = Buffer.from(cert64, "base64").toString("utf8");
  const keyPem = Buffer.from(key64, "base64").toString("utf8");
  const cert = forge.pki.certificateFromPem(certPem);
  const privateKey = forge.pki.privateKeyFromPem(keyPem);
  if (
    cert.validity.notBefore > new Date() ||
    cert.validity.notAfter <= new Date()
  )
    throw new Error("Certificado ARCA fuera de vigencia");
  if (
    (cert.publicKey as forge.pki.rsa.PublicKey).n.compareTo(privateKey.n) !== 0
  )
    throw new Error("Certificado y clave ARCA no corresponden");
  const id = createHash("sha256")
    .update(env + certPem)
    .digest("hex");
  const encryptionKey = createHash("sha256")
    .update("indians-arca-ticket-v1:" + keyPem)
    .digest();
  return withAfipLock("ticket:" + id, async () => {
    const cached = await AfipAuthTicket.findByPk(id);
    if (cached && new Date(cached.expires_at).getTime() > Date.now() + 10000) {
      try {
        const [iv, authTag, data] = cached.encrypted.split(".");
        const decipher = createDecipheriv(
          "aes-256-gcm",
          encryptionKey,
          Buffer.from(iv, "hex"),
        );
        decipher.setAuthTag(Buffer.from(authTag, "hex"));
        return JSON.parse(
          Buffer.concat([
            decipher.update(Buffer.from(data, "hex")),
            decipher.final(),
          ]).toString("utf8"),
        );
      } catch {
        throw new Error(
          "No se pudo recuperar el ticket ARCA cifrado; revisar credenciales",
        );
      }
    }
    if (cached && new Date(cached.expires_at).getTime() > Date.now())
      throw new Error("Ticket ARCA por vencer. Reintentar en 15 segundos");
    await assertAfipEnabled();
    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(buildTraXml(), "utf8");
    p7.addCertificate(cert);
    p7.addSigner({
      key: privateKey,
      certificate: cert,
      digestAlgorithm: forge.pki.oids.sha256,
      authenticatedAttributes: [],
    });
    p7.sign({ detached: false });
    let res: any;
    try {
      const client = await soap.createClientAsync(WSAA_URL[env], {
        wsdl_options: timeout,
      });
      await assertAfipEnabled();
      [res] = await client.loginCmsAsync(
        { in0: forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes()) },
        timeout,
      );
    } catch {
      throw new Error(
        "No se pudo autenticar con WSAA. Revisar certificado, autorización del servicio y conectividad del ambiente seleccionado",
      );
    }
    const xml = res?.loginCmsReturn || "";
    const value = { token: tag(xml, "token"), sign: tag(xml, "sign") };
    const expires_at = new Date(tag(xml, "expirationTime"));
    if (
      !Number.isFinite(expires_at.getTime()) ||
      expires_at.getTime() <= Date.now()
    )
      throw new Error("Ticket WSAA vencido o inválido");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
    const data = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    await AfipAuthTicket.upsert({
      id,
      expires_at,
      encrypted: [
        iv.toString("hex"),
        cipher.getAuthTag().toString("hex"),
        data.toString("hex"),
      ].join("."),
    });
    return value;
  });
}
export async function wsfe(env: "homo" | "prod", cuit: string) {
  await assertAfipEnabled();
  const auth = await ticket(env);
  const client = await soap.createClientAsync(WSFE_URL[env], {
    wsdl_options: timeout,
  });
  return {
    async call(method: string, args: any): Promise<any> {
      await assertAfipEnabled();
      try {
        const [response] = await (client as any)[method + "Async"](
          { Auth: { Token: auth.token, Sign: auth.sign, Cuit: cuit }, ...args },
          timeout,
        );
        return response?.[method + "Result"];
      } catch {
        // Los errores de transporte pueden contener request/config con Token/Sign.
        throw new Error(
          "No se pudo confirmar la respuesta de ARCA. Consultar/reintentar para recuperar el comprobante; no emitir por fuera hasta conciliar",
        );
      }
    },
  };
}
