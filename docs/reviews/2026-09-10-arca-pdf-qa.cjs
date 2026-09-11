const fs=require('fs'),path=require('path');
const {generateFiscalPdf}=require('../../src/utils/afip.pdf');
const {buildDetail}=require('../../src/services/afip.protocol');
const p={tipoComprobante:6,concepto:1,ivaAlicuota:21,docTipo:96,docNro:'30123456',condicionIvaReceptor:5,totalAmount:3630,receptorNombre:'Cliente de prueba - Asociación Deportiva',receptorDomicilio:'Av. de prueba 123, San Miguel de Tucumán, Tucumán'};
const record={status:'sent',environment:'homo',snapshot:{kind:'invoice',type:6,pv:9998,cuit:'20111111112',params:p,detail:buildDetail(p,1,'2026-09-10'),issuer:{company_name:'INDIANS - Emisor de prueba',company_address:'Domicilio de prueba 123, San Miguel de Tucumán',company_iva_condition:'Responsable Inscripto',company_iibb:'Exento',company_activity_start:'01/01/2020'},source:{reference:'QA-ARCA-001',items:Array.from({length:30},(_,i)=>({description:'Prenda deportiva '+(i+1)+' - Camiseta personalizada, talle M',quantity:1,unitPrice:121,total:121})),extras:[],discount:0}},response:{authorization:{CAE:'71234567890123',CAEFchVto:'20260930'}}};
fs.mkdirSync(path.join(__dirname,'../../tmp/pdfs'),{recursive:true});
generateFiscalPdf(record).then(b=>{fs.writeFileSync(path.join(__dirname,'../../tmp/pdfs/arca-qa.pdf'),b);console.log('PDF_QA_OK')}).catch(e=>{console.error(e);process.exitCode=1});
