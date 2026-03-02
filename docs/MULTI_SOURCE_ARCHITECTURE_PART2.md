# Multi-Source E-Invoice Architecture (Teil 2): Lambda Handler & EventBridge

## 5. Unified Lambda Handler mit Adapter Factory

```typescript
// src/handlers/unified-e-invoice.handler.ts

import { EventBridgeEvent } from 'aws-lambda';
import { CIIGenerator, PDFEmbed } from '@e-invoice-eu/core';
import { InvoiceAdapter } from '../adapters/invoice-adapter.interface';
import { MCBSAdapter } from '../adapters/mcbs-adapter';
import { AWSBillingAdapter } from '../adapters/aws-billing-adapter';
import { DeduplicationService } from '../services/deduplication.service';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({ region: process.env.AWS_REGION });
const ciiGenerator = new CIIGenerator();
const pdfEmbed = new PDFEmbed();
const deduplicationService = new DeduplicationService();

/**
 * Unified E-Invoice Handler
 * Unterstützt MCBS (Legacy) und AWS Billing Service (Neu)
 */
export const handler = async (event: EventBridgeEvent<string, any>) => {
  
  console.log('Processing E-Invoice Event:', JSON.stringify(event, null, 2));
  
  try {
    // 1. Adapter Factory: Bestimme Source System
    const adapter = createAdapter(event);
    
    console.log(`Using adapter: ${adapter.constructor.name}`);
    
    // 2. Lade Invoice-Daten via Adapter
    const rawInvoice = await adapter.loadInvoiceData(event);
    
    // 3. Deduplication Check
    const isNew = await deduplicationService.isNewMessage(
      rawInvoice.metadata.id,
      rawInvoice.source
    );
    
    if (!isNew) {
      console.log(`⚠️ Duplicate detected: ${rawInvoice.metadata.id}`);
      return { statusCode: 200, message: 'Duplicate skipped' };
    }
    
    // 4. Map zu Common Invoice Model
    const commonInvoice = await adapter.mapToCommonModel(rawInvoice);
    
    console.log(`Mapped invoice: ${commonInvoice.invoiceNumber}`);
    
    // 5. Generiere ZUGFeRD XML
    const zugferdXml = ciiGenerator.generate(commonInvoice, {
      profile: 'COMFORT',
      version: '2.1.1'
    });
    
    // 6. Lade PDF
    const pdfBuffer = await adapter.loadPDF(commonInvoice);
    
    if (!pdfBuffer) {
      throw new Error('PDF not found');
    }
    
    // 7. Bette ZUGFeRD XML in PDF ein
    const eInvoicePdf = await pdfEmbed.embed(pdfBuffer, zugferdXml, {
      pdfAVersion: '3b',
      filename: 'factur-x.xml'
    });
    
    // 8. Speichere E-Rechnung in S3
    const outputKey = buildOutputKey(commonInvoice);
    
    await s3.send(new PutObjectCommand({
      Bucket: process.env.OUTPUT_BUCKET_NAME!,
      Key: outputKey,
      Body: eInvoicePdf,
      ContentType: 'application/pdf',
      Metadata: {
        'invoice-number': commonInvoice.invoiceNumber,
        'source-system': commonInvoice.source.system,
        'zugferd-version': '2.1.1',
        'pdf-a-version': '3b'
      }
    }));
    
    console.log(`✅ E-Invoice created: s3://${process.env.OUTPUT_BUCKET_NAME}/${outputKey}`);
    
    return {
      statusCode: 200,
      body: {
        invoiceNumber: commonInvoice.invoiceNumber,
        sourceSystem: commonInvoice.source.system,
        outputKey: outputKey
      }
    };
    
  } catch (error: any) {
    console.error('Failed to create E-Invoice:', error);
    throw error;
  }
};

/**
 * Adapter Factory: Bestimmt Source System anhand Event
 */
function createAdapter(event: EventBridgeEvent<string, any>): InvoiceAdapter {
  
  const source = event.source;
  const detailType = event['detail-type'];
  
  // MCBS Legacy: S3 Event via EventBridge
  if (source === 'aws.s3' && detailType === 'Object Created') {
    return new MCBSAdapter();
  }
  
  // AWS Billing Service: DynamoDB Stream via EventBridge
  if (source === 'aws.dynamodb' && detailType === 'DynamoDB Stream Record') {
    return new AWSBillingAdapter();
  }
  
  // Custom EventBridge Events
  if (source === 'custom.billing.service') {
    return new AWSBillingAdapter();
  }
  
  throw new Error(`Unsupported event source: ${source}`);
}

/**
 * Baut S3 Output Key
 */
function buildOutputKey(invoice: any): string {
  const date = new Date(invoice.invoiceDate);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  return `e-invoices/${year}/${month}/${day}/${invoice.invoiceNumber}_zugferd.pdf`;
}
```

---

## 6. EventBridge Configuration

### serverless.yml (aktualisiert)

```yaml
service: mcbs-zugferd-converter

provider:
  name: aws
  runtime: nodejs18.x
  region: eu-central-1
  stage: ${opt:stage, 'dev'}
  memorySize: 2048
  timeout: 60
  
  environment:
    DEDUP_TABLE_NAME: !Ref DeduplicationTable
    BILLING_TABLE_NAME: ${self:custom.billingTableName}
    PDF_BUCKET_NAME: ${self:custom.pdfBucketName}
    OUTPUT_BUCKET_NAME: mcbs-invoices-${self:provider.stage}

functions:
  
  # Unified E-Invoice Generator
  createEInvoice:
    handler: src/handlers/unified-e-invoice.handler
    description: Creates E-Invoices from MCBS or AWS Billing Service
    memorySize: 2048
    timeout: 60
    
    events:
      # Event 1: MCBS Legacy (S3 via EventBridge)
      - eventBridge:
          eventBus: default
          pattern:
            source:
              - aws.s3
            detail-type:
              - Object Created
            detail:
              bucket:
                name:
                  - mcbs-invoices-${self:provider.stage}
              object:
                key:
                  - prefix: raw/
                  - suffix: .xml
      
      # Event 2: AWS Billing Service (DynamoDB Stream via EventBridge)
      - eventBridge:
          eventBus: default
          pattern:
            source:
              - aws.dynamodb
            detail-type:
              - DynamoDB Stream Record
            detail:
              eventSource:
                - aws:dynamodb
              eventName:
                - INSERT
                - MODIFY
              dynamodb:
                Keys:
                  invoiceId:
                    S:
                      - exists: true
      
      # Event 3: Custom Billing Events (optional)
      - eventBridge:
          eventBus: default
          pattern:
            source:
              - custom.billing.service
            detail-type:
              - Invoice Created
              - Invoice Updated

resources:
  Resources:
    
    # EventBridge Rule: S3 → EventBridge
    S3ToEventBridgeRule:
      Type: AWS::Events::Rule
      Properties:
        Name: mcbs-s3-to-eventbridge-${self:provider.stage}
        EventBusName: default
        EventPattern:
          source:
            - aws.s3
          detail-type:
            - Object Created
          detail:
            bucket:
              name:
                - mcbs-invoices-${self:provider.stage}
        State: ENABLED
        Targets:
          - Arn: !GetAtt CreateEInvoiceLambdaFunction.Arn
            Id: InvokeCreateEInvoiceLambda
    
    # EventBridge Permission
    EventBridgeInvokePermission:
      Type: AWS::Lambda::Permission
      Properties:
        FunctionName: !Ref CreateEInvoiceLambdaFunction
        Action: lambda:InvokeFunction
        Principal: events.amazonaws.com
        SourceArn: !GetAtt S3ToEventBridgeRule.Arn
    
    # S3 Bucket (MCBS Legacy)
    McbsInvoicesBucket:
      Type: AWS::S3::Bucket
      Properties:
        BucketName: mcbs-invoices-${self:provider.stage}
        NotificationConfiguration:
          EventBridgeConfiguration:
            EventBridgeEnabled: true  # ← S3 → EventBridge aktivieren

custom:
  billingTableName: aws-billing-invoices-${self:provider.stage}
  pdfBucketName: mcbs-invoices-${self:provider.stage}
```

---

## 7. Alternative: API Gateway für REST API

Falls AWS Billing Service via REST API integriert werden soll:

```yaml
functions:
  
  # REST API Endpoint für manuelle E-Invoice Generierung
  createEInvoiceAPI:
    handler: src/handlers/api-e-invoice.handler
    events:
      - http:
          path: /e-invoices
          method: POST
          cors: true
          authorizer:
            type: aws_iam
```

### API Handler

```typescript
// src/handlers/api-e-invoice.handler.ts

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { AWSBillingAdapter } from '../adapters/aws-billing-adapter';
import { CIIGenerator, PDFEmbed } from '@e-invoice-eu/core';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  
  try {
    // Parse Request
    const requestBody = JSON.parse(event.body || '{}');
    const { invoiceId } = requestBody;
    
    if (!invoiceId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'invoiceId required' })
      };
    }
    
    // Lade Invoice via Adapter
    const adapter = new AWSBillingAdapter();
    const rawInvoice = await adapter.loadInvoiceData({
      detail: { dynamodb: { Keys: { invoiceId: { S: invoiceId } } } }
    });
    
    const commonInvoice = await adapter.mapToCommonModel(rawInvoice);
    
    // Generiere ZUGFeRD
    const ciiGenerator = new CIIGenerator();
    const zugferdXml = ciiGenerator.generate(commonInvoice, {
      profile: 'COMFORT',
      version: '2.1.1'
    });
    
    // Lade PDF & Embed
    const pdfBuffer = await adapter.loadPDF(commonInvoice);
    const pdfEmbed = new PDFEmbed();
    const eInvoicePdf = await pdfEmbed.embed(pdfBuffer!, zugferdXml, {
      pdfAVersion: '3b',
      filename: 'factur-x.xml'
    });
    
    // Return als Base64 (oder Upload zu S3 und return URL)
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${commonInvoice.invoiceNumber}_zugferd.pdf"`
      },
      body: eInvoicePdf.toString('base64'),
      isBase64Encoded: true
    };
    
  } catch (error: any) {
    console.error('API Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
```

---

## 8. DynamoDB Stream für AWS Billing Service

### DynamoDB Table Setup

```yaml
resources:
  Resources:
    
    # AWS Billing Invoices Table
    BillingInvoicesTable:
      Type: AWS::DynamoDB::Table
      Properties:
        TableName: aws-billing-invoices-${self:provider.stage}
        BillingMode: PAY_PER_REQUEST
        
        AttributeDefinitions:
          - AttributeName: invoiceId
            AttributeType: S
          - AttributeName: customerId
            AttributeType: S
        
        KeySchema:
          - AttributeName: invoiceId
            KeyType: HASH
        
        GlobalSecondaryIndexes:
          - IndexName: CustomerIndex
            KeySchema:
              - AttributeName: customerId
                KeyType: HASH
            Projection:
              ProjectionType: ALL
        
        # Stream für E-Invoice Trigger
        StreamSpecification:
          StreamViewType: NEW_AND_OLD_IMAGES  # ← DynamoDB Stream
        
        # EventBridge Integration
        StreamSpecification:
          StreamViewType: NEW_IMAGE
        
        Tags:
          - Key: Service
            Value: aws-billing-service
```

### EventBridge Pipe: DynamoDB Stream → EventBridge

```yaml
resources:
  Resources:
    
    # EventBridge Pipe: DynamoDB → EventBridge
    BillingStreamPipe:
      Type: AWS::Pipes::Pipe
      Properties:
        Name: billing-stream-to-eventbridge-${self:provider.stage}
        RoleArn: !GetAtt PipeRole.Arn
        
        Source: !GetAtt BillingInvoicesTable.StreamArn
        SourceParameters:
          DynamoDBStreamParameters:
            StartingPosition: LATEST
            BatchSize: 10
        
        Target: !Sub 'arn:aws:events:${AWS::Region}:${AWS::AccountId}:event-bus/default'
        TargetParameters:
          EventBridgeEventBusParameters:
            DetailType: Invoice Created
            Source: custom.billing.service
    
    # IAM Role für Pipe
    PipeRole:
      Type: AWS::IAM::Role
      Properties:
        AssumeRolePolicyDocument:
          Version: '2012-10-17'
          Statement:
            - Effect: Allow
              Principal:
                Service: pipes.amazonaws.com
              Action: sts:AssumeRole
        Policies:
          - PolicyName: PipePolicy
            PolicyDocument:
              Version: '2012-10-17'
              Statement:
                - Effect: Allow
                  Action:
                    - dynamodb:DescribeStream
                    - dynamodb:GetRecords
                    - dynamodb:GetShardIterator
                    - dynamodb:ListStreams
                  Resource: !GetAtt BillingInvoicesTable.StreamArn
                
                - Effect: Allow
                  Action:
                    - events:PutEvents
                  Resource: !Sub 'arn:aws:events:${AWS::Region}:${AWS::AccountId}:event-bus/default'
```

---

## 9. Monitoring & Observability

### Custom Metrics pro Source System

```typescript
// src/utils/metrics.ts

import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

const cloudwatch = new CloudWatchClient({ region: process.env.AWS_REGION });

export async function recordInvoiceProcessed(
  sourceSystem: 'MCBS' | 'AWS_BILLING',
  invoiceNumber: string,
  durationMs: number
): Promise<void> {
  
  await cloudwatch.send(new PutMetricDataCommand({
    Namespace: 'EInvoice/Processing',
    MetricData: [
      {
        MetricName: 'InvoicesProcessed',
        Value: 1,
        Unit: 'Count',
        Timestamp: new Date(),
        Dimensions: [
          {
            Name: 'SourceSystem',
            Value: sourceSystem
          }
        ]
      },
      {
        MetricName: 'ProcessingDuration',
        Value: durationMs,
        Unit: 'Milliseconds',
        Timestamp: new Date(),
        Dimensions: [
          {
            Name: 'SourceSystem',
            Value: sourceSystem
          }
        ]
      }
    ]
  }));
}
```

### CloudWatch Dashboard

```yaml
resources:
  Resources:
    
    EInvoiceDashboard:
      Type: AWS::CloudWatch::Dashboard
      Properties:
        DashboardName: e-invoice-processing-${self:provider.stage}
        DashboardBody: !Sub |
          {
            "widgets": [
              {
                "type": "metric",
                "properties": {
                  "title": "Invoices by Source System",
                  "metrics": [
                    [ "EInvoice/Processing", "InvoicesProcessed", { "stat": "Sum", "label": "MCBS" } ],
                    [ ".", ".", { "stat": "Sum", "label": "AWS Billing" } ]
                  ],
                  "period": 300,
                  "region": "${AWS::Region}"
                }
              },
              {
                "type": "metric",
                "properties": {
                  "title": "Processing Duration by Source",
                  "metrics": [
                    [ "EInvoice/Processing", "ProcessingDuration", { "stat": "Average" } ]
                  ],
                  "period": 300,
                  "region": "${AWS::Region}"
                }
              }
            ]
          }
```

---

## 10. Migration Strategy

### Phase 1: Legacy MCBS (Aktuell)
```
MCBS → S3 → EventBridge → Lambda → E-Invoice
```

### Phase 2: Parallel Betrieb (6-12 Monate)
```
MCBS → S3 → EventBridge ──┐
                           ├─→ Lambda → E-Invoice
AWS Billing → DynamoDB ───┘
```

### Phase 3: Full AWS Billing (Zukunft)
```
AWS Billing → DynamoDB → EventBridge → Lambda → E-Invoice
```

**Vorteile:**
- ✅ Zero Downtime Migration
- ✅ Gradual Rollout
- ✅ A/B Testing möglich
- ✅ Rollback jederzeit möglich

Fortsetzung in Teil 3...