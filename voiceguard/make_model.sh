#!/bin/bash
# 한국어 Vosk 음성인식 모델을 웹용(tar.gz)으로 준비하는 스크립트 (macOS / Linux)
# 사용법: 이 파일이 있는 폴더에서  bash make_model.sh
set -e
NAME=vosk-model-small-ko-0.22
mkdir -p models
cd models
if [ ! -d "$NAME" ]; then
  echo "▶ 모델 내려받는 중 (약 80MB)…"
  curl -L -o "$NAME.zip" "https://alphacephei.com/vosk/models/$NAME.zip"
  unzip -q "$NAME.zip"
  rm "$NAME.zip"
fi
echo "▶ 웹용 압축 파일 만드는 중…"
tar -czf "$NAME.tar.gz" "$NAME"
echo "✅ 완료: models/$NAME.tar.gz"
ls -lh "$NAME.tar.gz"
