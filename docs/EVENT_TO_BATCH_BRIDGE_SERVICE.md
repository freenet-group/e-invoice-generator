# Event-to-Batch Bridge Service für Billing

## Konzept: Event-Driven Trigger für Legacy Java Batch

### Problem

- **Aktuell**: Billing ist ein Java Batch-Prozess, der manuell per Kommandozeile gestartet wird
- **Ziel**: Event-basierte Architektur, aber Billing-Logik soll erstmal bleiben
- **Lösung**: Bridge Service, der Events konsumiert und Batch-Prozess startet

---

## Architektur

```
┌────────────────────────────────┐
│ DevicePaymentEndBillingService │
│ (Lambda)                       │
└────────────┬───────────────────┘
             │ publiziert Event
             ↓
      ┌──────────────────────────────┐
      │ DevicePaymentEndBillingRequired│
      │ Event (EventBridge)          │
      └──────────────────────────────┘
             │
             ↓
┌────────────────────────────────┐
│ BillingBatchTriggerService     │ ← NEUER BRIDGE SERVICE!
│ (Lambda oder ECS Task)         │
└────────────┬───────────────────┘
             │ startet
             ↓
┌────────────────────────────────┐
│ Java Billing Batch Process     │
│ (Bestehendes System)           │
│ - ContractBillProcess          │
│ - DevicePaymentEndBillingCalc  │
└────────────────────────────────┘
```

---

## Option 1: AWS Lambda als Bridge (Empfohlen für Start)

### Vorteile
- ✅ Einfach zu implementieren
- ✅ Serverless (keine Server-Verwaltung)
- ✅ Automatisches Scaling
- ✅ Pay-per-use

### Limitierungen
- ⚠️ Max. 15 Minuten Laufzeit (aber OK für Trigger)
- ⚠️ Lambda startet ECS Task oder EC2 Instance

### Serverless.yml

```yaml
service: billing-batch-trigger

provider:
  name: aws
  runtime: nodejs18.x
  region: eu-central-1
  iam:
    role:
      statements:
        # Erlaubnis ECS Tasks zu starten
        - Effect: Allow
          Action:
            - ecs:RunTask
            - ecs:DescribeTasks
          Resource: '*'
        # Erlaubnis DynamoDB zu schreiben (für Tracking)
        - Effect: Allow
          Action:
            - dynamodb:PutItem
            - dynamodb:UpdateItem
            - dynamodb:GetItem
          Resource: !GetAtt BillingJobTrackingTable.Arn

functions:
  triggerBillingBatch:
    handler: src/handlers/BillingBatchTriggerHandler.handle
    timeout: 300  # 5 Minuten
    memorySize: 512
    environment:
      ECS_CLUSTER: ${self:custom.ecsCluster}
      ECS_TASK_DEFINITION: ${self:custom.billingTaskDefinition}
      SUBNETS: ${self:custom.subnets}
      SECURITY_GROUPS: ${self:custom.securityGroups}
      TRACKING_TABLE: !Ref BillingJobTrackingTable
    events:
      # Lauscht auf DevicePaymentEndBillingRequired Events
      - eventBridge:
          eventBus: ${self:custom.eventBus}
          pattern:
            source:
              - device.payment
            detail-type:
              - DevicePaymentEndBillingRequired

resources:
  Resources:
    # DynamoDB Tabelle für Job-Tracking
    BillingJobTrackingTable:
      Type: AWS::DynamoDB::Table
      Properties:
        TableName: BillingBatchJobs
        BillingMode: PAY_PER_REQUEST
        AttributeDefinitions:
          - AttributeName: jobId
            AttributeType: S
          - AttributeName: contractId
            AttributeType: S
          - AttributeName: eventId
            AttributeType: S
        KeySchema:
          - AttributeName: jobId
            KeyType: HASH
        GlobalSecondaryIndexes:
          - IndexName: contractId-index
            KeySchema:
              - AttributeName: contractId
                KeyType: HASH
            Projection:
              ProjectionType: ALL
          - IndexName: eventId-index
            KeySchema:
              - AttributeName: eventId
                KeyType: HASH
            Projection:
              ProjectionType: ALL

custom:
  eventBus: telco-platform-event-bus
  ecsCluster: billing-cluster
  billingTaskDefinition: billing-batch-task
  subnets: subnet-xxxxx,subnet-yyyyy
  securityGroups: sg-xxxxx
```

---

### Lambda Handler (TypeScript)

```typescript
// src/handlers/BillingBatchTriggerHandler.ts
import { EventBridgeHandler } from 'aws-lambda';
import { ECSClient, RunTaskCommand, DescribeTasksCommand } from '@aws-sdk/client-ecs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

const ecsClient = new ECSClient({ region: process.env.AWS_REGION });
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface DevicePaymentEndBillingRequiredEvent {
  eventId: string;
  contractId: string;
  devicePaymentSubId: number;
  monthlyRate: number;
  totalInstallments: number;
  totalAmount: number;
  periodStart: string;
  periodEnd: string;
  reason: string;
}

export const handle: EventBridgeHandler<
  'DevicePaymentEndBillingRequired',
  DevicePaymentEndBillingRequiredEvent,
  void
> = async (event) => {
  
  console.log('Received DevicePaymentEndBillingRequired event:', JSON.stringify(event));
  
  const billingEvent = event.detail;
  const jobId = uuidv4();
  
  try {
    // 1. Idempotenz-Check
    const existingJob = await checkExistingJob(billingEvent.eventId);
    if (existingJob) {
      console.log(`Job already exists for event ${billingEvent.eventId}: ${existingJob.jobId}`);
      return;
    }
    
    // 2. Job-Tracking Record erstellen
    await createJobTracking(jobId, billingEvent);
    
    // 3. ECS Task starten (Java Batch Process)
    const taskArn = await startBillingBatchTask(jobId, billingEvent);
    
    // 4. Job-Tracking aktualisieren
    await updateJobTracking(jobId, {
      status: 'RUNNING',
      taskArn: taskArn,
      startedAt: new Date().toISOString()
    });
    
    console.log(`Successfully started billing batch job ${jobId} for contract ${billingEvent.contractId}`);
    
  } catch (error) {
    console.error(`Failed to start billing batch job:`, error);
    
    // Update Job-Tracking mit Fehler
    await updateJobTracking(jobId, {
      status: 'FAILED',
      errorMessage: error.message,
      failedAt: new Date().toISOString()
    });
    
    throw error;
  }
};

async function checkExistingJob(eventId: string): Promise<any> {
  const result = await dynamoClient.send(
    new GetCommand({
      TableName: process.env.TRACKING_TABLE,
      IndexName: 'eventId-index',
      Key: { eventId }
    })
  );
  return result.Item;
}

async function createJobTracking(jobId: string, event: DevicePaymentEndBillingRequiredEvent) {
  await dynamoClient.send(
    new PutCommand({
      TableName: process.env.TRACKING_TABLE,
      Item: {
        jobId,
        contractId: event.contractId,
        eventId: event.eventId,
        devicePaymentSubId: event.devicePaymentSubId,
        totalAmount: event.totalAmount,
        monthlyRate: event.monthlyRate,
        totalInstallments: event.totalInstallments,
        periodStart: event.periodStart,
        periodEnd: event.periodEnd,
        reason: event.reason,
        status: 'PENDING',
        createdAt: new Date().toISOString()
      }
    })
  );
}

async function updateJobTracking(jobId: string, updates: any) {
  const updateExpression = Object.keys(updates)
    .map(key => `${key} = :${key}`)
    .join(', ');
  
  const expressionAttributeValues = Object.entries(updates)
    .reduce((acc, [key, value]) => ({ ...acc, [`:${key}`]: value }), {});
  
  await dynamoClient.send(
    new UpdateCommand({
      TableName: process.env.TRACKING_TABLE,
      Key: { jobId },
      UpdateExpression: `SET ${updateExpression}`,
      ExpressionAttributeValues: expressionAttributeValues
    })
  );
}

async function startBillingBatchTask(
  jobId: string,
  event: DevicePaymentEndBillingRequiredEvent
): Promise<string> {
  
  // ECS Task starten mit Java Batch Process
  const command = new RunTaskCommand({
    cluster: process.env.ECS_CLUSTER,
    taskDefinition: process.env.ECS_TASK_DEFINITION,
    launchType: 'FARGATE',
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: process.env.SUBNETS.split(','),
        securityGroups: process.env.SECURITY_GROUPS.split(','),
        assignPublicIp: 'ENABLED'
      }
    },
    overrides: {
      containerOverrides: [
        {
          name: 'billing-batch',
          command: [
            'java',
            '-jar',
            '/app/billing-batch.jar',
            '--job-id', jobId,
            '--contract-id', event.contractId,
            '--device-payment-sub-id', event.devicePaymentSubId.toString(),
            '--billing-type', 'DEVICE_PAYMENT_END_BILLING',
            '--event-id', event.eventId
          ],
          environment: [
            { name: 'JOB_ID', value: jobId },
            { name: 'CONTRACT_ID', value: event.contractId },
            { name: 'DEVICE_PAYMENT_SUB_ID', value: event.devicePaymentSubId.toString() },
            { name: 'MONTHLY_RATE', value: event.monthlyRate.toString() },
            { name: 'TOTAL_INSTALLMENTS', value: event.totalInstallments.toString() },
            { name: 'TOTAL_AMOUNT', value: event.totalAmount.toString() },
            { name: 'PERIOD_START', value: event.periodStart },
            { name: 'PERIOD_END', value: event.periodEnd },
            { name: 'REASON', value: event.reason }
          ]
        }
      ]
    }
  });
  
  const response = await ecsClient.send(command);
  
  if (!response.tasks || response.tasks.length === 0) {
    throw new Error('Failed to start ECS task');
  }
  
  const taskArn = response.tasks[0].taskArn;
  console.log(`Started ECS task: ${taskArn}`);
  
  return taskArn;
}
```

---

## Option 2: ECS Scheduled Task mit Event-Trigger (Flexibler)

### Vorteile
- ✅ Längere Laufzeiten möglich
- ✅ Mehr Kontrolle über Ressourcen
- ✅ Kann direkt Java ausführen

### ECS Task Definition

```json
// billing-batch-task-definition.json
{
  "family": "billing-batch-task",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "containerDefinitions": [
    {
      "name": "billing-batch",
      "image": "your-ecr-repo/billing-batch:latest",
      "essential": true,
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/billing-batch",
          "awslogs-region": "eu-central-1",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "environment": [
        { "name": "DB_HOST", "value": "your-db-host" },
        { "name": "DB_PORT", "value": "5432" },
        { "name": "DB_NAME", "value": "billing" }
      ],
      "secrets": [
        {
          "name": "DB_PASSWORD",
          "valueFrom": "arn:aws:secretsmanager:eu-central-1:xxx:secret:billing-db-password"
        }
      ]
    }
  ]
}
```

---

## Option 3: Wrapper um bestehenden Java Batch (Einfachste Migration)

### Java Wrapper Service

```java
// BillingBatchEventWrapper.java
package de.md.mcbs.billing.event;

import java.time.LocalDate;
import java.util.Arrays;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import com.amazonaws.services.lambda.runtime.events.ScheduledEvent;

import de.md.mcbs.billing.process.ContractBillProcess;
import de.md.mcbs.customerproduct.entity.McContract;

/**
 * Lambda Handler, der DevicePaymentEndBillingRequired Events konsumiert
 * und den bestehenden Java Billing Batch Process startet.
 */
public class BillingBatchEventWrapper implements RequestHandler<DevicePaymentEndBillingRequiredEvent, String> {
    
    private static final Logger LOGGER = LoggerFactory.getLogger(BillingBatchEventWrapper.class);
    
    @Override
    public String handleRequest(DevicePaymentEndBillingRequiredEvent event, Context context) {
        
        LOGGER.info("Received DevicePaymentEndBillingRequired event for contract: {}", 
            event.getContractId());
        
        try {
            // Idempotenz-Check
            if (isAlreadyProcessed(event.getEventId())) {
                LOGGER.info("Event {} already processed - skipping", event.getEventId());
                return "SKIPPED";
            }
            
            // Hole Contract
            McContract contract = getContract(event.getContractId());
            
            // Setze McMark für Billing-Trigger (bestehende Logik)
            setDevicePaymentEndBillingMark(contract, event);
            
            // Starte Billing nur für diesen Vertrag
            ContractBillProcess billProcess = new ContractBillProcess();
            billProcess.billContract(
                contract,
                LocalDate.parse(event.getPeriodEnd()),
                BillingType.DEVICE_PAYMENT_END_BILLING
            );
            
            // Markiere Event als verarbeitet
            markAsProcessed(event.getEventId());
            
            LOGGER.info("Successfully processed billing for contract {} - event {}", 
                event.getContractId(), event.getEventId());
            
            return "SUCCESS";
            
        } catch (Exception e) {
            LOGGER.error("Failed to process billing event", e);
            throw new RuntimeException("Billing failed: " + e.getMessage(), e);
        }
    }
    
    private boolean isAlreadyProcessed(String eventId) {
        // Prüfe in DynamoDB oder Datenbank
        return DevicePaymentEventRepository.existsByEventId(eventId);
    }
    
    private void markAsProcessed(String eventId) {
        DevicePaymentEventRepository.markAsProcessed(eventId);
    }
    
    private McContract getContract(String contractId) {
        // Bestehende Logik
        return CustomerProductModuleLocal.getContractQuery().getContract(contractId);
    }
    
    private void setDevicePaymentEndBillingMark(McContract contract, DevicePaymentEndBillingRequiredEvent event) {
        // Bestehende McMark-Logik
        McMark mark = new McMark();
        mark.setMarkType(McMarkType.DEVICE_PAYMENT_END_BILLING);
        mark.setParameter(event.getEventId());
        MarkQueryImpl.insertMark(contract, mark);
    }
}

// Event POJO
class DevicePaymentEndBillingRequiredEvent {
    private String eventId;
    private String contractId;
    private int devicePaymentSubId;
    private double monthlyRate;
    private int totalInstallments;
    private double totalAmount;
    private String periodStart;
    private String periodEnd;
    private String reason;
    
    // Getters & Setters
    // ...
}
```

---

## Dockerfile für Java Batch in ECS

```dockerfile
# Dockerfile
FROM eclipse-temurin:21-jre-alpine

# Arbeitsverzeichnis
WORKDIR /app

# Kopiere JAR
COPY target/billing-batch.jar /app/billing-batch.jar

# Kopiere Konfiguration
COPY src/main/resources/application.properties /app/config/

# Umgebungsvariablen
ENV JAVA_OPTS="-Xmx1536m -XX:+UseG1GC"

# Entrypoint
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar /app/billing-batch.jar $@", "--"]
```

---

## Angepasster Java Batch Process (Minimal Changes)

```java
// BillingBatchMain.java
package de.md.mcbs.billing;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Billing Batch Process - kann jetzt auch event-driven gestartet werden.
 */
@SpringBootApplication
public class BillingBatchMain implements CommandLineRunner {
    
    private static final Logger LOGGER = LoggerFactory.getLogger(BillingBatchMain.class);
    
    public static void main(String[] args) {
        SpringApplication.run(BillingBatchMain.class, args);
    }
    
    @Override
    public void run(String... args) throws Exception {
        
        LOGGER.info("Starting Billing Batch Process");
        LOGGER.info("Arguments: {}", Arrays.toString(args));
        
        // Parse Arguments
        BillingJobConfig config = parseArguments(args);
        
        if (config.getJobId() != null) {
            // Event-driven Modus - einzelner Vertrag
            LOGGER.info("Running in EVENT-DRIVEN mode for job {}", config.getJobId());
            runEventDrivenBilling(config);
        } else {
            // Klassischer Batch-Modus - alle Verträge
            LOGGER.info("Running in BATCH mode");
            runBatchBilling(config);
        }
        
        LOGGER.info("Billing Batch Process completed");
    }
    
    private void runEventDrivenBilling(BillingJobConfig config) {
        LOGGER.info("Processing single contract: {}", config.getContractId());
        
        // Hole Contract
        McContract contract = CustomerProductModuleLocal.getContractQuery()
            .getContract(config.getContractId());
        
        // Billing nur für diesen Vertrag
        ContractBillProcess billProcess = new ContractBillProcess();
        billProcess.billContract(
            contract,
            config.getBillingDate(),
            config.getBillingType()
        );
        
        LOGGER.info("Event-driven billing completed for contract {}", config.getContractId());
    }
    
    private void runBatchBilling(BillingJobConfig config) {
        LOGGER.info("Processing all contracts with McMark");
        
        // Bestehende Logik - findet Verträge über McMark
        List<McContract> contracts = findContractsForBilling(config.getBillingDate());
        
        for (McContract contract : contracts) {
            try {
                ContractBillProcess billProcess = new ContractBillProcess();
                billProcess.billContract(contract, config.getBillingDate(), null);
            } catch (Exception e) {
                LOGGER.error("Failed to bill contract {}", contract.getContractNo(), e);
            }
        }
        
        LOGGER.info("Batch billing completed - processed {} contracts", contracts.size());
    }
    
    private BillingJobConfig parseArguments(String[] args) {
        BillingJobConfig config = new BillingJobConfig();
        
        for (int i = 0; i < args.length; i++) {
            switch (args[i]) {
                case "--job-id":
                    config.setJobId(args[++i]);
                    break;
                case "--contract-id":
                    config.setContractId(args[++i]);
                    break;
                case "--billing-type":
                    config.setBillingType(BillingType.valueOf(args[++i]));
                    break;
                case "--billing-date":
                    config.setBillingDate(LocalDate.parse(args[++i]));
                    break;
                case "--device-payment-sub-id":
                    config.setDevicePaymentSubId(Short.parseShort(args[++i]));
                    break;
                case "--event-id":
                    config.setEventId(args[++i]);
                    break;
            }
        }
        
        return config;
    }
}

// Konfiguration
class BillingJobConfig {
    private String jobId;
    private String contractId;
    private BillingType billingType;
    private LocalDate billingDate;
    private Short devicePaymentSubId;
    private String eventId;
    
    // Getters & Setters
}

enum BillingType {
    REGULAR_BILLING,
    DEVICE_PAYMENT_END_BILLING,
    INSTANT_BILLING
}
```

---

## Monitoring & Status-Tracking

### CloudWatch Dashboard

```yaml
# CloudWatch Dashboard für Billing Jobs
BillingJobsDashboard:
  Type: AWS::CloudWatch::Dashboard
  Properties:
    DashboardName: billing-batch-jobs
    DashboardBody: |
      {
        "widgets": [
          {
            "type": "metric",
            "properties": {
              "metrics": [
                [ "AWS/ECS", "CPUUtilization", { "stat": "Average" } ],
                [ ".", "MemoryUtilization", { "stat": "Average" } ]
              ],
              "period": 300,
              "stat": "Average",
              "region": "eu-central-1",
              "title": "ECS Resource Utilization"
            }
          },
          {
            "type": "log",
            "properties": {
              "query": "SOURCE '/ecs/billing-batch'\n| fields @timestamp, @message\n| filter @message like /ERROR/\n| sort @timestamp desc",
              "region": "eu-central-1",
              "title": "Billing Errors"
            }
          }
        ]
      }
```

### Status-Polling Lambda (Optional)

```typescript
// src/handlers/BillingJobStatusPoller.ts
import { ScheduledHandler } from 'aws-lambda';
import { ECSClient, DescribeTasksCommand } from '@aws-sdk/client-ecs';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

/**
 * Pollt den Status laufender Billing Jobs und aktualisiert DynamoDB
 */
export const handle: ScheduledHandler = async (event) => {
  
  const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const ecsClient = new ECSClient({});
  
  // Hole alle RUNNING Jobs
  const runningJobs = await dynamoClient.send(
    new ScanCommand({
      TableName: process.env.TRACKING_TABLE,
      FilterExpression: '#status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'RUNNING' }
    })
  );
  
  for (const job of runningJobs.Items || []) {
    try {
      // Prüfe ECS Task Status
      const taskStatus = await ecsClient.send(
        new DescribeTasksCommand({
          cluster: process.env.ECS_CLUSTER,
          tasks: [job.taskArn]
        })
      );
      
      const task = taskStatus.tasks?.[0];
      if (!task) continue;
      
      // Update Job Status basierend auf Task Status
      if (task.lastStatus === 'STOPPED') {
        const exitCode = task.containers?.[0]?.exitCode;
        const newStatus = exitCode === 0 ? 'COMPLETED' : 'FAILED';
        
        await dynamoClient.send(
          new UpdateCommand({
            TableName: process.env.TRACKING_TABLE,
            Key: { jobId: job.jobId },
            UpdateExpression: 'SET #status = :status, completedAt = :completedAt',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':status': newStatus,
              ':completedAt': new Date().toISOString()
            }
          })
        );
        
        console.log(`Job ${job.jobId} completed with status ${newStatus}`);
      }
      
    } catch (error) {
      console.error(`Failed to check status for job ${job.jobId}:`, error);
    }
  }
};
```

---

## Deployment-Strategie

### Phase 1: Bridge Service aufbauen (2-4 Wochen)

```bash
# 1. Lambda deployen
cd billing-batch-trigger
npm install
serverless deploy --stage dev

# 2. ECS Cluster & Task Definition erstellen
aws ecs create-cluster --cluster-name billing-cluster

aws ecs register-task-definition \
  --cli-input-json file://billing-batch-task-definition.json

# 3. Docker Image bauen und pushen
docker build -t billing-batch .
docker tag billing-batch:latest your-ecr-repo/billing-batch:latest
docker push your-ecr-repo/billing-batch:latest

# 4. Test mit einem Event
aws events put-events \
  --entries file://test-event.json
```

### Phase 2: Parallel-Betrieb (1-2 Monate)

- Bridge Service läuft
- Manueller Batch läuft weiterhin
- Vergleiche Ergebnisse
- Monitoring & Alerting

### Phase 3: Vollständige Migration (später)

- Nur noch Event-driven
- Manueller Batch als Fallback
- Später: Billing selbst zu Lambda/ECS migrieren

---

## Vorteile dieser Lösung

| Vorteil | Beschreibung |
|---------|--------------|
| **Keine Code-Änderungen** | Bestehender Java Batch läuft weiter wie bisher |
| **Event-driven** | Wird über Events getriggert statt manuell |
| **Schrittweise Migration** | Bridge kann später durch echte Event-Architektur ersetzt werden |
| **Testbar** | Kann parallel zum bestehenden System laufen |
| **Skalierbar** | ECS skaliert automatisch |
| **Monitoring** | CloudWatch Logs & Metrics out-of-the-box |

---

## Kosten-Abschätzung (AWS)

```
Lambda (Bridge):
- Ausführungen: ~1000/Monat
- Dauer: 30 Sekunden
- Kosten: ~$0.20/Monat

ECS Fargate (Billing Batch):
- vCPU: 1
- Memory: 2 GB
- Laufzeit: 5 Minuten pro Job
- Jobs: 1000/Monat
- Kosten: ~$8/Monat

DynamoDB:
- Read/Write: Minimal
- Kosten: ~$1/Monat

GESAMT: ~$10/Monat
```

---

## Fazit

✅ **JA, das ist eine sehr gute Lösung!**

Der Bridge Service ermöglicht:
1. ✅ Event-driven Architektur JETZT nutzen
2. ✅ Bestehenden Batch-Code behalten
3. ✅ Schrittweise Migration
4. ✅ Minimales Risiko
5. ✅ Sofortiger Mehrwert (Event-driven)

**Nächster Schritt:** Soll ich Ihnen die Lambda-Function und die Serverless.yml komplett fertig machen?
