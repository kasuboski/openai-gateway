import type { LanguageModelV1 } from "@ai-sdk/provider";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompat } from "@ns/ai-to-openai-hono";
import { Hono } from "hono";

// Module-scoped map to store provider factories
let providersMap: Record<string, (model: string) => LanguageModelV1> = {};
let providersInitializedAt = 0;
const CACHE_TTL_MS = 300_000;

interface ProviderConfig {
	provider: string;
	apiKeySecretName: string;
	gatewayProviderPath: string;
}

// Type-guard that asserts env has a string property at the given key
function hasSecret<K extends string>(
	env: CloudflareBindings,
	key: K,
): env is CloudflareBindings & Record<K, string> {
	// biome-ignore lint/suspicious/noExplicitAny: cast as any to further guard type
	return typeof (env as any)[key] === "string";
}

// initialize providers from KV
async function initializeProviders(
	env: CloudflareBindings,
): Promise<typeof providersMap> {
	const providers: Record<string, (model: string) => LanguageModelV1> = {};
	const gateway = env.AI.gateway(env.AI_GATEWAY_NAME);
	try {
		const list = await env.PROVIDER_CONFIG.list();
		for (const { name: provider } of list.keys) {
			const raw = await env.PROVIDER_CONFIG.get(provider);
			if (!raw) continue;
			let cfg: ProviderConfig;
			try {
				cfg = JSON.parse(raw);
			} catch (e) {
				console.error(`Invalid JSON in PROVIDER_CONFIG for '${provider}':`, e);
				continue;
			}

			const url = await gateway.getUrl(cfg.gatewayProviderPath);
			// explicit runtime check for missing secret
			if (!hasSecret(env, cfg.apiKeySecretName)) {
				throw new Error(
					`Missing secret '${cfg.apiKeySecretName}' in environment for provider '${provider}'`,
				);
			}
			const apiKey = env[cfg.apiKeySecretName];
			let clientFactory: (model: string) => LanguageModelV1;
			switch (cfg.provider) {
				case "google":
					clientFactory = createGoogleGenerativeAI({
						baseURL: `${url}/v1beta`,
						apiKey,
						headers: {
							"cf-aig-authorization": `Bearer ${env.AI_GATEWAY_TOKEN}`,
						},
					});
					break;
				default:
					console.warn(`Unsupported provider '${cfg.provider}'`);
					continue;
			}
			providers[provider] = clientFactory;
		}
		providersInitializedAt = Date.now();
		providersMap = providers;
	} catch (e) {
		console.error("Error initializing providers from KV:", e);
	}
	return providersMap;
}

const app = new Hono<{
	Bindings: CloudflareBindings;
	Variables: { languageModels: Record<string, LanguageModelV1> };
}>();

app.use("*", async (c, next) => {
	const now = Date.now();
	if (!providersMap || now - providersInitializedAt > CACHE_TTL_MS) {
		providersMap = await initializeProviders(c.env);
	}
	await next();
});

// Authenticate all routes using CLIENT_KEYS
app.use("*", async (c, next) => {
	const authHeader = c.req.header("Authorization");
	if (!authHeader) {
		return c.json({ message: "Missing Authorization header" }, 403);
	}
	const key = authHeader.split(" ")[1];
	const valid = (await c.env.CLIENT_KEYS.get(key)) !== null;
	if (!valid) {
		return c.json({ message: "Invalid API key" }, 403);
	}
	return next();
});

const aiRouter = createOpenAICompat({
	languageModels: (modelId: string) => {
		const [provider, modelName] = modelId.split("/");
		return providersMap[provider]?.(modelName) ?? null;
	},
});

app.route("/", aiRouter);

export default app;
