export async function loader({ request }) {
  const origin = request.headers.get("Origin") || "*";

  return new Response(
    JSON.stringify({ ok: true, service: "chat-agent-opal-proxy" }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": origin,
      },
    }
  );
}
