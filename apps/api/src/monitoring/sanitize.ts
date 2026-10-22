export const sanitizeError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(authorization)\s*[:=]\s*bearer\s+[^\s,;]+/gi, '$1=[redacted]')
    .replace(
      /(authorization|bearer|token|api[_-]?key|password)\s*[:=]\s*[^\s,;]+/gi,
      '$1=[redacted]',
    )
    .replace(/(https?:\/\/)[^\s@/]+@/gi, '$1[redacted]@')
    .slice(0, 500);
};
