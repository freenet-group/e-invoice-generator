#!/usr/bin/env bash
# =============================================================================
# setup-validator.sh
# Lädt den KOSIT Validator + XRechnung-Szenariokonfiguration herunter.
# Versionen werden aus package.json gelesen.
# Wird lokal via `npm run setup:validator` und in GitHub Actions ausgeführt.
#
# Hinweis: Asset-URLs werden dynamisch via GitHub API ermittelt,
# um bei Namensänderungen durch KOSIT robust zu bleiben.
# Optional: GITHUB_TOKEN setzen für höheres API Rate-Limit (5000/h statt 60/h).
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TARGET_DIR="${ROOT_DIR}/tools/validator"

# Versionen aus package.json lesen
VALIDATOR_VERSION=$(node -p "require('${ROOT_DIR}/package.json').validatorConfig.validatorVersion")
SCENARIO_VERSION=$(node -p "require('${ROOT_DIR}/package.json').validatorConfig.scenarioVersion")

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

# =============================================================================
# Helper: GitHub Release Asset-URL ermitteln
# Gibt die erste Download-URL zurück, deren Dateiname dem grep_pattern entspricht.
# =============================================================================
get_asset_url() {
  local repo="$1"
  local tag="$2"
  local grep_pattern="$3"

  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    curl -fsSL -H "Authorization: Bearer ${GITHUB_TOKEN}" \
      "https://api.github.com/repos/${repo}/releases/tags/${tag}"
  else
    curl -fsSL \
      "https://api.github.com/repos/${repo}/releases/tags/${tag}"
  fi \
    | grep '"browser_download_url"' \
    | grep -i "${grep_pattern}" \
    | head -1 \
    | sed 's/.*"browser_download_url": "\([^"]*\)".*/\1/' \
    || true
}

# =============================================================================
# 1. Validator JAR herunterladen
#    - Bis v1.5.x: validationtool-X.Y.Z-standalone.jar (direkt im Release)
#    - Ab v1.5.2:  validator-X.Y.Z.zip (ZIP enthält den standalone JAR)
# =============================================================================
echo "→ Ermittle Validator-Asset (v${VALIDATOR_VERSION})..."
VALIDATOR_TAG="v${VALIDATOR_VERSION}"

# Versuche zuerst direkt ausgeliefertes standalone JAR (ältere Releases)
STANDALONE_JAR_URL=$(get_asset_url "itplr-kosit/validator" "${VALIDATOR_TAG}" "standalone\.jar")

if [[ -n "${STANDALONE_JAR_URL}" ]]; then
  echo "→ Lade validator.jar (standalone JAR)..."
  curl -fsSL --progress-bar "${STANDALONE_JAR_URL}" -o "${TARGET_DIR}/validator.jar"
else
  # Neue Releases liefern ein ZIP; der standalone JAR liegt darin
  VALIDATOR_ZIP_URL=$(get_asset_url "itplr-kosit/validator" "${VALIDATOR_TAG}" "validator-.*\.zip")

  if [[ -z "${VALIDATOR_ZIP_URL}" ]]; then
    echo "Error: Kein Release-Asset für KOSIT Validator v${VALIDATOR_VERSION} gefunden." >&2
    echo "       Geprüfter Tag: ${VALIDATOR_TAG}" >&2
    exit 1
  fi

  echo "→ Lade validator.zip..."
  TEMP_VALIDATOR_ZIP=$(mktemp /tmp/validator-XXXXXX.zip)
  curl -fsSL --progress-bar "${VALIDATOR_ZIP_URL}" -o "${TEMP_VALIDATOR_ZIP}"

  echo "→ Extrahiere validator.jar aus ZIP..."
  # Bevorzuge standalone JAR (bis v1.6.0), fallback auf ersten JAR (v1.6.1+)
  INNER_JAR=$(
    unzip -l "${TEMP_VALIDATOR_ZIP}" \
      | awk '{print $NF}' \
      | grep '\.jar$' \
      | grep -i 'standalone' \
      | head -1
  )
  if [[ -z "${INNER_JAR}" ]]; then
    INNER_JAR=$(
      unzip -l "${TEMP_VALIDATOR_ZIP}" \
        | awk '{print $NF}' \
        | grep '\.jar$' \
        | head -1
    )
  fi

  if [[ -z "${INNER_JAR}" ]]; then
    echo "Error: Kein JAR in ${VALIDATOR_ZIP_URL} gefunden." >&2
    rm -f "${TEMP_VALIDATOR_ZIP}"
    exit 1
  fi

  unzip -jo "${TEMP_VALIDATOR_ZIP}" "${INNER_JAR}" -d "${TARGET_DIR}"
  mv "${TARGET_DIR}/$(basename "${INNER_JAR}")" "${TARGET_DIR}/validator.jar"
  rm -f "${TEMP_VALIDATOR_ZIP}"
fi

# =============================================================================
# 2. Szenario-Konfiguration herunterladen und entpacken
#    - Bis 2025-07-10: Tag release-{date}, ZIP validator-configuration-xrechnung-{date}.zip
#    - Ab  2026-01-31: Tag v{date},        ZIP xrechnung-{xr-version}-validator-configuration-{date}.zip
# =============================================================================
echo "→ Ermittle Szenario-Asset (${SCENARIO_VERSION})..."

# Neues Tag-Format zuerst probieren (v{date}), dann altes (release-{date})
SCENARIO_ASSET_URL=$(get_asset_url \
  "itplr-kosit/validator-configuration-xrechnung" \
  "v${SCENARIO_VERSION}" \
  "\.zip")

if [[ -z "${SCENARIO_ASSET_URL}" ]]; then
  SCENARIO_ASSET_URL=$(get_asset_url \
    "itplr-kosit/validator-configuration-xrechnung" \
    "release-${SCENARIO_VERSION}" \
    "\.zip")
fi

if [[ -z "${SCENARIO_ASSET_URL}" ]]; then
  echo "Error: Kein Release-Asset für Szenario-Konfiguration ${SCENARIO_VERSION} gefunden." >&2
  exit 1
fi

echo "→ Lade Szenario-Konfiguration..."
TEMP_ZIP=$(mktemp /tmp/validator-config-XXXXXX.zip)
curl -fsSL --progress-bar "${SCENARIO_ASSET_URL}" -o "${TEMP_ZIP}"

echo "→ Entpacke Konfiguration..."
rm -rf "${TARGET_DIR}/config"
mkdir -p "${TARGET_DIR}/config"

# ZIP enthält ein Unterverzeichnis — Inhalt eine Ebene nach oben verschieben
unzip -q "${TEMP_ZIP}" -d "${TARGET_DIR}/config-tmp"
ZIP_SUBDIR=$(ls -1 "${TARGET_DIR}/config-tmp/" | head -1)
mv "${TARGET_DIR}/config-tmp/${ZIP_SUBDIR}"/* "${TARGET_DIR}/config/"
rm -rf "${TARGET_DIR}/config-tmp" "${TEMP_ZIP}"

# Version speichern
echo "${VALIDATOR_VERSION}_${SCENARIO_VERSION}" > "${VERSION_FILE}"

echo ""
echo "✓ KOSIT Validator bereit."
