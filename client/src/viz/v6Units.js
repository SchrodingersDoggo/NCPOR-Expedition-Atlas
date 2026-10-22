export function depthUnitToKmScale(unit) {
  const text = String(unit || '').trim().toLowerCase().replace(/µ/g, 'u').replace(/\./g, '');
  if (!text) return null;
  if (/^(m|meter|meters|metre|metres)$/.test(text)) return 1e-3;
  if (/^(km|kilometer|kilometers|kilometre|kilometres)$/.test(text)) return 1;
  if (/^(cm|centimeter|centimeters|centimetre|centimetres)$/.test(text)) return 1e-5;
  if (/^(mm|millimeter|millimeters|millimetre|millimetres)$/.test(text)) return 1e-6;
  return null;
}
