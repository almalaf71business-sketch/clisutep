package shorts

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/MakeNowJust/heredoc"
	"github.com/cli/cli/v2/pkg/cmdutil"
	"github.com/spf13/cobra"
)

var supportedPlatforms = []string{"youtube", "tiktok", "facebook"}

type UploadOptions struct {
	File        string
	Platforms   []string
	Title       string
	Description string
	Privacy     string
	DryRun      bool
}

func NewCmdShorts(f *cmdutil.Factory) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "shorts <command>",
		Short: "Publish short-form videos to supported platforms",
		Long: heredoc.Doc(`
			Manage short-form video publishing from the GitHub CLI.

			Supported platforms:
			- YouTube Shorts
			- TikTok
			- Facebook Reels
		`),
	}

	cmd.AddCommand(newUploadCmd(f))
	return cmd
}

func newUploadCmd(f *cmdutil.Factory) *cobra.Command {
	opts := &UploadOptions{}

	cmd := &cobra.Command{
		Use:   "upload <video-file>",
		Short: "Prepare a short-form video for publishing",
		Args:  cobra.ExactArgs(1),
		Example: heredoc.Doc(`
			$ gh shorts upload video.mp4 --dry-run
			$ gh shorts upload video.mp4 --platform youtube --title "My Short"
			$ gh shorts upload video.mp4 --platform youtube,tiktok,facebook
		`),
		RunE: func(cmd *cobra.Command, args []string) error {
			opts.File = args[0]
			if err := validateUpload(opts); err != nil {
				return err
			}

			if opts.DryRun {
				fmt.Fprintf(f.IOStreams.Out, "Shorts upload plan:\n")
				fmt.Fprintf(f.IOStreams.Out, "  file: %s\n", opts.File)
				fmt.Fprintf(f.IOStreams.Out, "  platforms: %s\n", strings.Join(opts.Platforms, ", "))
				if opts.Title != "" {
					fmt.Fprintf(f.IOStreams.Out, "  title: %s\n", opts.Title)
				}
				if opts.Description != "" {
					fmt.Fprintf(f.IOStreams.Out, "  description: %s\n", opts.Description)
				}
				fmt.Fprintf(f.IOStreams.Out, "  privacy: %s\n", opts.Privacy)
				return nil
			}

			return fmt.Errorf("shorts publishing adapters are not enabled yet; rerun with --dry-run to validate the upload")
		},
	}

	cmd.Flags().StringSliceVarP(&opts.Platforms, "platform", "p", supportedPlatforms, "Target platforms: youtube, tiktok, facebook")
	cmd.Flags().StringVar(&opts.Title, "title", "", "Video title")
	cmd.Flags().StringVar(&opts.Description, "description", "", "Video description")
	cmd.Flags().StringVar(&opts.Privacy, "privacy", "private", "Privacy: private, unlisted, public")
	cmd.Flags().BoolVar(&opts.DryRun, "dry-run", false, "Validate and show the upload plan without publishing")

	return cmd
}

func validateUpload(opts *UploadOptions) error {
	info, err := os.Stat(opts.File)
	if err != nil {
		return fmt.Errorf("video file: %w", err)
	}
	if info.IsDir() {
		return fmt.Errorf("video file must be a file, not a directory")
	}

	ext := strings.ToLower(filepath.Ext(opts.File))
	if ext != ".mp4" && ext != ".mov" && ext != ".webm" {
		return fmt.Errorf("unsupported video format %q; use .mp4, .mov, or .webm", ext)
	}

	if len(opts.Platforms) == 0 {
		return fmt.Errorf("at least one platform is required")
	}

	seen := map[string]bool{}
	for _, platform := range opts.Platforms {
		platform = strings.ToLower(strings.TrimSpace(platform))
		if seen[platform] {
			return fmt.Errorf("platform %q was specified more than once", platform)
		}
		seen[platform] = true
		if !isSupportedPlatform(platform) {
			return fmt.Errorf("unsupported platform %q; choose youtube, tiktok, or facebook", platform)
		}
	}

	switch opts.Privacy {
	case "private", "unlisted", "public":
	default:
		return fmt.Errorf("invalid privacy %q; choose private, unlisted, or public", opts.Privacy)
	}

	return nil
}

func isSupportedPlatform(platform string) bool {
	for _, supported := range supportedPlatforms {
		if platform == supported {
			return true
		}
	}
	return false
}
