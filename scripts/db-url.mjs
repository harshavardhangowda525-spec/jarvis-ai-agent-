/** Same as src/lib/db-url.ts tuneDatabaseUrl — for `npm run local`'s startup check. */
export function tuneDatabaseUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { return raw; }
  if (!/^postgres(ql)?:$/i.test(url.protocol)) return raw;
  for (const [k, v] of [["connect_timeout", "30"], ["pool_timeout", "30"]]) if (!url.searchParams.has(k)) url.searchParams.set(k, v);
  return url.toString();
}
