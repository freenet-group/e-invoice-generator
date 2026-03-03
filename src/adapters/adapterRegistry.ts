import { InvoiceAdapter } from './invoiceAdapter'

/**
 * Adapter Registry - Factory für Adapter-Instanzen
 */
export class AdapterRegistry {
    private readonly adapters = new Map<string, () => InvoiceAdapter>()

    register(source: string, factory: () => InvoiceAdapter): void {
        this.adapters.set(source, factory)
    }

    getAdapter(source: string): InvoiceAdapter {
        const factory = this.adapters.get(source)

        if (factory === undefined) {
            throw new Error(`No adapter registered for source: ${source}`)
        }

        return factory()
    }

    hasAdapter(source: string): boolean {
        return this.adapters.has(source)
    }

    getSources(): string[] {
        return Array.from(this.adapters.keys())
    }
}