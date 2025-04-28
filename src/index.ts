import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModelV1 } from "@ai-sdk/provider";
import { createOpenAICompat } from "@ns/ai-to-openai-hono";
import { Hono } from "hono";

// Module-scoped map to store provider factories
let providersMap: Record<string, (model: string) => LanguageModelV1> = {};
let providersInitializedAt = 0;
const CACHE_TTL_MS = 300_000;

// Helper to initialize providers - will be expanded in Phase 2
async function initializeProviders(
	env: CloudflareBindings,
): Promise<typeof providersMap> {
	// Static provider configuration
	const staticProviderConfigs = [
		{
			provider: "google",
			apiKey: env.GOOGLE_API_KEY,
			gatewayProviderPath: "google-ai-studio",
		},
	];
	const gateway = env.AI.gateway(env.AI_GATEWAY_NAME);
	const url = await gateway.getUrl(
		staticProviderConfigs[0].gatewayProviderPath,
	);
	providersMap.google = createGoogleGenerativeAI({
		baseURL: `${url}/v1beta`,
		apiKey: staticProviderConfigs[0].apiKey,
		headers: { "cf-aig-authorization": `Bearer ${env.AI_GATEWAY_TOKEN}` },
	});
	providersInitializedAt = Date.now();
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

const aiRouter = createOpenAICompat({
	languageModels: (modelId: string) => {
		const [provider, modelName] = modelId.split("/");
		return providersMap[provider]?.(modelName) ?? null;
	},
});

app.route("/", aiRouter);

export default app;
