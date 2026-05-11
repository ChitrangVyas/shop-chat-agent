# Vercel Deployment for Shopify Chat Agent - Opal

## 1. Environment Variables
- `DATABASE_URL`: Your production Postgres connection string (from Vercel/Postgres provider)
- `CLAUDE_API_KEY`: Your Anthropic Claude API key (or leave blank to require merchants to set their own)
- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, etc.: Shopify app credentials

## 2. Vercel Configuration
- Ensure your API routes (e.g., `/api/chat` or `/apps/chat-agent-opal/chat`) are exposed in `vercel.json`:

```
{
  "rewrites": [
    { "source": "/apps/chat-agent-opal/:match*", "destination": "/api/chat/:match*" }
  ]
}
```
- Place your Remix/Express API handler at `/api/chat` or similar.
- If using Shopify App Proxy, configure the proxy to forward `/apps/chat-agent-opal/*` to your backend.

## 3. Prisma/Postgres
- Use Postgres for production. Set `DATABASE_URL` accordingly.
- Run `npx prisma migrate deploy && npx prisma generate` after deploying.

## 4. Theme Extension Widget
- The chat widget auto-detects the backend URL. No code changes needed for Vercel.

## 5. GDPR Webhooks & Security
- Ensure `/app/routes/api.webhooks.jsx` handles all required GDPR webhooks.
- CORS is handled in the backend route (`getCorsHeaders`).

## 6. Testing
- Test the app in a real Shopify store with the deployed Vercel URL.
- Confirm chat, cart context, and merchant Claude key all work.

---

For further help, see Shopify + Vercel deployment docs or ask for a step-by-step walkthrough.