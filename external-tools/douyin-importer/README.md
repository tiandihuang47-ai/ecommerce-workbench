# douyin-importer

One-shot CLI sidecar for director-platform. It accepts a Douyin share text or
URL, downloads one public normal video, and emits JSON on stdout. Debug logs go
to stderr. It intentionally does not implement replica tasks, assets, Video DNA,
or prompt generation.
