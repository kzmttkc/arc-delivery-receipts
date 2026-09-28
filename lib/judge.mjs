// Method v1. Checks on what came back (four published stages), then the verdict once we know from Circle's Gateway
// record whether the seller actually charged. A stage that does not apply is n/a and does not fail.
export const STAGES = ['http2xx', 'nonEmpty', 'mimeMatch', 'schemaMatch'];

function topLevelRequired(schema) {
  const s = schema?.output ?? schema?.schema ?? schema;
  return s && typeof s === 'object' && s.type === 'object' && Array.isArray(s.required) && s.required.length ? s.required : null;
}

// Charge-independent: did the response pass the four checks? (This count is what DeliveryLedger stores as `delivered`.)
export function checks({ status, contentType, bytes, declaredMime, outputSchema }) {
  const r = {};
  const text = bytes.toString('utf8').trim();
  r.http2xx = status >= 200 && status < 300 ? 'pass' : 'fail';
  r.nonEmpty = r.http2xx === 'pass' && text.length > 0 ? 'pass' : 'fail';
  if (!declaredMime) r.mimeMatch = 'n/a';
  else {
    const want = declaredMime.split(';')[0].trim().toLowerCase();
    const got = (contentType ?? '').split(';')[0].trim().toLowerCase();
    r.mimeMatch = got === want || (want.endsWith('/*') && got.startsWith(want.slice(0, -1))) ? 'pass' : 'fail';
  }
  const req = topLevelRequired(outputSchema);
  if (!req) r.schemaMatch = 'n/a';
  else { try { const o = JSON.parse(text); r.schemaMatch = o && typeof o === 'object' && req.every((k) => k in o) ? 'pass' : 'fail'; } catch { r.schemaMatch = 'fail'; } }
  const passed = STAGES.every((s) => r[s] !== 'fail');
  const emptyResult = passed && ['{}', '[]', 'null', '""'].includes(text);
  return { stages: r, passed, emptyResult };
}

// Verdict, given whether Circle recorded the payment (`charged`).
export function verdict({ status, passed }, charged) {
  if (charged) {
    if (passed) return 'delivered';
    if (status >= 200 && status < 300) return 'charged_bad_response';
    if (status >= 400 && status < 500) return 'charged_then_rejected';
    if (status >= 500) return 'charged_server_error';
    return 'charged_no_response';
  }
  if (status >= 200 && status < 300) return 'served_not_charged';
  if (status === 402) return 'payment_not_accepted';
  if (status >= 400 && status < 500) return 'refused_not_charged';
  return 'failed_not_charged';
}
export const CHARGED_OUTCOMES = ['delivered', 'charged_bad_response', 'charged_then_rejected', 'charged_server_error', 'charged_no_response'];
