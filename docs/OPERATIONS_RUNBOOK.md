# Operations Runbook — E-Invoice Generator

Dieses Dokument beschreibt wie Operations Alerts empfängt, eingehende Fehler bewertet und darauf reagiert.

---

## Architektur: Fehlerfluss

```
Lambda-Fehler (z.B. S3 NoSuchKey, XML-Parsing, Timeout)
    └── SQS: 3× Retry (VisibilityTimeout 360s)
            └── Dead Letter Queue (DLQ)
                    └── DLQ-Prozessor Lambda (sofort getriggert)
                            └── SNS Alert Topic
                                    ├── Email (Operations)
                                    ├── PagerDuty / Opsgenie (optional)
                                    └── Slack (optional)
```

Nach **3 fehlgeschlagenen Versuchen** landet eine Message in der DLQ. Die DLQ-Nachricht enthält:

- `messageId` — SQS Message ID zur Rückverfolgung
- `errorType` — z.B. `NoSuchKey`, `ZodError`, `ValidationError`
- `errorMessage` — Fehlermeldung im Klartext
- `originalPayload` — Das ursprüngliche EventBridge-Event

---

## SNS Alert Topics

| Stage      | Topic ARN                                                                    |
| ---------- | ---------------------------------------------------------------------------- |
| dev        | `arn:aws:sns:eu-central-1:{accountId}:e-invoice-generator-alerts-dev`        |
| staging    | `arn:aws:sns:eu-central-1:{accountId}:e-invoice-generator-alerts-staging`    |
| production | `arn:aws:sns:eu-central-1:{accountId}:e-invoice-generator-alerts-production` |

Der exakte ARN steht nach jedem Deployment im Stack Output `AlertTopicARN` und im CloudFormation Stack in der AWS Console.

---

## Subscriptions einrichten

### Email (schnellster Einstieg)

```bash
aws sns subscribe \
  --topic-arn arn:aws:sns:eu-central-1:{accountId}:e-invoice-generator-alerts-production \
  --protocol email \
  --notification-endpoint operations@freenet.ag \
  --region eu-central-1 \
  --profile {aws-profile}
```

AWS sendet eine Bestätigungs-E-Mail. Der enthaltene Link **muss bestätigt werden**, bevor Alerts zugestellt werden.

### HTTPS / PagerDuty / Opsgenie

```bash
aws sns subscribe \
  --topic-arn arn:aws:sns:eu-central-1:{accountId}:e-invoice-generator-alerts-production \
  --protocol https \
  --notification-endpoint https://events.pagerduty.com/integration/{key}/enqueue \
  --region eu-central-1
```

### Subscription prüfen

```bash
aws sns list-subscriptions-by-topic \
  --topic-arn arn:aws:sns:eu-central-1:{accountId}:e-invoice-generator-alerts-production \
  --region eu-central-1
```

---

## Incident-Prozess

### 1. Alert eingeht

Die SNS-Nachricht enthält JSON mit folgendem Schema:

```json
{
  "stage": "production",
  "messageId": "c8a5b9a5-4fc7-4024-b0d8-4c73f294272a",
  "errorType": "NoSuchKey",
  "errorMessage": "The specified key does not exist.",
  "s3Key": "raw/xml/invoice-123.xml",
  "timestamp": "2026-03-09T09:15:26.242Z"
}
```

### 2. Fehlertyp bestimmen

| `errorType`       | Ursache                                             | Sofortmaßnahme                                                   |
| ----------------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| `NoSuchKey`       | XML- oder PDF-Datei fehlt im S3 Bucket              | Datei manuell prüfen/nachliefern, dann DLQ-Message replayed      |
| `ZodError`        | MCBS-XML hat unbekanntes Format (Schema-Änderung)   | Development informieren, Schema-Update nötig                     |
| `ValidationError` | Erzeugte E-Rechnung besteht KOSIT-Validierung nicht | Development informieren, Mapping-Fehler                          |
| `TimeoutError`    | Lambda-Timeout (>60s)                               | Einzelne große Datei? Memory/Timeout in `serverless.yml` erhöhen |
| `AccessDenied`    | IAM-Berechtigungsfehler                             | IAM-Rolle `e-invoice-generator-lambda-role` prüfen               |

### 3. Fehlgeschlagene Messages reprocessen

DLQ-Messages können nach Behebung der Ursache zurück in die Hauptqueue verschoben werden:

```bash
# DLQ-URL ermitteln
aws cloudformation describe-stacks \
  --stack-name e-invoice-generator-production \
  --query "Stacks[0].Outputs[?OutputKey=='DLQQueueURL'].OutputValue" \
  --output text --region eu-central-1

# SQS-Redrive: DLQ → Hauptqueue
aws sqs start-message-move-task \
  --source-arn arn:aws:sqs:eu-central-1:{accountId}:mcbs-invoice-processing-dlq-production \
  --destination-arn arn:aws:sqs:eu-central-1:{accountId}:mcbs-invoice-processing-production \
  --region eu-central-1
```

### 4. CloudWatch Logs analysieren

```bash
# Letzte Fehler der letzten Stunde
aws logs filter-log-events \
  --log-group-name /aws/lambda/e-invoice-generator-production-createEInvoice \
  --filter-pattern "ERROR" \
  --start-time $(date -v-1H +%s000) \
  --region eu-central-1 | jq '.events[].message'
```

Oder im CloudWatch Dashboard:

```
https://console.aws.amazon.com/cloudwatch/home?region=eu-central-1#dashboards:name=e-invoice-generator-production
```

---

## Monitoring automatisieren (Empfehlung)

Für eine vollständige Automatisierung kann SNS als Trigger für eine Operations-Lambda dienen:

```
SNS Alert
    └── Ops-Lambda
            ├── Fehlertyp parsen
            ├── Bei NoSuchKey → CloudWatch Alarm erstellen + Ticket öffnen
            ├── Bei ZodError  → Slack-Nachricht #dev-alerts + Jira-Ticket
            └── Bei bekanntem transientem Fehler → automatischer Redrive
```

Die SNS-Message enthält alle nötigen Informationen (`errorType`, `s3Key`, `messageId`) für automatisches Routing ohne manuellen Eingriff.

---

## Kontakt

- **Slack**: `#e-invoice-generator`
- **Email**: tp.sd.back.mcbs@freenet.ag
