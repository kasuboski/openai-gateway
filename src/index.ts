import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModelV1 } from "@ai-sdk/provider";
import { createOpenAICompat } from "@ns/ai-to-openai-hono";
import { Hono } from "hono";

// Module-scoped map to store initialized models
let modelsMap: Record<string, LanguageModelV1> = {};

// Helper to initialize models - will be expanded in Phase 2
async function initializeLanguageModels(
	env: CloudflareBindings,
): Promise<Record<string, LanguageModelV1>> {
	const models: Record<string, LanguageModelV1> = {};

	// Configure Google Gemini using AI Gateway
	if (env.AI && env.AI_GATEWAY_NAME && env.GOOGLE_API_KEY) {
		try {
			const gateway = env.AI.gateway(env.AI_GATEWAY_NAME);
			const googleURL = await gateway.getUrl("google-ai-studio");

			if (!googleURL) {
				throw new Error("Failed to get Google AI Studio URL from AI Gateway.");
			}
			const token = env.AI_GATEWAY_TOKEN;

			const google = createGoogleGenerativeAI({
				baseURL: `${googleURL}/v1beta`,
				apiKey: env.GOOGLE_API_KEY,
				headers: {
					"cf-aig-authorization": `Bearer ${token}`,
				},
			});
			models["gemini-flash"] = google("gemini-2.0-flash");
		} catch (error) {
			console.error("Error initializing Google Gemini via AI Gateway:", error);
		}
	} else {
		console.warn(
			"Google Gemini provider not configured via AI Gateway due to missing bindings or environment variables/secrets (AI, AI_GATEWAY_NAME, GOOGLE_API_KEY).",
		);
	}
	return models;
}

const app = new Hono<{
	Bindings: CloudflareBindings;
	Variables: { languageModels: Record<string, LanguageModelV1> };
}>();

app.use("*", async (c, next) => {
	if (Object.keys(modelsMap).length === 0) {
		modelsMap = await initializeLanguageModels(c.env);
	}
	await next();
});

const aiRouter = createOpenAICompat({
	languageModels: (modelId: string) => modelsMap[modelId] ?? null,
});

app.route("/", aiRouter);

export default app;
