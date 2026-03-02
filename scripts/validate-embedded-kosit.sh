#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

VALIDATOR_DIR="tools/validator"
VALIDATOR_JAR="$VALIDATOR_DIR/validator.jar"
CONFIG_ZIP="$VALIDATOR_DIR/config.zip"
CONFIG_DIR="$VALIDATOR_DIR/config"
SCENARIOS_XML="$CONFIG_DIR/scenarios.xml"

mkdir -p "$VALIDATOR_DIR" artifacts/validator-report

if [[ ! -f "$VALIDATOR_JAR" ]]; then
  curl -fsSL \
    "https://github.com/itplr-kosit/validator/releases/download/v1.6.2/validator-1.6.2-standalone.jar" \
    -o "$VALIDATOR_JAR"
fi

if [[ ! -f "$SCENARIOS_XML" ]]; then
  curl -fsSL \
    "https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/download/v2026-01-31/xrechnung-3.0.2-validator-configuration-2026-01-31.zip" \
    -o "$CONFIG_ZIP"
  unzip -q -o "$CONFIG_ZIP" -d "$CONFIG_DIR"
fi

npx ts-node scripts/generate-zugferd-sample-pdf.ts
python3 scripts/extract_embedded_xml.py

java -jar "$VALIDATOR_JAR" \
  -s "$SCENARIOS_XML" \
  -r "$CONFIG_DIR" \
  -o artifacts/validator-report \
  -p artifacts/factur-x.xml
