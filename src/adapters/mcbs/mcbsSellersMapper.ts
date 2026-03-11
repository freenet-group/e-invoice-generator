/**
 * Seller-Konfiguration je MCBS Brand-Group (GROUP_SHORTCUT).
 *
 * Quelle: MCBS XML → HEADER/BRAND/GROUP_SHORTCUT
 *
 * Hintergrund:
 * - Es gibt 9 Brand-Groups im MCBS-System.
 * - Alle außer KM verwenden freenet AG als Rechnungssteller.
 * - KM mappt auf einen abweichenden Rechnungssteller.
 *
 * Die Daten ändern sich kaum → statische Ressource ist Parameter Store vorzuziehen
 * (kein AWS-API-Call pro Lambda-Invocation, keine IAM-Permission, zero Latenz).
 * Bei Änderungen: Datei editieren + Redeployment.
 */

import type {Party} from '../../models/commonInvoice'

// ─── Seller-Definitionen ────────────────────────────────────────────────────

const freenetAG: Party = {
    name: 'freenet DLS GmbH',
    postalAddress: {
        streetName: 'Hollerstraße 126',
        postalCode: '24782',
        cityName: 'Büdelsdorf',
        countryCode: 'DE'
    },
    vatNumber: 'DE194910634',
    taxRegistration: [
        {
            id: {
                value: 'DE194910634',
                schemeId: 'VAT'
            }
        }
    ],
    legalOrganization: {
        id: {
            value: 'HRB 14826 KI,',
            schemeId: 'HRB'
        }
    },
    contact: {
        name: 'Rechnungsservice',
        telephone: '+49 461 66050',
        email: 'rechnung@freenet.de'
    },
    creditorId: 'DE43ZZZ00000074855'
}

/**
 *
 * GROUP_SHORTCUT "KM" mappt auf einen abweichenden Rechnungssteller.
 */
const kmSeller: Party = {
    name: 'klarmobil GmbH',
    postalAddress: {
        streetName: 'Holstenstraße 126',
        postalCode: '24782',
        cityName: 'Büdelsdorf',
        countryCode: 'DE'
    },
    vatNumber: 'DE278584916',
    taxRegistration: [
        {
            id: {
                value: 'DE278584916',
                schemeId: 'VAT'
            }
        }
    ],
    legalOrganization: {
        id: {
            value: 'HRB 119203 HH',
            schemeId: 'HRB'
        }
    },
    contact: {
        name: 'klarmobil Kundenservice',
        telephone: '+49 40 348585300',
        email: 'info@klarmobil.de'
    },
    creditorId: 'DE53ZZZ00000074869'
}

// ─── Lookup-Map GROUP_SHORTCUT → Party ───────────────────────────────

/**
 * Alle bekannten GROUP_SHORTCUTs.
 * Nicht gelistete Kürzel erhalten den Default-Seller (freenetAG).
 */
const sellerByGroupShortcut: Readonly<Record<string, Party>> = {
    // Standard-Seller (alle Brand-Groups außer KM)
    MC: freenetAG,
    WS: freenetAG,
    TL: freenetAG,
    DL: freenetAG,
    TM: freenetAG,
    EX: freenetAG,
    FU: freenetAG,

    // Abweichender Seller
    KM: kmSeller
}

// ─── Öffentliche API ─────────────────────────────────────────────────────────

/**
 * Gibt den Seller anhand des MCBS GROUP_SHORTCUT zurück.
 * Unbekannte Kürzel → freenetAG als sicherer Fallback (mit Warnung im Log).
 */
export function getSellerByGroupShortcut(groupShortcut: string | undefined, warn?: (msg: string) => void): Party {
    if (groupShortcut === undefined || groupShortcut === '') {
        warn?.(`BRAND/GROUP_SHORTCUT fehlt – verwende Default-Seller (freenetAG)`)
        return freenetAG
    }

    const seller = sellerByGroupShortcut[groupShortcut]

    if (seller === undefined) {
        warn?.(`Unbekannter GROUP_SHORTCUT "${groupShortcut}" – verwende Default-Seller (freenetAG)`)
        return freenetAG
    }

    return seller
}
