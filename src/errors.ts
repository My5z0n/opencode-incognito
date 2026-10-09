export function describeError(error: unknown): string {
  if (error && typeof error === 'object') {
    const value = error as { type?: unknown; _tag?: unknown; message?: unknown };
    const code = typeof value.type === 'string' ? value.type
      : typeof value._tag === 'string' ? value._tag : undefined;
    const message = typeof value.message === 'string' ? value.message : undefined;
    if (code === 'rpc.unavailable') {
      return 'Incognito server plugin is not enabled in this directory. Enable it globally or in this project.';
    }
    if (message) return code ? `${code}: ${message}` : message;
    if (code) return code;
    return 'Unknown server error';
  }
  return String(error);
}
