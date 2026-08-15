package shorts

import (
	"os"
	"path/filepath"
	"testing"
)

func TestValidateUpload(t *testing.T) {
	tmp := t.TempDir()
	video := filepath.Join(tmp, "video.mp4")
	if err := os.WriteFile(video, []byte("test"), 0600); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name string
		opts UploadOptions
		want bool
	}{
		{
			name: "valid",
			opts: UploadOptions{File: video, Platforms: []string{"youtube", "tiktok", "facebook"}, Privacy: "private"},
			want: true,
		},
		{
			name: "missing file",
			opts: UploadOptions{File: filepath.Join(tmp, "missing.mp4"), Platforms: []string{"youtube"}, Privacy: "private"},
		},
		{
			name: "unsupported extension",
			opts: UploadOptions{File: filepath.Join(tmp, "video.txt"), Platforms: []string{"youtube"}, Privacy: "private"},
		},
		{
			name: "unsupported platform",
			opts: UploadOptions{File: video, Platforms: []string{"instagram"}, Privacy: "private"},
		},
		{
			name: "duplicate platform",
			opts: UploadOptions{File: video, Platforms: []string{"youtube", "youtube"}, Privacy: "private"},
		},
		{
			name: "invalid privacy",
			opts: UploadOptions{File: video, Platforms: []string{"youtube"}, Privacy: "friends"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateUpload(&tt.opts)
			if (err == nil) != tt.want {
				t.Fatalf("validateUpload() error = %v, want success = %v", err, tt.want)
			}
		})
	}
}

func TestIsSupportedPlatform(t *testing.T) {
	for _, platform := range []string{"youtube", "tiktok", "facebook"} {
		if !isSupportedPlatform(platform) {
			t.Errorf("expected %q to be supported", platform)
		}
	}
	if isSupportedPlatform("instagram") {
		t.Error("expected instagram to be unsupported")
	}
}
