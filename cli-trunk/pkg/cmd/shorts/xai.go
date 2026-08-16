package shorts

import "os"

// Configure the OpenAI-compatible generator for Gemini first, then Grok.
// Gemini is preferred when GEMINI_API_KEY is present.
func init() {
	if key := os.Getenv("GEMINI_API_KEY"); key != "" {
		_ = os.Setenv("SHORTS_AI_API_KEY", key)
		_ = os.Setenv("SHORTS_AI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai")
		if os.Getenv("SHORTS_AI_MODEL") == "" || os.Getenv("SHORTS_AI_MODEL") == "gemini-2.5-flash" {
			_ = os.Setenv("SHORTS_AI_MODEL", "gemini-2.5-flash-lite")
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
