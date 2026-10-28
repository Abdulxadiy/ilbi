import React, {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import AuthContext from '/src/context/authContext.js';
import {TenantProvider} from '/src/context/TenantContext.jsx';
import ReceiptSlip from '/src/components/common/ReceiptSlip.jsx';
import ShiftReportSlip from '/src/components/common/ShiftReportSlip.jsx';
import InvoiceA4Modal from '/src/components/common/InvoiceA4Modal.jsx';
import ShareDocumentButton from '/src/components/common/ShareDocumentButton.jsx';
import PublicReceiptView from '/src/pages/PublicReceiptView.jsx';
import {localStore} from '/src/utils/brandStorage.js';
import {prepareSharedDocument,saveSharedDocument} from '/src/utils/documentShare.js';
import '/src/index.css';

const tenant={id:9,name:'Sinov do‘koni',is_owner:true,permissions:['*']};
const user={id:91,username:'qa',first_name:'Sinov',role:'owner',tenants:[tenant],tenant_name:tenant.name};
const sale={id:1043,receipt_number:'REC-1043',public_token:'A'.repeat(43),created_at:'2026-10-21T04:41:00Z',counterparty_name:'Sinov mijoz',currency:'UZS',payment_type:'cash',status:'completed',total_amount:'35000',net_amount:'35000',subtotal_amount:'31250',tax_amount:'3750',sold_by_name:'Sinov kassir',receipt_snapshot:{version:1,document_parties:{version:1,cashier_name:'Sinov kassir',customer_name:'Sinov mijoz',customer_phone:'',recipient_store_name:null},store_name:tenant.name,seller_name:'Sinov MChJ',seller_tax_identifier:'123456789',tax_regime:'general',is_vat_payer:true,vat_rate:'12',price_includes_vat:true,receipt_show_cashier:true,receipt_show_customer:true},items:[{id:1,product_name:'Sut 1 L',product_variant_name:'Standart',unit:'dona',quantity:'2',unit_price:'11500',total_price:'23000',voided_quantity:'0',tax_amount:'2464.29'},{id:2,product_name:'Non',product_variant_name:'Standart',unit:'dona',quantity:'3',unit_price:'4000',total_price:'12000',voided_quantity:'0',tax_amount:'1285.71'}]};
const signature=document.createElement('canvas');signature.width=240;signature.height=80;
const ink=signature.getContext('2d');ink.lineWidth=3;ink.beginPath();ink.moveTo(10,60);ink.lineTo(50,10);ink.lineTo(45,70);ink.lineTo(180,25);ink.stroke();
localStore.setItem('ilbi_invoice_signatures_9_1043',JSON.stringify({sender:signature.toDataURL(),receiver:signature.toDataURL(),signedAt:'21.10.2026 09:41'}));
window.shareQA={renameCurrentIdentity(){sale.tenant_name='Changed current store';sale.sold_by_name='Changed current cashier';sale.counterparty_name='Changed current buyer';user.first_name='Changed current account';tenant.name='Changed current context';},exports:[],copied:[],shares:[],linkChecks:[],prints:0,pending:false,offline:false,failCopy:false,cancelShare:false,prepareSharedDocument,saveSharedDocument,
 async decodeQR(dataURL){
  const {QRCodeReader,BinaryBitmap,HybridBinarizer,RGBLuminanceSource}=await import('@zxing/library');
  const image=new Image();image.src=dataURL;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
  const context=canvas.getContext('2d');context.drawImage(image,0,0);
  const rgba=context.getImageData(0,0,canvas.width,canvas.height).data,gray=new Uint8ClampedArray(canvas.width*canvas.height);
  for(let i=0;i<gray.length;i++)gray[i]=(rgba[i*4]+2*rgba[i*4+1]+rgba[i*4+2])/4;
  return new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(gray,canvas.width,canvas.height)))).getText();
 },
 desktop(){window.ilbiDesktop={async saveDocumentPDF(payload){shareQA.exports.push(payload);return {canceled:shareQA.cancelPDF||false};},async receiptShareLinks(tokens){shareQA.linkChecks.push(tokens);if(shareQA.offline)throw Error('offline');return {links:shareQA.pending?[]:tokens.map(token=>'https://ilbi.uz/r/'+token),pending:shareQA.pending};}};},
 web(){delete window.ilbiDesktop;}
};
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{async writeText(value){if(shareQA.failCopy)throw Error('denied');shareQA.copied.push(value);}}});
Object.defineProperty(navigator,'share',{configurable:true,value:async payload=>{if(shareQA.cancelShare)throw new DOMException('canceled','AbortError');shareQA.shares.push(payload);}});
document.execCommand=()=>false;
window.print=()=>shareQA.prints++;
shareQA.desktop();
const originalFetch=window.fetch.bind(window);window.fetch=(input,options)=>new URL(input,location.origin).pathname.startsWith('/api/v1/sales/public/receipt/')?Promise.resolve(new Response(JSON.stringify(sale),{headers:{'Content-Type':'application/json'}})):originalFetch(input,options);
export default function App(){const [invoice,setInvoice]=useState(false),[width,setWidth]=useState('58mm'),[publicView,setPublicView]=useState(false);useEffect(()=>{shareQA.setWidth=setWidth;shareQA.setPublicView=setPublicView;},[]);
 if(publicView)return <MemoryRouter initialEntries={['/r/'+sale.public_token]}><Routes><Route path="/r/:token" element={<PublicReceiptView/>}/></Routes></MemoryRouter>;
 return <div style={{padding:20}}>
  <section id="qa-receipt-actions"><ShareDocumentButton elementId="share-qa-receipt" title="ILBI Chek REC-1043" sales={[sale]} paperWidth={width}/></section>
  <button id="qa-open-invoice" onClick={()=>setInvoice(true)}>Fakturani ochish</button>
  <ReceiptSlip id="share-qa-receipt" sales={[sale]} paperWidth={width}/>
  <div style={{display:'none'}}><ShiftReportSlip id="share-qa-z-report" report={{id:7,tenant_name:tenant.name,closed_at:'2026-10-21T04:41:00Z',closed_by_name:'Sinov kassir',total_sale_cash_uzs:35000,expected_cash_uzs:35000,actual_cash_uzs:35000}} paperWidth="58mm"/></div>
  <InvoiceA4Modal isOpen={invoice} onClose={()=>setInvoice(false)} sale={sale} tenantName={tenant.name}/>
 </div>;
}
createRoot(document.getElementById('root')).render(<AuthContext.Provider value={{user,isAuthenticated:true,isOwner:true,isAdmin:false}}><TenantProvider><App/></TenantProvider></AuthContext.Provider>);
