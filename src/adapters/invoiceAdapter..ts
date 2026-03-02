/**
 * Invoice Adapter Interface
 * 
 * Definiert das Contract für alle Invoice-Source-Adapter
 * Ermöglicht Plugin-Architektur für verschiedene Input-Formate
 */

import { CommonInvoice } from '../models/commonInvoice'

/**
 * Adapter Interface - jedes Source-System implementiert dies
 */
export interface InvoiceAdapter {
  /**
   * Lädt Invoice-Daten aus dem jeweiligen Quellsystem
   * 
   * @param eventPayload - Event vom Trigger (S3, DynamoDB, etc.)
   * @returns Raw Invoice Data mit Metadata
   */
  loadInvoiceData(eventPayload: Record<string, unknown>): Promise<RawInvoiceData>
  
  /**
   * Mappt Source-spezifische Daten zu Common Invoice Model
   * 
   * @param rawData - Rohdaten vom Quellsystem
   * @returns Standardisiertes Invoice Format
   */
  mapToCommonModel(rawData: RawInvoiceData): CommonInvoice;
  
  /**
   * Lädt zugehöriges PDF (falls separat gespeichert)
   * 
   * @param invoice - Common Invoice mit PDF-Referenz
   * @returns PDF als Buffer, oder null wenn nicht verfügbar
   */
  loadPDF(invoice: CommonInvoice): Promise<Buffer | null>;
}

/**
 * Raw Invoice Data - Wrapper für Quelldaten
 */
export interface RawInvoiceData {
  /** Quellsystem */
  source: 'MCBS' | 'AWS_BILLING';
  
  /** Rohdaten (XML, JSON, etc.) */
  data: Record<string, unknown>
  
  /** Metadata */
  metadata: {
    /** Eindeutige ID */
    id: string;
    
    /** Zeitstempel */
    timestamp: string;
    
    /** Zusätzliche Infos */
    [key: string]: string | number | boolean | undefined
  };
}

/**
 * Konfiguration für alle Invoice Adapter
 * 
 * Definiert wie ein Adapter aus einem Trigger-Event
 * den Pfad zur Primärdatei ableitet
 */
export interface InvoiceAdapterConfig {
    /**
     * Leitet den Key der Primärdatei (z.B. XML, JSON) aus dem
     * Trigger-Key (z.B. PDF, S3-Event) ab.
     *
     * MCBS:        pdfKey → xmlKey
     * AWS Billing: pdfKey → jsonKey
     *
     * @param triggerKey - S3 Key der Datei die das Event ausgelöst hat
     * @returns S3 Key der zu ladenden Primärdatei
     */
    resolvePrimaryKey?: (triggerKey: string) => string

    /**
     * S3 Bucket der Primärdatei — falls abweichend vom Trigger-Bucket
     * 
     * Default: gleicher Bucket wie Trigger
     */
    primaryBucket?: string
}
