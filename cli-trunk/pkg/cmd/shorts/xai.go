package shorts

import "os"

// xAI is wired into the existing OpenAI-compatible generator so gh shorts can
// use Grok without adding another SDK dependency. XAI_API_KEY takes priority
// over the legacy provider environment variables when it is present.
func init() {
	if os.Getenv("XAI_API_KEY") == "" {
		return
	}

	if os.Getenv("SHORTS_AI_API_KEY") == "" {
		_ = os.Setenv("SHORTS_AI_API_KEY", os.Getenv("XAI_API_KEY"))
	}
	if os.Getenv("SHORTS_AI_BASE_URL") == "" {
		_ = os.Setenv("SHORTS_AI_BASE_URL", "https://api.x.ai/v1")
	}
	if os.Getenv("SHORTS_AI_MODEL") == "" {
		_ = os.Setenv("SHORTS_AI_MODEL", "grok-4.5")
	}
}
