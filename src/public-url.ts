export function publicUrl(path: string, base = import.meta.env.BASE_URL): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return normalized.startsWith(base) ? normalized : `${base}${normalized.slice(1)}`;
}
