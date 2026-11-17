export function ErrorBanner({ error }: { error?: string | string[] }) {
  const msg = Array.isArray(error) ? error[0] : error;
  return msg ? <p className="error" role="alert">{msg}</p> : null;
}
