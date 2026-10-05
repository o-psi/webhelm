export const imageTypes=['image/png','image/jpeg','image/webp'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function validateImageMetadata(value){
 if(!value||typeof value.id!=='string'||!uuid.test(value.id)||/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value.id)||typeof value.sha256!=='string'||! /^[0-9a-f]{64}$/.test(value.sha256)||typeof value.name!=='string'||!value.name.length||new TextEncoder().encode(value.name).length>255||!value.name.trim()||/[\x00-\x1f\x7f-\x9f/\\\u061c\u200e-\u200f\u202a-\u202e\u2066-\u2069]/.test(value.name)||!imageTypes.includes(value.media_type)||!Number.isSafeInteger(value.byte_size)||value.byte_size<1||value.byte_size>4194304||!Number.isSafeInteger(value.width)||!Number.isSafeInteger(value.height)||value.width<1||value.height<1||value.width>8192||value.height>8192||value.width*value.height>16777216)throw Error('Invalid bounded image metadata.');
 return value;
}
export function bindImageReceipt(value,expected){validateImageMetadata(value);for(const key of ['id','sha256','name','media_type','byte_size','width','height'])if(value[key]!==expected[key])throw Error('Image receipt does not match the prepared payload.');return value;}
// Container dimensions, not orientation-adjusted display dimensions.
export function encodedDimensions(bytes,type){
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),ascii=(start,end)=>String.fromCharCode(...bytes.subarray(start,end));
 if(type==='image/png'&&bytes.length>=24&&bytes[0]===137&&ascii(1,4)==='PNG'&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10&&ascii(12,16)==='IHDR')return {width:v.getUint32(16),height:v.getUint32(20)};
 if(type==='image/jpeg'&&bytes.length>=2&&v.getUint16(0)===0xffd8){let p=2;while(p+4<=bytes.length){if(bytes[p++]!==255)throw Error('Invalid JPEG container.');while(bytes[p]===255)p++;const marker=bytes[p++];if(marker===0xd9||marker===0xda)break;const size=v.getUint16(p);if(size<2||p+size>bytes.length)break;if([0xc0,0xc1,0xc2].includes(marker)&&size>=7)return {height:v.getUint16(p+3),width:v.getUint16(p+5)};p+=size;}}
 if(type==='image/webp'&&bytes.length>=30&&ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP'&&v.getUint32(4,true)+8===bytes.length&&v.getUint32(16,true)+20<=bytes.length){
  const kind=ascii(12,16);if(kind==='VP8X')return {width:1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16),height:1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16)};
  if(kind==='VP8 '&&bytes[23]===0x9d&&bytes[24]===1&&bytes[25]===0x2a)return {width:v.getUint16(26,true)&16383,height:v.getUint16(28,true)&16383};
  if(kind==='VP8L'&&bytes[20]===0x2f){const bits=v.getUint32(21,true);return {width:(bits&16383)+1,height:((bits>>>14)&16383)+1};}
 }
 throw Error('Prepared image has no supported encoded dimensions.');
}
export async function preparedMetadata(blob,name,id){
 // Admission before any arrayBuffer or digest allocation.
 if(!(blob instanceof Blob))throw Error('Invalid prepared image Blob.');
 validateImageMetadata({id,name,sha256:'0'.repeat(64),media_type:blob.type,byte_size:blob.size,width:1,height:1});
 const bytes=new Uint8Array(await blob.arrayBuffer());
 if(bytes.length!==blob.size)throw Error('Prepared image size changed.');
 const dimensions=encodedDimensions(bytes,blob.type);
 validateImageMetadata({id,name,sha256:'0'.repeat(64),media_type:blob.type,byte_size:bytes.length,...dimensions});
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 return validateImageMetadata({id,name,sha256,media_type:blob.type,byte_size:bytes.length,...dimensions});
}
