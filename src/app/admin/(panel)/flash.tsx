export function Flash({ ok, err }: { ok?: string; err?: string }) {
  if (err) return <p className="err" role="alert">{err}</p>;
  if (ok) return <p className="notice">{ok}</p>;
  return null;
}
