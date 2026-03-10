# IaC-Integration: Lambda Permission Boundary

Dieses Verzeichnis enthält CloudFormation-Templates und IAM-Snippets,
die einmalig in `billing-aws-account-iac` eingebunden werden müssen,
damit der `e-invoice-generator` (und künftige Lambda-Services) sicher
und autonom deployen können.

---

## Hintergrund: Warum überhaupt?

Serverless Framework v4 erstellt beim Deployment automatisch eine
**Lambda Execution Role** per CloudFormation. Dafür benötigt der
GitHub-Actions-Deploy-User `iam:CreateRole` und `iam:TagRole`.

Diese Rechte fehlen aktuell in der Deploy-Rolle, weil sie ohne
Einschränkung ein erhebliches Sicherheitsrisiko darstellen:

> Ein Deploy-User mit `iam:CreateRole` + `iam:CreatePolicy` (ohne
> Einschränkung) könnte sich selbst eine Rolle mit
> `AdministratorAccess` anlegen und damit den gesamten AWS-Account
> übernehmen (**Privilege Escalation**).

---

## Lösung: Permission Boundary als Sicherheitsnetz

Eine **Permission Boundary** ist eine IAM Managed Policy, die das
**maximale Berechtigungsenvelope** einer Rolle definiert – unabhängig
davon, was in der Rolle selbst steht.

```
Effektive Rechte = Rollen-Policy  ∩  Permission Boundary
```

Beispiel:

- Rolle definiert: `s3:*`
- Boundary erlaubt: `s3:GetObject`, `s3:PutObject`
- Effektiv erlaubt: nur `s3:GetObject` und `s3:PutObject`

### Wie verhindert das Privilege Escalation?

Der Deploy-User darf `iam:CreateRole` **nur dann**, wenn er gleichzeitig
die IaC-kontrollierte Boundary setzt (`iam:PermissionsBoundary`-Condition).
Da der Deploy-User die Boundary selbst **nicht ändern** darf
(kein `iam:CreatePolicy` auf die Boundary-Policy), kann er keine
mächtigere Rolle erschaffen als die Boundary erlaubt.

```
Deploy-User versucht: Rolle mit AdministratorAccess anlegen
→ AWS prüft Condition: ist PermissionsBoundary = default-lambda-boundary?
→ Ja → Rolle wird angelegt, aber AdministratorAccess wird von Boundary blockiert
→ Effektive Rechte: nur was Boundary erlaubt ✓
```

---

## Architekturprinzip: Account-weite Default-Boundary

Statt pro Service eine eigene Boundary zu erstellen, gibt es eine
**einmalige Default-Boundary** für alle Lambda-Services im Account.

```
IaC (einmalig)
├── default-lambda-boundary  (Managed Policy)
│    └── erlaubt: Logs, SQS, SNS, S3, SSM, DynamoDB, EventBridge, X-Ray
│        verbietet: iam:*, ec2:*, rds:*, organizations:*, cloudformation:* etc.
└── SSM: /shared/lambda-boundary-arn  →  ARN der Boundary

Jeder Lambda-Service
└── serverless.yml: permissionsBoundary: ${ssm:/shared/lambda-boundary-arn}
    → Rolle wird von Serverless automatisch erstellt
    → Service definiert selbst, welche genauen Rechte er braucht
    → Boundary sorgt dafür, dass er nie mehr haben kann als erlaubt
```

**Vorteile:**

- IaC muss keine Service-Details kennen (welche Queues, Buckets, etc.)
- Neue Lambda-Services brauchen **keine IaC-Änderung** mehr
- Service-Teams sind autonom: neue Permissions einfach in `serverless.yml`
- Sicherheit: maximale Rechte sind durch IaC-Hoheit unveränderlich begrenzt

Service-spezifische Boundaries nur bei echten Sonderfällen nötig
(z.B. `iam:PassRole` für Orchestration-Services, `ec2:*` für Infra-Manager).

---

## Was in billing-aws-account-iac einzupflegen ist

### 1. Default Lambda Boundary (einmalig)

**Datei:** [`e-invoice-lambda-boundary.yaml`](./e-invoice-lambda-boundary.yaml)

Empfohlener Pfad in billing-aws-account-iac:

```
fndls.mcbs.3007520/shared/iam/default-lambda-boundary.yaml
fndls.mcbs.3007520/shared/serverless.yaml  (neues Modul)
```

Erstellt:

- `default-lambda-boundary` (Managed Policy)
- SSM-Parameter `/shared/lambda-boundary-arn`

### 2. Deploy-User-Berechtigung (einmalig, gilt für alle Lambda-Services)

**Datei:** [`github-action-deploy-iam-addendum.yaml`](./github-action-deploy-iam-addendum.yaml)

Einbinden in:

```
fndls.mcbs.3007520/account-setup/iam/github-action-base-role.yaml
```

Als zusätzliche Policy neben den bestehenden:

```yaml
Policies:
  - PolicyName: existing-policy
    ...
  - PolicyName: serverless-lambda-deploy-iam-policy   # ← neu
    PolicyDocument:
      <Inhalt von github-action-deploy-iam-addendum.yaml>
```

Gewährt:

- `iam:CreateRole/TagRole` – **nur** mit `default-lambda-boundary` als Boundary
- `iam:PutRolePolicy/AttachRolePolicy` – für Serverless-managed Inline-Policies
- `iam:PassRole` – damit CloudFormation die Rolle Lambda zuweisen kann
- `ssm:GetParameter` auf `/shared/lambda-boundary-arn`

---

## Was der Service selbst konfiguriert

In `serverless.yml` des jeweiligen Lambda-Services – **keine IaC-Änderung nötig:**

```yaml
provider:
  iam:
    role:
      permissionsBoundary: ${ssm:/shared/lambda-boundary-arn}

  # Serverless erstellt die Lambda Execution Role automatisch.
  # Die Inline-Policy definiert der Service selbst (z.B. S3:GetObject auf konkreten Bucket).
  # Die Boundary stellt sicher, dass die Rolle nie mehr kann als erlaubt.
```

---

## Sicherheitsgarantien im Überblick

| Angriffsszenario                                     | Schutz                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| Deploy-User erstellt Rolle mit `AdministratorAccess` | Boundary blockiert zur Laufzeit ✓                             |
| Deploy-User erstellt Rolle ohne Boundary             | `iam:PermissionsBoundary`-Condition verweigert `CreateRole` ✓ |
| Deploy-User ändert die Boundary auf `*`              | Kein `iam:CreatePolicy` auf `default-lambda-boundary` ✓       |
| Deploy-User nimmt fremde Rolle an                    | `iam:PassRole` nur an `lambda.amazonaws.com` ✓                |
