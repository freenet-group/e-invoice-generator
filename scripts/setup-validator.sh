#!/usr/bin/env bash
# =============================================================================
# setup-validator.sh
# Lädt den KOSIT Validator + XRechnung-Szenariokonfiguration herunter.
# Versionen werden aus package.json gelesen.
# Wird lokal via `npm run setup:validator` und in GitHub Actions ausgeführt.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TARGET_DIR="${ROOT_DIR}/tools/validator"

# Versionen aus package.json lesen
VALIDATOR_VERSION=$(node -p "require('${ROOT_DIR}/package.json').validatorConfig.validatorVersion")
SCENARIO_VERSION=$(node -p "require('${ROOT_DIR}/package.json').validatorConfig.scenarioVersion")

JAR_URL="https://github.com/itplr-kosit/validator/releases/download/v${VALIDATOR_VERSION}/validationtool-${VALIDATOR_VERSION}-standalone.jar"
CONFIG_URL="https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/download/release-${SCENARIO_VERSION}/validator-configuration-xrechnung-${SCENARIO_VERSION}.zip"

echo "KOSIT Validator Setup"
echo "  Validator:  v${VALIDATOR_VERSION}"
echo "  Szenario:   ${SCENARIO_VERSION}"
echo "  Zielordner: ${TARGET_DIR}"
echo ""

# Prüfen ob bereits aktuell
VERSION_FILE="${TARGET_DIR}/.version"
if [[ -f "${VERSION_FILE}" ]]; then
  INSTALLED=$(cat "${VERSION_FILE}")
  if [[ "${INSTALLED}" == "${VALIDATOR_VERSION}_${SCENARIO_VERSION}" ]]; then
    echo "✓ Validator bereits aktuell (${INSTALLED}), überspringe Download."
    exit 0
  fi
fi

mkdir -p "${TARGET_DIR}"

# 1. Validator JAR herunterladen
echo "→ Lade validator.jar..."
curl -fsSL --progress-bar \
  "${JAR_URL}" \
  -o "${TARGET_DIR}/validator.jar"

# 2. Szenario-Konfiguration herunterladen und entpacken
echo "→ Lade Szenario-Konfiguration..."
TEMP_ZIP=$(mktemp /tmp/validator-config-XXXXXX.zip)
curl -fsSL --progress-bar \
  "${CONFIG_URL}" \
  -o "${TEMP_ZIP}"

echo "→ Entpacke Konfiguration..."
rm -rf "${TARGET_DIR}/config"
mkdir -p "${TARGET_DIR}/config"

# ZIP-Inhalt direkt in config/ entpacken (oberstes Verzeichnis im ZIP überspringen)
unzip -q "${TEMP_ZIP}" -d "${TARGET_DIR}/config-tmp"
# Das ZIP enthält ein Unterverzeichnis — Inhalt eine Ebene nach oben verschieben
ZIP_SUBDIR=$(ls "${TARGET_DIR}/config-tmp/")
mv "${TARGET_DIR}/config-tmp/${ZIP_SUBDIR}"/* "${TARGET_DIR}/config/"
rm -rf "${TARGET_DIR}/config-tmp" "${TEMP_ZIP}"

# Version speichern
echo "${VALIDATOR_VERSION}_${SCENARIO_VERSION}" > "${VERSION_FILE}"

echo ""
echo "✓ KOSIT Validator bereit."
