import { api, API, loginAs, auth } from './helpers';
import * as emailService from '../../utils/email.service';
import {
  NewsletterSubscriber,
  NewsletterCampaign,
  NewsletterCampaignRecipient,
  StoreCustomer,
  Settings,
} from '../../models';
import {
  __setResendClientForTests,
  handleResendEvent,
  processNewsletterQueue,
} from '../../services/newsletterSender.service';
import { NEWSLETTER_IMPORT_SETTING_KEY } from '../../config/newsletter';

/*
 * Newsletter — suscripción pública con doble opt-in, baja (link y one-click
 * RFC 8058), casilla del registro, permisos del panel, campañas (validación,
 * vista previa, envío por lotes con headers de baja) y eventos de Resend.
 */

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
// Dominio "real" a propósito: los de prueba (@test.local) los bloquea mailGuard
// y acá se ejercita el camino de entrega (contra un cliente de Resend falso).
const email = (tag: string) => `nl.${tag}.${uniq()}@indians-qa.com.ar`;

/** Captura el link de confirmación del mail (el token en claro solo viaja ahí). */
function spyConfirmation() {
  const calls: string[] = [];
  const spy = jest
    .spyOn(emailService, 'sendNewsletterConfirmationEmail')
    .mockImplementation(async (_to, _name, url) => { calls.push(url); });
  return { calls, spy };
}

const flush = () => new Promise((r) => setTimeout(r, 50));

describe('Newsletter — suscripción pública', () => {
  afterEach(() => jest.restoreAllMocks());

  it('alta desde el footer: queda pendiente, confirma por link y responde igual si ya estaba', async () => {
    const { calls } = spyConfirmation();
    const addr = email('footer');

    const res = await api().post(`${API}/store/newsletter/subscribe`).send({ email: addr });
    expect(res.status).toBe(200);
    const genericMessage = res.body.data.message;
    await flush();

    const sub = await NewsletterSubscriber.findOne({ where: { email: addr } });
    expect(sub?.status).toBe('pending');
    expect(sub?.source).toBe('footer');
    expect(sub?.confirm_token_hash).toHaveLength(64);
    expect(calls).toHaveLength(1);

    const token = new URL(calls[0]).searchParams.get('token')!;
    const conf = await api().get(`${API}/store/newsletter/confirm?token=${token}`);
    expect(conf.status).toBe(200);
    await sub!.reload();
    expect(sub!.status).toBe('subscribed');

    // Segundo clic: no es error.
    expect((await api().get(`${API}/store/newsletter/confirm?token=${token}`)).status).toBe(200);

    // Ya suscripto: misma respuesta (no revela que la dirección existe) y sin otro mail.
    const again = await api().post(`${API}/store/newsletter/subscribe`).send({ email: addr });
    expect(again.status).toBe(200);
    expect(again.body.data.message).toBe(genericMessage);
    await flush();
    expect(calls).toHaveLength(1);
  });

  it('no reenvía la confirmación en ráfaga (antirrebote)', async () => {
    const { calls } = spyConfirmation();
    const addr = email('burst');
    await api().post(`${API}/store/newsletter/subscribe`).send({ email: addr });
    await api().post(`${API}/store/newsletter/subscribe`).send({ email: addr });
    await flush();
    expect(calls).toHaveLength(1);
  });

  it('token de confirmación inválido → 400; email inválido → 422/400', async () => {
    const bad = await api().get(`${API}/store/newsletter/confirm?token=${'a'.repeat(48)}`);
    expect(bad.status).toBe(400);
    const invalid = await api().post(`${API}/store/newsletter/subscribe`).send({ email: 'no-es-un-mail' });
    expect([400, 422]).toContain(invalid.status);
  });

  it('baja por link (GET muestra el email enmascarado) y por one-click RFC 8058', async () => {
    const a = await NewsletterSubscriber.create({
      email: email('unsub'), source: 'admin', status: 'subscribed', unsubscribe_token: `tok${uniq()}aaaaaaaaaaaaaaaa`,
    });
    const info = await api().get(`${API}/store/newsletter/unsubscribe/${a.unsubscribe_token}`);
    expect(info.status).toBe(200);
    expect(info.body.data.subscribed).toBe(true);
    expect(info.body.data.email).toContain('***');
    expect(info.body.data.email).not.toBe(a.email);

    // Cliente de correo: POST form-urlencoded, sin JS ni sesión.
    const oneClick = await api()
      .post(`${API}/store/newsletter/unsubscribe/${a.unsubscribe_token}`)
      .type('form')
      .send('List-Unsubscribe=One-Click');
    expect(oneClick.status).toBe(200);
    await a.reload();
    expect(a.status).toBe('unsubscribed');
    expect(a.unsubscribe_reason).toBe('one_click');

    // Idempotente.
    expect((await api().post(`${API}/store/newsletter/unsubscribe/${a.unsubscribe_token}`)).status).toBe(200);
    expect((await api().get(`${API}/store/newsletter/unsubscribe/${'z'.repeat(40)}`)).status).toBe(404);
  });

  it('registro con la casilla tildada: se activa al verificar la cuenta', async () => {
    jest.spyOn(emailService, 'sendVerificationEmail').mockResolvedValue(undefined);
    const addr = email('register');
    const reg = await api().post(`${API}/store/auth/register`).send({
      name: 'Ana QA', email: addr, password: 'Secreta123', accept_terms: true, newsletter_opt_in: true,
    });
    expect(reg.status).toBe(201);
    const sub = await NewsletterSubscriber.findOne({ where: { email: addr } });
    expect(sub?.status).toBe('pending');
    expect(sub?.source).toBe('register');

    const customer = await StoreCustomer.findOne({ where: { email: addr } });
    const ver = await api().get(`${API}/store/auth/verify-email?token=${customer!.verification_token}`);
    expect(ver.status).toBe(200);
    await sub!.reload();
    expect(sub!.status).toBe('subscribed');
    expect(sub!.store_customer_id).toBe(customer!.id);
  });

  it('registro SIN la casilla: no crea suscriptor', async () => {
    jest.spyOn(emailService, 'sendVerificationEmail').mockResolvedValue(undefined);
    const addr = email('noopt');
    const reg = await api().post(`${API}/store/auth/register`).send({
      name: 'Beto QA', email: addr, password: 'Secreta123', accept_terms: true,
    });
    expect(reg.status).toBe(201);
    expect(await NewsletterSubscriber.findOne({ where: { email: addr } })).toBeNull();
  });
});

describe('Newsletter — panel', () => {
  let admin: string;
  let designer: string;

  beforeAll(async () => {
    admin = await loginAs('admin');
    designer = await loginAs('designer');
  });

  afterEach(() => {
    delete process.env.MAIL_TEST_DELIVER;
    __setResendClientForTests(null);
  });

  it('permisos: admin/billing/designer sí; seller y workshop no', async () => {
    // Un login nuevo invalida la sesión anterior del mismo usuario (sesión
    // única del panel): se reutiliza el token del diseñador del beforeAll.
    const billing = await loginAs('billing');
    expect((await api().get(`${API}/newsletter/subscribers`).set(...auth(billing))).status).toBe(200);
    expect((await api().get(`${API}/newsletter/subscribers`).set(...auth(designer))).status).toBe(200);
    for (const role of ['seller', 'workshop'] as const) {
      const t = await loginAs(role);
      expect((await api().get(`${API}/newsletter/campaigns`).set(...auth(t))).status).toBe(403);
    }
    // Importación y borrado definitivo: solo admin.
    expect((await api().post(`${API}/newsletter/subscribers/import-customers`).set(...auth(designer))).status).toBe(403);
  });

  it('alta manual; no reactiva a quien se dio de baja', async () => {
    const addr = email('manual');
    const add = await api().post(`${API}/newsletter/subscribers`).set(...auth(admin)).send({ email: addr, name: 'Manual' });
    expect(add.status).toBe(201);
    expect(add.body.data.status).toBe('subscribed');

    const dup = await api().post(`${API}/newsletter/subscribers`).set(...auth(admin)).send({ email: addr });
    expect(dup.status).toBe(409);

    await api().patch(`${API}/newsletter/subscribers/${add.body.data.id}/unsubscribe`).set(...auth(admin));
    const back = await api().post(`${API}/newsletter/subscribers`).set(...auth(admin)).send({ email: addr });
    expect(back.status).toBe(409);

    const stats = await api().get(`${API}/newsletter/subscribers/stats`).set(...auth(admin));
    expect(stats.status).toBe(200);
    expect(stats.body.data.by_status.unsubscribed).toBeGreaterThanOrEqual(1);
    expect(stats.body.data.audiences).toHaveProperty('buyers');
  });

  it('importación de clientes: una sola vez, solo cuentas verificadas', async () => {
    await Settings.destroy({ where: { key: NEWSLETTER_IMPORT_SETTING_KEY } });
    const verified = await StoreCustomer.create({ name: 'Cli Ver', email: email('imp-ok'), email_verified: true });
    const unverified = await StoreCustomer.create({ name: 'Cli NoVer', email: email('imp-no'), email_verified: false });

    const first = await api().post(`${API}/newsletter/subscribers/import-customers`).set(...auth(admin));
    expect(first.status).toBe(200);
    const sub = await NewsletterSubscriber.findOne({ where: { email: verified.email } });
    expect(sub?.status).toBe('subscribed');
    expect(sub?.source).toBe('existing_customer');
    expect(await NewsletterSubscriber.findOne({ where: { email: unverified.email } })).toBeNull();

    const second = await api().post(`${API}/newsletter/subscribers/import-customers`).set(...auth(admin));
    expect(second.status).toBe(409);
  });

  it('valida bloques: link javascript: → 400', async () => {
    const res = await api().post(`${API}/newsletter/campaigns`).set(...auth(designer)).send({
      name: 'Mala', subject: 'x', blocks: [{ type: 'button', label: 'Ir', url: 'javascript:alert(1)' }],
    });
    expect(res.status).toBe(400);
  });

  it('crea, previsualiza, envía por lotes con headers de baja y registra eventos', async () => {
    // Un suscripto que recibe y uno dado de baja que NO.
    const live = await NewsletterSubscriber.create({
      email: email('live'), name: 'Lucía Gómez', source: 'admin', status: 'subscribed', unsubscribe_token: `live${uniq()}bbbbbbbbbbbbbbbb`,
    });
    const gone = await NewsletterSubscriber.create({
      email: email('gone'), source: 'admin', status: 'subscribed', unsubscribe_token: `gone${uniq()}cccccccccccccccc`,
    });

    const create = await api().post(`${API}/newsletter/campaigns`).set(...auth(designer)).send({
      name: `Campaña QA ${uniq()}`,
      subject: 'Hola {{nombre}}, llegó el invierno',
      preheader: 'Nueva colección',
      audience: 'all',
      blocks: [
        { type: 'heading', text: 'Hola {{nombre}}' },
        { type: 'text', text: 'Mirá la **nueva** colección' },
        { type: 'button', label: 'Ver tienda', url: 'https://indians.com.ar/tienda' },
      ],
    });
    expect(create.status).toBe(201);
    const id = create.body.data.id;
    expect(create.body.data.status).toBe('draft');

    const preview = await api().post(`${API}/newsletter/campaigns/preview`).set(...auth(designer)).send(create.body.data);
    expect(preview.status).toBe(200);
    expect(preview.body.data.html).toContain('Hola María');
    expect(preview.body.data.subject).toBe('Hola María, llegó el invierno');

    const send = await api().post(`${API}/newsletter/campaigns/${id}/send`).set(...auth(designer)).send({});
    expect(send.status).toBe(200);
    expect(send.body.data.status).toBe('sending');
    expect(send.body.data.total_recipients).toBeGreaterThanOrEqual(2);

    // Ya no se puede editar ni volver a arrancar.
    expect((await api().put(`${API}/newsletter/campaigns/${id}`).set(...auth(designer)).send({ subject: 'otro' })).status).toBe(409);
    expect((await api().post(`${API}/newsletter/campaigns/${id}/send`).set(...auth(designer)).send({})).status).toBe(409);

    // Baja después de armar la lista: el envío la respeta.
    await gone.update({ status: 'unsubscribed' });

    const sentPayloads: any[] = [];
    let n = 0;
    __setResendClientForTests({
      batch: {
        send: async (payload: any[]) => {
          sentPayloads.push(...payload);
          return { data: { data: payload.map(() => ({ id: `re_${id}_${++n}` })) }, error: null, headers: null };
        },
      },
    });
    process.env.MAIL_TEST_DELIVER = '1';

    // Puede haber otras campañas en envío de corridas previas: se procesa hasta vaciar esta.
    for (let i = 0; i < 20; i++) {
      await processNewsletterQueue();
      const c = await NewsletterCampaign.findByPk(id);
      if (c?.status === 'sent') break;
    }
    const campaign = await NewsletterCampaign.findByPk(id);
    expect(campaign?.status).toBe('sent');

    const liveRow = await NewsletterCampaignRecipient.findOne({ where: { campaign_id: id, subscriber_id: live.id } });
    expect(liveRow?.status).toBe('sent');
    expect(liveRow?.resend_email_id).toMatch(/^re_/);
    const goneRow = await NewsletterCampaignRecipient.findOne({ where: { campaign_id: id, subscriber_id: gone.id } });
    expect(goneRow?.status).toBe('skipped');

    const mail = sentPayloads.find((p) => p.to === live.email);
    expect(mail.subject).toBe('Hola Lucía, llegó el invierno');
    expect(mail.html).toContain('Hola Lucía');
    expect(mail.html).toContain(`/newsletter/baja/${live.unsubscribe_token}?c=${id}`);
    expect(mail.headers['List-Unsubscribe']).toContain(`/api/v1/store/newsletter/unsubscribe/${live.unsubscribe_token}?c=${id}`);
    expect(mail.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(sentPayloads.some((p) => p.to === gone.email)).toBe(false);

    // Eventos de Resend: apertura, clic y denuncia de spam (bloquea la dirección).
    await handleResendEvent({ type: 'email.delivered', data: { email_id: liveRow!.resend_email_id! } });
    await handleResendEvent({ type: 'email.clicked', data: { email_id: liveRow!.resend_email_id! } });
    await handleResendEvent({ type: 'email.complained', data: { email_id: liveRow!.resend_email_id! } });
    await liveRow!.reload();
    expect(liveRow!.delivered_at).not.toBeNull();
    expect(liveRow!.opened_at).not.toBeNull();
    await live.reload();
    expect(live.status).toBe('complained');

    const detail = await api().get(`${API}/newsletter/campaigns/${id}`).set(...auth(admin));
    expect(detail.body.data.stats.sent).toBeGreaterThanOrEqual(1);
    expect(detail.body.data.stats.clicked).toBe(1);
    expect(detail.body.data.stats.complained).toBe(1);
    expect(detail.body.data.html_snapshot).toBeUndefined();

    // Una enviada no se borra (queda como historial); duplicar sí.
    expect((await api().delete(`${API}/newsletter/campaigns/${id}`).set(...auth(admin))).status).toBe(409);
    const dup = await api().post(`${API}/newsletter/campaigns/${id}/duplicate`).set(...auth(admin));
    expect(dup.status).toBe(201);
    expect(dup.body.data.status).toBe('draft');
    expect((await api().delete(`${API}/newsletter/campaigns/${dup.body.data.id}`).set(...auth(admin))).status).toBe(200);
  });

  it('programada a futuro queda scheduled y se puede desprogramar', async () => {
    await NewsletterSubscriber.create({
      email: email('sched'), source: 'admin', status: 'subscribed', unsubscribe_token: `sch${uniq()}dddddddddddddddd`,
    });
    const c = await api().post(`${API}/newsletter/campaigns`).set(...auth(admin)).send({
      name: 'Programada', subject: 'Pronto', blocks: [{ type: 'text', text: 'Hola' }],
    });
    const at = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();
    const send = await api().post(`${API}/newsletter/campaigns/${c.body.data.id}/send`).set(...auth(admin)).send({ scheduled_at: at });
    expect(send.body.data.status).toBe('scheduled');
    const cancel = await api().post(`${API}/newsletter/campaigns/${c.body.data.id}/cancel`).set(...auth(admin));
    expect(cancel.body.data.status).toBe('draft');
    await api().delete(`${API}/newsletter/campaigns/${c.body.data.id}`).set(...auth(admin));
  });

  it('webhook de Resend sin firma → 401', async () => {
    const res = await api().post(`${API}/newsletter/webhook/resend`).send({ type: 'email.bounced', data: { email_id: 'x' } });
    expect(res.status).toBe(401);
  });

  it('comprador logueado: activa y desactiva desde "Mis datos"', async () => {
    const addr = email('me');
    const customer = await StoreCustomer.create({ name: 'Yo QA', email: addr, email_verified: true });
    const jwt = await import('jsonwebtoken');
    const token = jwt.sign(
      { sub: customer.id, email: addr, type: 'store_customer', session_version: 0 },
      process.env.STORE_JWT_SECRET || process.env.JWT_SECRET!,
      { expiresIn: '5m' }
    );
    const on = await api().put(`${API}/store/me/newsletter`).set('Authorization', `Bearer ${token}`).send({ subscribed: true });
    expect(on.status).toBe(200);
    expect(on.body.data.subscribed).toBe(true);
    const off = await api().put(`${API}/store/me/newsletter`).set('Authorization', `Bearer ${token}`).send({ subscribed: false });
    expect(off.body.data.subscribed).toBe(false);
    const sub = await NewsletterSubscriber.findOne({ where: { email: addr } });
    expect(sub?.unsubscribe_reason).toBe('account');
  });
});
