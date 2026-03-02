# ZUGFeRD Embedder Service - TypeScript Implementation

## ZUGFeRDEmbedder Class

```typescript
// src/services/zugferd-embedder.ts
import { PDFDocument, PDFDict, PDFName, PDFArray, PDFString } from 'pdf-lib';

export class ZUGFeRDEmbedder {
  
  /**
   * Bettet ZUGFeRD XML in PDF ein
   */
  async embedZugferdXml(
    pdfBuffer: Buffer, 
    xmlContent: string
  ): Promise<Buffer> {
    
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    
    await this.embedXmlAsAttachment(pdfDoc, xmlContent);
    this.addPdfA3Metadata(pdfDoc);
    
    const modifiedPdfBytes = await pdfDoc.save({
      useObjectStreams: false,
      addDefaultPage: false
    });
    
    return Buffer.from(modifiedPdfBytes);
  }
  
  private async embedXmlAsAttachment(
    pdfDoc: PDFDocument, 
    xmlContent: string
  ): Promise<void> {
    
    const context = pdfDoc.context;
    const xmlBytes = new TextEncoder().encode(xmlContent);
    
    // 1. XML Stream
    const xmlStream = context.obj({
      Length: xmlBytes.length,
      Type: 'EmbeddedFile',
      Subtype: 'text/xml',
      Params: {
        Size: xmlBytes.length
      }
    });
    
    const compressed = require('pako').deflate(xmlBytes);
    xmlStream.dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
    context.assignRef(xmlStream, compressed);
    const xmlStreamRef = context.register(xmlStream);
    
    // 2. File Specification
    const fileSpec = context.obj({
      Type: 'Filespec',
      F: 'factur-x.xml',
      UF: 'factur-x.xml',
      AFRelationship: 'Alternative',
      Desc: 'Factur-X Invoice (ZUGFeRD 2.1)',
      EF: {
        F: xmlStreamRef,
        UF: xmlStreamRef
      }
    });
    
    const fileSpecRef = context.register(fileSpec);
    
    // 3. Names Dictionary
    let names = pdfDoc.catalog.lookup(PDFName.of('Names'), PDFDict);
    if (!names) {
      names = context.obj({});
      pdfDoc.catalog.set(PDFName.of('Names'), names);
    }
    
    let embeddedFiles = names.lookup(PDFName.of('EmbeddedFiles'), PDFDict);
    if (!embeddedFiles) {
      embeddedFiles = context.obj({});
      names.set(PDFName.of('EmbeddedFiles'), embeddedFiles);
    }
    
    const namesArray = context.obj([
      PDFString.of('factur-x.xml'),
      fileSpecRef
    ]);
    
    embeddedFiles.set(PDFName.of('Names'), namesArray);
    
    // 4. Associated Files
    let af = pdfDoc.catalog.lookup(PDFName.of('AF'), PDFArray);
    if (!af) {
      af = context.obj([]);
      pdfDoc.catalog.set(PDFName.of('AF'), af);
    }
    
    af.push(fileSpecRef);
  }
  
  private addPdfA3Metadata(pdfDoc: PDFDocument): void {
    const context = pdfDoc.context;
    const xmpMetadata = this.createPdfA3XmpMetadata();
    
    const metadataStream = context.obj({
      Type: 'Metadata',
      Subtype: 'XML',
      Length: xmpMetadata.length
    });
    
    const metadataBytes = new TextEncoder().encode(xmpMetadata);
    context.assignRef(metadataStream, metadataBytes);
    
    const metadataRef = context.register(metadataStream);
    pdfDoc.catalog.set(PDFName.of('Metadata'), metadataRef);
  }
  
  private createPdfA3XmpMetadata(): string {
    return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description 
        xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"
        xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
      
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
      
      <fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>
      <fx:DocumentType>INVOICE</fx:DocumentType>
      <fx:Version>1.0</fx:Version>
      <fx:ConformanceLevel>COMFORT</fx:ConformanceLevel>
      
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
  }
}
```

## Package Dependencies

```json
{
  "dependencies": {
    "pdf-lib": "^1.17.1",
    "pako": "^2.1.0"
  }
}
```
