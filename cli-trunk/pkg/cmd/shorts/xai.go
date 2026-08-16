package shorts

import "os"

// init configures the existing OpenAI-compatible generator for providers that
// expose a compatible chat-completions API. Gemini is preferred because its
// current Gemini 2.5 Flash model has a free tier; Grok remains supported when
// Gemini is not configured.
func init() {
	if key := os.Getenv("GEMINI_API_KEY"); key != "" {
		_ = os.Setenv("SHORTS_AI_API_KEY", key)
		_ = os.Setenv("SHORTS_AI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai")
		if os.Getenv("SHORTS_AI_MODEL") == "" {
			_ = os.Setenv("SHORTS_AI_MODEL", "gemini-2.5-flash")
		}
		return
	}

	if key := os.Getenv("XAI_API_KEY"); key != "" {
		_ = os.Setenv("SHORTS_AI_API_KEY", key)
		_ = os.Setenv("SHORTS_AI_BASE_URL", "https://api.x.ai/v1")
		if os.Getenv("SHORTS_AI_MODEL") == "" {
			_ = os.Setenv("SHORTS_AI_MODEL", "grok-4.5")
		}
	}
}
