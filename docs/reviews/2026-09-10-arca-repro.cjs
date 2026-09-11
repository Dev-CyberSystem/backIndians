// Regresión aislada actual: reemplaza el diagnóstico del servicio anterior.
// No carga configuración, DB, red ni certificados.
require('ts-node/register/transpile-only');
const assert=require('node:assert/strict');
const {buildTraXml,buildDetail,accepted,matches,validateParams}=require('../../src/services/afip.protocol');
const p={tipoComprobante:1,concepto:1,ivaAlicuota:21,docTipo:80,docNro:'20111111112',condicionIvaReceptor:1,totalAmount:121,receptorNombre:'QA',receptorDomicilio:'QA 123'};
assert.match(buildTraXml(new Date('2026-09-10T01:00:00Z')),/<generationTime>2026-09-10T00:50:00.000Z/);
assert.equal(accepted({FeDetResp:{FECAEDetResponse:[{Resultado:'A',CAE:'71234567890123',CAEFchVto:'20260930'}]}}).CAE,'71234567890123');
const detail=buildDetail(p,1,'2026-09-10');
assert.equal(matches(detail,{...detail,CbteTipo:1,PtoVta:1},1,1),true);
assert.equal(matches(detail,{...detail,CbteTipo:1,PtoVta:1,ImpTotal:122},1,1),false);
assert.equal(buildDetail({...p,tipoComprobante:11,ivaAlicuota:0},1).Iva,undefined);
assert.throws(()=>validateParams({...p,concepto:2},{company_iva_condition:'Responsable Inscripto'}));
console.log('ARCA_PROTOCOL_REGRESSION_OK (6 verificaciones; concurrencia y recuperación en afip.test.ts)');
