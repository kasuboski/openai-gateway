import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModelV1 } from "@ai-sdk/provider";
import { createOpenAICompat } from "@ns/ai-to-openai-hono";
import { Hono } from "hono";
import type { Context } from "hono";

// Extend CloudflareBindings to include AI_GATEWAY_TOKEN secret
interface ExtendedBindings extends CloudflareBindings {
	AI_GATEWAY_TOKEN: string;
}

const app = new Hono<{
	Bindings: ExtendedBindings;
	Variables: { languageModels: Record<string, LanguageModelV1> };
}>();

// Module-scoped map to store initialized models
let modelsMap: Record<string, LanguageModelV1> = {};

// Helper to initialize models - will be expanded in Phase 2
async function initializeLanguageModels(
	env: ExtendedBindings,
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

			const google = createGoogleGenerativeAI({
				baseURL: `${googleURL}/v1beta`,
				apiKey: env.GOOGLE_API_KEY,
				headers: {
					"cf-aig-authorization": `Bearer ${env.AI_GATEWAY_TOKEN ?? ""}`,
				},
			});
			models["gemini-pro"] = google("gemini-1.5-pro-latest");
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

app.use("*", async (c, next) => {
	if (Object.keys(modelsMap).length === 0) {
		modelsMap = await initializeLanguageModels(c.env);
	}
	await next();
});

const aiRouter = createOpenAICompat({
	languageModels: modelsMap,
});

app.route("/v1", aiRouter);

app.get("/", (c) => c.text("OpenAI Compatible Gateway Running"));

export default app;
