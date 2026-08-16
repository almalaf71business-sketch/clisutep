package shorts

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/cli/cli/v2/pkg/cmdutil"
	"github.com/spf13/cobra"
)

type buildOptions struct {
	Output string
	Model  string
	Topic  string
	Text   string
	NoAI   bool
}

type githubIssue struct {
	Number int    `json:"number"`
	Title  string `json:"title"`
	Body   string `json:"body"`
	HTML   string `json:"html_url"`
}

type shortsContent struct {
	ID          int               `json:"id"`
	SourceURL   string            `json:"source_url"`
	Title       string            `json:"title"`
	Hook        string            `json:"hook"`
	Script      string            `json:"script"`
	Description string            `json:"description"`
	Hashtags    []string          `json:"hashtags"`
	Captions    map[string]string `json:"captions"`
	GeneratedAt string            `json:"generated_at"`
	AI          bool              `json:"ai_generated"`
}

func newBuildCmd(f *cmdutil.Factory) *cobra.Command {
	opts := &buildOptions{}
	cmd := &cobra.Command{
		Use:   "build [id]",
		Short: "Build an AI-generated short-form content pack from an issue, topic, or text",
		Args:  cobra.MaximumNArgs(1),
		Example: `
  $ gh shorts build 42
  $ gh shorts build --topic "New AI feature in GitHub"
  $ gh shorts build --text "Explain why AI agents matter for developers"
  $ gh shorts build --topic "AI news" --output ./shorts/ai-news
`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) == 1 {
				id, err := strconv.Atoi(args[0])
				if err != nil || id < 1 {
					return fmt.Errorf("invalid id %q; expected a GitHub issue number", args[0])
				}
				return runBuild(cmd.Context(), f, id, opts)
			}
			if strings.TrimSpace(opts.Topic) == "" && strings.TrimSpace(opts.Text) == "" {
				return errors.New("provide an issue id, --topic, or --text")
			}
			return runBuildFromInput(cmd.Context(), f, opts)
		},
	}
	cmd.Flags().StringVarP(&opts.Output, "output", "o", "", "Output directory (default: .shorts/<id> or .shorts/generated-<timestamp>)")
	cmd.Flags().StringVar(&opts.Model, "model", "", "AI model (default depends on provider)")
	cmd.Flags().StringVar(&opts.Topic, "topic", "", "Topic to turn into a short")
	cmd.Flags().StringVar(&opts.Text, "text", "", "Source text to turn into a short")
	cmd.Flags().BoolVar(&opts.NoAI, "no-ai", false, "Use the deterministic fallback instead of an AI provider")
	return cmd
}

func runBuild(ctx context.Context, f *cmdutil.Factory, id int, opts *buildOptions) error {
	repo, err := currentRepo(ctx)
	if err != nil { return err }
	token, err := githubToken(ctx)
	if err != nil { return err }
	issue, err := fetchIssue(ctx, repo, id, token)
	if err != nil { return err }
	return writeBuild(ctx, f, issue, id, opts)
}

func runBuildFromInput(ctx context.Context, f *cmdutil.Factory, opts *buildOptions) error {
	title := strings.TrimSpace(opts.Topic)
	body := strings.TrimSpace(opts.Text)
	if title == "" { title = "Short-form video" }
	if body == "" { body = title }
	return writeBuild(ctx, f, &githubIssue{Title: title, Body: body}, 0, opts)
}

func writeBuild(ctx context.Context, f *cmdutil.Factory, issue *githubIssue, id int, opts *buildOptions) error {
	content, aiGenerated, err := generateContent(ctx, issue, opts.Model, opts.NoAI)
	if err != nil { return err }
	content.ID = id
	content.SourceURL = issue.HTML
	content.GeneratedAt = time.Now().UTC().Format(time.RFC3339)
	content.AI = aiGenerated
	out := opts.Output
	if out == "" {
		if id > 0 { out = filepath.Join(".shorts", strconv.Itoa(id)) } else { out = filepath.Join(".shorts", "generated-"+time.Now().UTC().Format("20060102-150405")) }
	}
	if err := os.MkdirAll(out, 0755); err != nil { return fmt.Errorf("create output directory: %w", err) }
	data, err := json.MarshalIndent(content, "", "  ")
	if err != nil { return fmt.Errorf("encode content: %w", err) }
	if err := os.WriteFile(filepath.Join(out, "content.json"), append(data, '\n'), 0644); err != nil { return fmt.Errorf("write content.json: %w", err) }
	if err := os.WriteFile(filepath.Join(out, "script.md"), []byte(renderScript(content)), 0644); err != nil { return fmt.Errorf("write script.md: %w", err) }
	for platform, caption := range content.Captions {
		if err := os.WriteFile(filepath.Join(out, platform+".txt"), []byte(caption+"\n"), 0644); err != nil { return fmt.Errorf("write %s: %w", platform, err) }
	}
	if id > 0 { fmt.Fprintf(f.IOStreams.Out, "Built shorts content from issue #%d\n", id) } else { fmt.Fprintln(f.IOStreams.Out, "Built shorts content from direct input") }
	fmt.Fprintf(f.IOStreams.Out, "  output: %s\n  ai: %t\n", out, aiGenerated)
	return nil
}

func currentRepo(ctx context.Context) (string, error) {
	if repo := strings.TrimSpace(os.Getenv("GH_REPO")); repo != "" { return repo, nil }
	cmd := exec.CommandContext(ctx, "git", "remote", "get-url", "origin")
	out, err := cmd.Output()
	if err != nil { return "", errors.New("could not determine repository; run inside a git repository or set GH_REPO=OWNER/REPO") }
	s := strings.TrimSuffix(strings.TrimSpace(string(out)), ".git")
	if strings.HasPrefix(s, "git@github.com:") { return strings.TrimPrefix(s, "git@github.com:"), nil }
	if u, err := url.Parse(s); err == nil && u.Host == "github.com" {
		parts := strings.Split(strings.Trim(u.Path, "/"), "/")
		if len(parts) == 2 { return parts[0] + "/" + parts[1], nil }
	}
	return "", fmt.Errorf("could not parse GitHub repository from origin %q", s)
}

func githubToken(ctx context.Context) (string, error) {
	for _, name := range []string{"GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN"} { if token := strings.TrimSpace(os.Getenv(name)); token != "" { return token, nil } }
	cmd := exec.CommandContext(ctx, "gh", "auth", "token")
	out, err := cmd.Output()
	if err != nil { return "", errors.New("GitHub authentication required; run: gh auth login") }
	if token := strings.TrimSpace(string(out)); token != "" { return token, nil }
	return "", errors.New("GitHub authentication required; run: gh auth login")
}

func fetchIssue(ctx context.Context, repo string, id int, token string) (*githubIssue, error) {
	u := "https://api.github.com/repos/" + repo + "/issues/" + strconv.Itoa(id)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil { return nil, err }
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil { return nil, fmt.Errorf("fetch issue: %w", err) }
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK { return nil, fmt.Errorf("fetch issue: GitHub returned %s", resp.Status) }
	var issue githubIssue
	if err := json.NewDecoder(resp.Body).Decode(&issue); err != nil { return nil, fmt.Errorf("decode issue: %w", err) }
	return &issue, nil
}

const shortsPrompt = `You are an elite short-form video writer and social media producer.

Create a professional 45-60 second vertical video package from the source below.
The audience must understand the value within the first 2 seconds and want to keep watching.
Write naturally for spoken Arabic when the source/topic is Arabic; otherwise use the source language.

Requirements:
- Start with a strong curiosity-driven hook; never use generic introductions.
- Write a spoken script for 45-60 seconds using short, natural sentences.
- Structure: HOOK -> VALUE/EXPLANATION -> 2-5 concrete points -> PAYOFF -> concise CTA.
- Every sentence must be useful for narration. Avoid filler and corporate language.
- Keep factual claims grounded strictly in the source. Never invent statistics, names, dates, quotes, or capabilities.
- Make the title punchy and platform-friendly without deceptive clickbait.
- Produce a concise description and platform-ready captions.
- Return 6-10 relevant hashtags, including #shorts when appropriate.
- Return ONLY valid JSON matching the requested keys.

JSON keys:
title: string
hook: string
script: string
description: string
hashtags: array of strings
captions: object with youtube, tiktok, facebook string values

Source title:
`

func generateContent(ctx context.Context, issue *githubIssue, modelOverride string, noAI bool) (shortsContent, bool, error) {
	if noAI { return fallbackContent(issue), false, nil }
	apiKey := strings.TrimSpace(os.Getenv("SHORTS_AI_API_KEY"))
	if apiKey == "" { apiKey = strings.TrimSpace(os.Getenv("GEMINI_API_KEY")) }
	if apiKey == "" { apiKey = strings.TrimSpace(os.Getenv("ANTHROPIC_API_KEY")) }
	if apiKey == "" { apiKey = strings.TrimSpace(os.Getenv("OPENAI_API_KEY")) }
	prompt := shortsPrompt + issue.Title + "\n\nSource body:\n" + issue.Body
	if apiKey == "" {
		if content, ok, err := generateLocalOllama(ctx, prompt, modelOverride); ok || err != nil { return content, ok, err }
		return shortsContent{}, false, errors.New("AI is required: set GEMINI_API_KEY/SHORTS_AI_API_KEY or install Ollama for free local AI")
	}
	if strings.HasPrefix(apiKey, "sk-ant-") { return generateAnthropic(ctx, apiKey, prompt, modelOverride) }
	if strings.TrimSpace(os.Getenv("GEMINI_API_KEY")) != "" && apiKey == strings.TrimSpace(os.Getenv("GEMINI_API_KEY")) {
		return generateGemini(ctx, apiKey, prompt, modelOverride)
	}
	return generateOpenAICompatible(ctx, apiKey, prompt, modelOverride)
}

func generateGemini(ctx context.Context, apiKey, prompt, modelOverride string) (shortsContent, bool, error) {
	model := modelOverride
	if model == "" { model = strings.TrimSpace(os.Getenv("SHORTS_AI_MODEL")) }
	if model == "" || model == "gemini-2.5-flash" { model = "gemini-2.5-flash-lite" }
	payload := map[string]any{"contents": []map[string]any{{"role": "user", "parts": []map[string]string{{"text": prompt}}}}, "generationConfig": map[string]any{"temperature": 0.8, "responseMimeType": "application/json"}}
	body, err := json.Marshal(payload)
	if err != nil { return shortsContent{}, false, fmt.Errorf("encode Gemini request: %w", err) }
	u := "https://generativelanguage.googleapis.com/v1beta/models/" + url.PathEscape(model) + ":generateContent?key=" + url.QueryEscape(apiKey)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(body))
	if err != nil { return shortsContent{}, false, err }
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil { return shortsContent{}, false, fmt.Errorf("Gemini request: %w", err) }
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 { b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096)); return shortsContent{}, false, fmt.Errorf("Gemini request: provider returned %s: %s", resp.Status, strings.TrimSpace(string(b))) }
	var result struct { Candidates []struct { Content struct { Parts []struct { Text string `json:"text"` } `json:"parts"` } `json:"content"` } `json:"candidates"` }
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil { return shortsContent{}, false, fmt.Errorf("decode Gemini response: %w", err) }
	if len(result.Candidates) == 0 || len(result.Candidates[0].Content.Parts) == 0 { return shortsContent{}, false, errors.New("Gemini response did not contain content") }
	return parseGeneratedContent(result.Candidates[0].Content.Parts[0].Text)
}

func generateLocalOllama(ctx context.Context, prompt, modelOverride string) (shortsContent, bool, error) {
	if _, err := exec.LookPath("ollama"); err != nil { return shortsContent{}, false, nil }
	model := strings.TrimSpace(modelOverride)
	if model == "" { model = strings.TrimSpace(os.Getenv("SHORTS_LOCAL_MODEL")) }
	if model == "" { model = "qwen2.5:3b" }
	payload := map[string]any{"model": model, "prompt": prompt, "stream": false, "format": "json", "options": map[string]any{"temperature": 0.8}}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "http://127.0.0.1:11434/api/generate", bytes.NewReader(body))
	if err != nil { return shortsContent{}, false, err }
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		// Ollama is installed but its daemon is not running: start it for this command.
		_ = exec.CommandContext(ctx, "ollama", "serve").Start()
		if err := waitForOllama(ctx); err != nil { return shortsContent{}, false, nil }
		req, _ = http.NewRequestWithContext(ctx, http.MethodPost, "http://127.0.0.1:11434/api/generate", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		resp, err = http.DefaultClient.Do(req)
	}
	if err != nil { return shortsContent{}, false, nil }
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 { b, _ := io.ReadAll(io.LimitReader(resp.Body, 2048)); return shortsContent{}, false, fmt.Errorf("local Ollama request: %s: %s", resp.Status, strings.TrimSpace(string(b))) }
	var result struct { Response string `json:"response"` }
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil { return shortsContent{}, false, fmt.Errorf("decode Ollama response: %w", err) }
	return parseGeneratedContent(result.Response)
}

func waitForOllama(ctx context.Context) error {
	for i := 0; i < 20; i++ {
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "http://127.0.0.1:11434/api/tags", nil)
		if resp, err := http.DefaultClient.Do(req); err == nil { resp.Body.Close(); return nil }
		time.Sleep(250 * time.Millisecond)
	}
	return errors.New("Ollama did not start")
}

func parseGeneratedContent(text string) (shortsContent, bool, error) {
	var content shortsContent
	if err := json.Unmarshal([]byte(cleanJSON(text)), &content); err != nil { return shortsContent{}, false, fmt.Errorf("decode generated content: %w", err) }
	return content, true, nil
}

func generateAnthropic(ctx context.Context, apiKey, prompt, modelOverride string) (shortsContent, bool, error) {
	model := modelOverride; if model == "" { model = strings.TrimSpace(os.Getenv("SHORTS_AI_MODEL")) }; if model == "" { model = "claude-sonnet-5" }
	payload := map[string]any{"model": model, "max_tokens": 1800, "temperature": 0.8, "system": "You are an elite short-form video writer. Return only valid JSON matching the requested schema.", "messages": []map[string]string{{"role": "user", "content": prompt}}}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.anthropic.com/v1/messages", bytes.NewReader(body)); if err != nil { return shortsContent{}, false, err }
	req.Header.Set("x-api-key", apiKey); req.Header.Set("anthropic-version", "2023-06-01"); req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req); if err != nil { return shortsContent{}, false, fmt.Errorf("Anthropic request: %w", err) }; defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 { errBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096)); return shortsContent{}, false, fmt.Errorf("Anthropic request: provider returned %s: %s", resp.Status, strings.TrimSpace(string(errBody))) }
	var result struct { Content []struct { Text string `json:"text"` } `json:"content"` }
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil { return shortsContent{}, false, fmt.Errorf("decode Anthropic response: %w", err) }
	if len(result.Content) == 0 || strings.TrimSpace(result.Content[0].Text) == "" { return shortsContent{}, false, errors.New("Anthropic response did not contain content") }
	return parseGeneratedContent(result.Content[0].Text)
}

func generateOpenAICompatible(ctx context.Context, apiKey, prompt, modelOverride string) (shortsContent, bool, error) {
	base := strings.TrimRight(os.Getenv("SHORTS_AI_BASE_URL"), "/"); if base == "" { base = "https://api.openai.com/v1" }
	model := modelOverride; if model == "" { model = strings.TrimSpace(os.Getenv("SHORTS_AI_MODEL")) }; if model == "" { model = "gpt-4o-mini" }
	payload := map[string]any{"model": model, "temperature": 0.8, "messages": []map[string]string{{"role": "system", "content": "You are an elite short-form video writer. Return only valid JSON matching the requested schema."}, {"role": "user", "content": prompt}}}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/chat/completions", bytes.NewReader(body)); if err != nil { return shortsContent{}, false, err }
	req.Header.Set("Authorization", "Bearer "+apiKey); req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req); if err != nil { return shortsContent{}, false, fmt.Errorf("AI request: %w", err) }; defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 { errBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096)); return shortsContent{}, false, fmt.Errorf("AI request: provider returned %s: %s", resp.Status, strings.TrimSpace(string(errBody))) }
	var result struct { Choices []struct { Message struct { Content string `json:"content"` } `json:"message"` } `json:"choices"` }
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil { return shortsContent{}, false, fmt.Errorf("decode AI response: %w", err) }
	if len(result.Choices) == 0 || strings.TrimSpace(result.Choices[0].Message.Content) == "" { return shortsContent{}, false, errors.New("AI response did not contain content") }
	return parseGeneratedContent(result.Choices[0].Message.Content)
}

func cleanJSON(s string) string { s = strings.TrimSpace(s); s = strings.TrimPrefix(s, "```json"); s = strings.TrimPrefix(s, "```"); s = strings.TrimSuffix(s, "```"); return strings.TrimSpace(s) }

func fallbackContent(issue *githubIssue) shortsContent {
	title := strings.TrimSpace(issue.Title); body := strings.TrimSpace(issue.Body); if len(body) > 900 { body = body[:900] + "..." }
	hook := "ما الذي تحتاج أن تعرفه عن " + title
	script := hook + ".\n\n" + body + "\n\nتابع للمزيد."
	desc := title + "\n\n" + body; hashtags := []string{"#shorts", "#ai", "#tech"}; caption := title + "\n\n" + body + "\n\n" + strings.Join(hashtags, " ")
	return shortsContent{Title: title, Hook: hook, Script: script, Description: desc, Hashtags: hashtags, Captions: map[string]string{"youtube": caption, "tiktok": caption, "facebook": caption}}
}

func renderScript(content shortsContent) string { return fmt.Sprintf("# %s\n\n## Hook\n%s\n\n## Script\n%s\n\n## Description\n%s\n\n## Hashtags\n%s\n", content.Title, content.Hook, content.Script, content.Description, strings.Join(content.Hashtags, " ")) }
