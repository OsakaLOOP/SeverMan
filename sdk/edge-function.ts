export function createEdgeHandler(upstream: string, publicOrigin: string) {
  const base = new URL(upstream);
  if (base.protocol !== "https:") throw new Error("源站必须使用 HTTPS");
  return async ({ request }: { request: Request }): Promise<Response> => {
    const incoming = new URL(request.url);
    if (incoming.origin !== publicOrigin || !/^\/(auth|api)\//.test(incoming.pathname)) return new Response("Not Found", { status: 404 });
    const headers = new Headers(request.headers);
    for (const name of ["host", "x-forwarded-for", "x-real-ip", "x-forwarded-host", "x-forwarded-proto", "content-length"]) headers.delete(name);
    const response = await fetch(new URL(incoming.pathname + incoming.search, base), {
      method: request.method, headers, redirect: "manual", signal: AbortSignal.timeout(5000),
      ...(["GET", "HEAD"].includes(request.method) ? {} : { body: await request.arrayBuffer() }),
    });
    const result = new Headers(response.headers);
    result.set("cache-control", "no-store");
    return new Response(response.body, { status: response.status, headers: result });
  };
}
