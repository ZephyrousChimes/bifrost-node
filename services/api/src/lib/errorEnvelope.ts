// The one shape every non-2xx Bifrost response takes. See openapi/bifrost.v1.yaml#ErrorEnvelope.
export function errorEnvelope(type: string, code: string, message: string, param?: string) {
  return {
    error: {
      type,
      code,
      message,
      ...(param !== undefined ? { param } : {}),
    },
  };
}
