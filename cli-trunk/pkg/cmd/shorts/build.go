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
		Use:   "build <id>",
		Short: "Build a complete short-form content pack from a GitHub issue",
		Args:  cobra.ExactArgs(1),
		Example: `
  $ gh shorts build 42
  $ gh shorts build 42 --output ./shorts/42
  $ gh shorts build 42 --model gpt-4.1-mini
`,
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil || id < 1 {
				return fmt.Errorf("invalid id %q; expected a GitHub issue number", args[0])
			}
			return runBuild(cmd.Context(), f, id, opts)
		},
	}
	cmd.Flags().StringVarP(&opts.Output, "output", "o", "", "Output directory (default: .shorts/<id>)")
	cmd.Flags().StringVar(&opts.Model, "model", "", "AI model for an OpenAI-compatible API")
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

	content, aiGenerated, err := generateContent(ctx, issue, opts.Model)
	if err != nil {
		return err
	}
	content.ID = id
	content.SourceURL = issue.HTML
	content.GeneratedAt = time.Now().UTC().Format(time.RFC3339)
	content.AI = aiGenerated

	out := opts.Output
	if out == "" {
		out = filepath.Join(".shorts", strconv.Itoa(id))
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

	fmt.Fprintf(f.IOStreams.Out, "Built shorts content from issue #%d\n", id)
	fmt.Fprintf(f.IOStreams.Out, "  source: %s\n", issue.HTML)
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

func generateContent(ctx context.Context, issue *githubIssue, modelOverride string) (shortsContent, bool, error) {
	apiKey := strings.TrimSpace(os.Getenv("SHORTS_AI_API_KEY"))
	if apiKey == "" {
		return fallbackContent(issue), false, nil
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
	prompt := "Create a factual, engaging 45-60 second vertical short from this GitHub issue. Return ONLY JSON with keys title, hook, script, description, hashtags (array), captions (object with youtube, tiktok, facebook). Do not invent facts not present in the source. Source title: " + issue.Title + "\nSource body:\n" + issue.Body
	payload := map[string]any{
		"model": model,
		"messages": []map[string]string{{"role": "system", "content": "You are a short-form video producer."}, {"role": "user", "content": prompt}},
		"temperature": 0.7,
	}
	body, _ := json.Marshal(payload)
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
	return content, true, nil
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
