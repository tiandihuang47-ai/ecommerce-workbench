#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
python3 -m pip install --upgrade pyinstaller
python3 -m PyInstaller \
  --onefile \
  --name douyin-importer \
  --paths ../douyin-downloader \
  --hidden-import aiohttp \
  --hidden-import yaml \
  douyin_importer.py
mkdir -p dist
mv dist/douyin-importer dist/douyin-importer
