# OpenAI-Compatible API Gateway

## Project Overview
This Cloudflare Worker hosts a Hono application providing an OpenAI-compatible API under `/v1`. It dynamically loads provider configurations from KV, retrieves secrets from Cloudflare Secrets, and routes through the Cloudflare AI Gateway using Vercel AI SDK instances.

## Development
Install dependencies and run locally:
```txt
npm install
npm run dev
```
Deploy to Cloudflare:
```txt
npm run deploy
```

## Adding a New Provider
1. Add your provider API key as a Cloudflare secret:
```bash
npx wrangler secret put MY_PROVIDER_API_KEY
```
2. Add a KV entry to `PROVIDER_CONFIG` with your provider config:
```bash
npx wrangler kv key put --binding PROVIDER_CONFIG myprovider '{
  "provider": "myprovider",
  "apiKeySecretName": "MY_PROVIDER_API_KEY",
  "gatewayProviderPath": "myprovider-path"
}' --preview
```
--preview helps for testing remove for production

3. In `src/index.ts`, update the `initializeProviders` switch:
```ts
switch (cfg.provider) {
  case "myprovider":
    clientFactory = createMyProviderAI({
      baseURL: `${url}/v1`,
      apiKey,
      headers: { "cf-aig-authorization": `Bearer ${env.AI_GATEWAY_TOKEN}` },
    });
    break;
  // existing cases...
}
```
4. Regenerate types and verify:
```bash
npm run cf-typegen
npm run lint
npm run format
npm run check
```
5. Example request:
```bash
curl http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "myprovider/modelName",
    "messages": [{ "role": "user", "content": "Your prompt here" }]
  }'
```

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```txt
npm run cf-typegen
```
