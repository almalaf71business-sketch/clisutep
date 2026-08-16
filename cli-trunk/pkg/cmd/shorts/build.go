package shorts

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
	cmd.Flags().StringVar(&opts.Model, "model", "", "AI model (default: gpt-4.1-mini for OpenAI-compatible APIs)")
	cmd.Flags().StringVar(&opts.Topic, "topic", "", "Topic to turn into a short")
	cmd.Flags().StringVar(&opts.Text, "text", "", "Source text to turn into a short")
	cmd.Flags().BoolVar(&opts.NoAI, "no-ai", false, "Use the deterministic fallback instead of an AI provider")
	return cmd
}

func runBuild(ctx context.Context, f *cmdutil.Factory, id int, opts *buildOptions) error {
	repo, err := currentRepo(ctx)
	if err != nil {
		return err
	}
	token, err := githubToken(ctx)
	if err != nil {
		return err
	}
	issue, err := fetchIssue(ctx, repo, id, token)
	if err != nil {
		return err
	}
	return writeBuild(ctx, f, issue, id, opts)
}

func runBuildFromInput(ctx context.Context, f *cmdutil.Factory, opts *buildOptions) error {
	title := strings.TrimSpace(opts.Topic)
	body := strings.TrimSpace(opts.Text)
	if title == "" {
		title = "Short-form video"
	}
	if body == "" {
		body = title
	}
	issue := &githubIssue{Title: title, Body: body}
	return writeBuild(ctx, f, issue, 0, opts)
}

func writeBuild(ctx context.Context, f *cmdutil.Factory, issue *githubIssue, id int, opts *buildOptions) error {
	content, aiGenerated, err := generateContent(ctx, issue, opts.Model, opts.NoAI)
	if err != nil {
		return err
	}
	content.ID = id
	content.SourceURL = issue.HTML
	content.GeneratedAt = time.Now().UTC().Format(time.RFC3339)
	content.AI = aiGenerated

	out := opts.Output
	if out == "" {
		if id > 0 {
			out = filepath.Join(".shorts", strconv.Itoa(id))
		} else {
			out = filepath.Join(".shorts", "generated-"+time.Now().UTC().Format("20060102-150405"))
		}
	}
	if err := os.MkdirAll(out, 0755); err != nil {
		return fmt.Errorf("create output directory: %w", err)
	}

	data, err := json.MarshalIndent(content, "", "  ")
	if err != nil {
		return fmt.Errorf("encode content: %w", err)
	}
	if err := os.WriteFile(filepath.Join(out, "content.json"), append(data, '\n'), 0644); err != nil {
		return fmt.Errorf("write content.json: %w", err)
	}
	if err := os.WriteFile(filepath.Join(out, "script.md"), []byte(renderScript(content)), 0644); err != nil {
		return fmt.Errorf("write script.md: %w", err)
	}
	for platform, caption := range content.Captions {
		name := platform + ".txt"
		if err := os.WriteFile(filepath.Join(out, name), []byte(caption+"\n"), 0644); err != nil {
			return fmt.Errorf("write %s: %w", name, err)
		}
	}

	if id > 0 {
		fmt.Fprintf(f.IOStreams.Out, "Built shorts content from issue #%d\n", id)
	} else {
		fmt.Fprintln(f.IOStreams.Out, "Built shorts content from direct input")
	}
	fmt.Fprintf(f.IOStreams.Out, "  output: %s\n", out)
	fmt.Fprintf(f.IOStreams.Out, "  ai: %t\n", aiGenerated)
	return nil
}

func currentRepo(ctx context.Context) (string, error) {
	if repo := strings.TrimSpace(os.Getenv("GH_REPO")); repo != "" {
		return repo, nil
	}
	cmd := exec.CommandContext(ctx, "git", "remote", "get-url", "origin")
	out, err := cmd.Output()
	if err != nil {
		return "", errors.New("could not determine repository; run inside a git repository or set GH_REPO=OWNER/REPO")
	}
	s := strings.TrimSpace(string(out))
	s = strings.TrimSuffix(s, ".git")
	if strings.HasPrefix(s, "git@github.com:") {
		return strings.TrimPrefix(s, "git@github.com:"), nil
	}
	if u, err := url.Parse(s); err == nil && u.Host == "github.com" {
		parts := strings.Split(strings.Trim(u.Path, "/"), "/")
		if len(parts) == 2 {
			return parts[0] + "/" + parts[1], nil
		}
	}
	return "", fmt.Errorf("could not parse GitHub repository from origin %q", s)
}

func githubToken(ctx context.Context) (string, error) {
	for _, name := range []string{"GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN"} {
		if token := strings.TrimSpace(os.Getenv(name)); token != "" {
			return token, nil
		}
	}
	cmd := exec.CommandContext(ctx, "gh", "auth", "token")
	out, err := cmd.Output()
	if err != nil {
		return "", errors.New("GitHub authentication required; run: gh auth login")
	}
	if token := strings.TrimSpace(string(out)); token != "" {
		return token, nil
	}
	return "", errors.New("GitHub authentication required; run: gh auth login")
}

func fetchIssue(ctx context.Context, repo string, id int, token string) (*githubIssue, error) {
	u := "https://api.github.com/repos/" + repo + "/issues/" + strconv.Itoa(id)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch issue: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch issue: GitHub returned %s", resp.Status)
	}
	var issue githubIssue
	if err := json.NewDecoder(resp.Body).Decode(&issue); err != nil {
		return nil, fmt.Errorf("decode issue: %w", err)
	}
	return &issue, nil
}

func generateContent(ctx context.Context, issue *githubIssue, modelOverride string, noAI bool) (shortsContent, bool, error) {
	if noAI {
		return fallbackContent(issue), false, nil
	}

	apiKey := strings.TrimSpace(os.Getenv("SHORTS_AI_API_KEY"))
	if apiKey == "" {
		apiKey = strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	}
	if apiKey == "" {
		return shortsContent{}, false, errors.New("AI is required: set SHORTS_AI_API_KEY or OPENAI_API_KEY (use --no-ai only for the fallback)")
	}

	base := strings.TrimRight(os.Getenv("SHORTS_AI_BASE_URL"), "/")
	if base == "" {
		base = "https://api.openai.com/v1"
	}
	model := modelOverride
	if model == "" {
		model = os.Getenv("SHORTS_AI_MODEL")
	}
	if model == "" {
		model = "gpt-4.1-mini"
	}

	prompt := `You are an elite short-form video writer and social media producer.

Create a professional 45-60 second vertical video package from the source below.
The audience should understand the value within the first 2 seconds and want to keep watching.
Write naturally for spoken Arabic when the source/topic is Arabic; otherwise use the source language.

Requirements:
- Start with a strong curiosity-driven hook; no generic introductions.
- Write a spoken script designed for 45-60 seconds, with short sentences and natural pacing.
- Structure the script: HOOK -> VALUE/EXPLANATION -> 2-5 concrete points -> PAYOFF -> concise CTA.
- Make every sentence useful for narration; avoid filler and corporate language.
- Keep factual claims grounded strictly in the source. Never invent statistics, names, dates, quotes, or capabilities.
- Make the title punchy and platform-friendly without clickbait that contradicts the source.
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
` + issue.Title + `

Source body:
` + issue.Body

	payload := map[string]any{
		"model": model,
		"messages": []map[string]string{
			{"role": "system", "content": "You are an elite short-form video writer. Follow the user's JSON contract exactly."},
			{"role": "user", "content": prompt},
		},
		"temperature": 0.8,
		"response_format": map[string]string{"type": "json_object"},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return shortsContent{}, false, fmt.Errorf("encode AI request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return shortsContent{}, false, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return shortsContent{}, false, fmt.Errorf("AI request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return shortsContent{}, false, fmt.Errorf("AI request: provider returned %s", resp.Status)
	}

	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return shortsContent{}, false, fmt.Errorf("decode AI response: %w", err)
	}
	if len(result.Choices) == 0 || strings.TrimSpace(result.Choices[0].Message.Content) == "" {
		return shortsContent{}, false, errors.New("AI response did not contain content")
	}

	var content shortsContent
	if err := json.Unmarshal([]byte(cleanJSON(result.Choices[0].Message.Content)), &content); err != nil {
		return shortsContent{}, false, fmt.Errorf("decode generated content: %w", err)
	}
	if err := validateGeneratedContent(content); err != nil {
		return shortsContent{}, false, err
	}
	return content, true, nil
}

func validateGeneratedContent(content shortsContent) error {
	if strings.TrimSpace(content.Title) == "" || strings.TrimSpace(content.Hook) == "" || strings.TrimSpace(content.Script) == "" {
		return errors.New("AI response was incomplete: title, hook, and script are required")
	}
	if len([]rune(content.Script)) < 180 {
		return errors.New("AI response was too short for a 45-60 second script")
	}
	if len(content.Hashtags) == 0 {
		return errors.New("AI response did not include hashtags")
	}
	if len(content.Captions) == 0 {
		return errors.New("AI response did not include platform captions")
	}
	return nil
}

func cleanJSON(s string) string {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "```json")
	s = strings.TrimPrefix(s, "```")
	s = strings.TrimSuffix(s, "```")
	return strings.TrimSpace(s)
}

func fallbackContent(issue *githubIssue) shortsContent {
	title := strings.TrimSpace(issue.Title)
	body := strings.TrimSpace(issue.Body)
	if len(body) > 900 {
		body = body[:900] + "..."
	}
	hook := "What you need to know about " + title
	script := hook + ".\n\n" + body + "\n\nFollow for more updates."
	desc := title + "\n\n" + body
	hashtags := []string{"#shorts", "#github", "#tech"}
	caption := title + "\n\n" + body + "\n\n" + strings.Join(hashtags, " ")
	return shortsContent{Title: title, Hook: hook, Script: script, Description: desc, Hashtags: hashtags, Captions: map[string]string{"youtube": caption, "tiktok": caption, "facebook": caption}}
}

func renderScript(content shortsContent) string {
	return fmt.Sprintf("# %s\n\n## Hook\n%s\n\n## Script\n%s\n\n## Description\n%s\n\n## Hashtags\n%s\n", content.Title, content.Hook, content.Script, content.Description, strings.Join(content.Hashtags, " "))
}
