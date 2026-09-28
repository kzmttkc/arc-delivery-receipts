// "Delivered" is judged in four published stages. A stage that does not apply (nothing declared) counts as passed
// and is reported as n/a, so every stage count can be recomputed from the records.
export const STAGES = ['http2xx', 'nonEmpty', 'mimeMatch', 'schemaMatch'];

const EMPTY = new Set(['', '{}', '[]', 'null', '""']);
function topLevelRequired(schema) {
  const s = schema?.output ?? schema?.schema ?? schema;
  if (!s || typeof s !== 'object') return null;
  if (s.type === 'object' && Array.isArray(s.required) && s.required.length) return s.required;
  return null;
}

export function judge({ status, contentType, bytes, declaredMime, outputSchema }) {
  const r = {};
  r.http2xx = status >= 200 && status < 300 ? 'pass' : 'fail';
  r.nonEmpty = r.http2xx === 'pass' && !EMPTY.has(bytes.toString('utf8').trim()) ? 'pass' : 'fail';
  if (!declaredMime) r.mimeMatch = 'n/a';
  else {
    const want = declaredMime.split(';')[0].trim().toLowerCase();
    const got = (contentType ?? '').split(';')[0].trim().toLowerCase();
    r.mimeMatch = got === want || (want.endsWith('/*') && got.startsWith(want.slice(0, -1))) ? 'pass' : 'fail';
  }
  const req = topLevelRequired(outputSchema);
  if (!req) r.schemaMatch = 'n/a';
  else {
    try {
      const obj = JSON.parse(bytes.toString('utf8'));
      r.schemaMatch = obj && typeof obj === 'object' && req.every((k) => k in obj) ? 'pass' : 'fail';
    } catch { r.schemaMatch = 'fail'; }
  }
  const delivered = STAGES.every((s) => r[s] !== 'fail');
  // Why it was not delivered, in words a seller can act on. 4xx after payment is reported apart from 5xx/timeouts.
  const outcome = delivered ? 'delivered'
    : status === 0 ? 'no_response'
    : status >= 500 ? 'server_error'
    : status >= 400 ? 'rejected_after_payment'
    : r.nonEmpty === 'fail' ? 'empty_body'
    : r.mimeMatch === 'fail' ? 'wrong_content_type'
    : 'schema_mismatch';
  return { stages: r, delivered, outcome };
}
