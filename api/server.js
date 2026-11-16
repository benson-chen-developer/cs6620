import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand
} from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT || 3001);
const targetsTable = process.env.TARGETS_TABLE || 'targets';
const scansTable = process.env.SCANS_TABLE || 'scans';
const ownerIndex = process.env.OWNER_INDEX || 'ownerId-index';
const reportsBucket = process.env.REPORTS_BUCKET || 'pentest-reports-734159569569';

const dynamoConfig = {
  region: process.env.AWS_REGION || 'us-east-1'
};

const dynamoClient = new DynamoDBClient(dynamoConfig);

const dynamo = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: { removeUndefinedValues: true }
});

const s3 = new S3Client(dynamoConfig);

// Emails are the owner key, so normalize them the same way everywhere.
const normalizeEmail = (value) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const scheduleIntervals = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000
};

app.use(express.json());

// POST /targets - Create a new target (api url) for scanning.
app.post('/targets', async (req, res) => {
  const body = req.body || {};

  // url, frequency, and email are required fields for creating a target.
  const { url, frequency } = body;
  const email = normalizeEmail(body.email);

  if (!url) {
    return res.status(400).json({ error: 'URL is required.' });
  }
  if (!frequency) {
    return res.status(400).json({ error: 'Frequency is required.' });
  }
  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: 'A valid target URL is required.' });
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return res.status(400).json({ error: 'Target URL must use HTTP or HTTPS.' });
  }

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'A valid email is required.' });
  }

  if (!Object.hasOwn(scheduleIntervals, frequency)) {
    return res.status(400).json({
      error: 'Frequency must be hourly, daily, or weekly.'
    });
  }

  const now = new Date();
  const target = {
    targetId: randomUUID(),
    ownerId: email,
    url: parsedUrl.toString(),
    frequency,
    nextRunAt: new Date(now.getTime() + scheduleIntervals[frequency]).toISOString(),
    email,
    status: 'active',
    createdAt: now.toISOString()
  };

  try {
    await dynamo.send(new PutCommand({
      TableName: targetsTable,
      Item: target
    }));
    return res.status(201).json(target);
  } catch (error) {
    console.error('Failed to create target:', error);
    return res.status(500).json({ error: 'Could not save target.' });
  }
});

// GET /targets?ownerId=... - List all targets for a given owner (email).
app.get('/targets', async (req, res) => {
  const ownerId = normalizeEmail(req.query.ownerId);

  if (!ownerId) {
    return res.status(400).json({ error: 'ownerId query parameter is required.' });
  }

  try {
    const result = await dynamo.send(new QueryCommand({
      TableName: targetsTable,
      IndexName: ownerIndex,
      KeyConditionExpression: 'ownerId = :ownerId',
      ExpressionAttributeValues: { ':ownerId': ownerId }
    }));
    return res.json(result.Items || []);
  } catch (error) {
    console.error('Failed to list targets:', error);
    return res.status(500).json({ error: 'Could not retrieve targets.' });
  }
});

// GET /targets/:id/scans - List all scans for a given target.
app.get('/targets/:id/scans', async (req, res) => {
  try {
    const result = await dynamo.send(new QueryCommand({
      TableName: scansTable,
      KeyConditionExpression: 'targetId = :targetId',
      ExpressionAttributeValues: { ':targetId': req.params.id },
      ScanIndexForward: false
    }));
    return res.json(result.Items || []);
  } catch (error) {
    console.error('Failed to list scans:', error);
    return res.status(500).json({ error: 'Could not retrieve scan history.' });
  }
});

async function listTargetsForOwner(ownerId) {
  const result = await dynamo.send(new QueryCommand({
    TableName: targetsTable,
    IndexName: ownerIndex,
    KeyConditionExpression: 'ownerId = :ownerId',
    ExpressionAttributeValues: { ':ownerId': ownerId }
  }));
  return result.Items || [];
}

// GET /scans?ownerId=... - List every scan across all of an owner's targets.
app.get('/scans', async (req, res) => {
  const ownerId = normalizeEmail(req.query.ownerId);
  if (!ownerId) {
    return res.status(400).json({ error: 'ownerId query parameter is required.' });
  }

  try {
    const targets = await listTargetsForOwner(ownerId);
    const perTarget = await Promise.all(targets.map(async (target) => {
      const result = await dynamo.send(new QueryCommand({
        TableName: scansTable,
        KeyConditionExpression: 'targetId = :targetId',
        ExpressionAttributeValues: { ':targetId': target.targetId },
        ScanIndexForward: false
      }));
      return (result.Items || []).map((scan) => ({ ...scan, url: target.url }));
    }));
    const scans = perTarget.flat().sort((a, b) => b.scanId.localeCompare(a.scanId));
    return res.json(scans);
  } catch (error) {
    console.error('Failed to list scans:', error);
    return res.status(500).json({ error: 'Could not retrieve scans.' });
  }
});

//Matches a report key against the list of objects in S3 and finds the correct one.
async function findReportKey(reportKey) {
  const names = new Set([reportKey, `${reportKey}.json`]);
  let token;
  do {
    const page = await s3.send(new ListObjectsV2Command({
      Bucket: reportsBucket,
      ContinuationToken: token
    }));
    const match = (page.Contents || []).find((o) => names.has(o.Key.split('/').pop()));
    if (match) return match.Key;
    token = page.NextContinuationToken;
  } while (token);
  return null;
}

// GET /scans/report?reportKey=... - Find the report object for this reportKey in S3
// and return its JSON.
app.get('/scans/report', async (req, res) => {
  const { reportKey } = req.query;
  if (typeof reportKey !== 'string' || !reportKey) {
    return res.status(400).json({ error: 'reportKey is required.' });
  }
  if (!reportsBucket) {
    return res.status(500).json({ error: 'REPORTS_BUCKET is not configured.' });
  }

  try {
    const key = await findReportKey(reportKey);
    if (!key) {
      return res.status(404).json({ error: 'No report found for this scanId.' });
    }
    const object = await s3.send(new GetObjectCommand({ Bucket: reportsBucket, Key: key }));
    const body = await object.Body.transformToString();
    return res.type('application/json').send(body);
  } catch (error) {
    console.error('Failed to load report:', error);
    return res.status(500).json({ error: 'Could not load report.' });
  }
});

// Serve the built React app (the Docker image puts it in ./public).
// Registered after the API routes so they take priority.
const publicDir = process.env.PUBLIC_DIR || fileURLToPath(new URL('./public', import.meta.url));
app.use(express.static(publicDir));

// Verify AWS credentials and that the tables exist before accepting requests.
async function verifyDynamo() {
  for (const TableName of [targetsTable, scansTable]) {
    await dynamoClient.send(new DescribeTableCommand({ TableName }));
  }
}

try {
  await verifyDynamo(); // Verify that the DynamoDB tables exist and are accessible.
} catch (error) {
  console.error(`Could not connect to DynamoDB (region ${dynamoConfig.region}):`, error);
  process.exit(1);
}

app.listen(port, () => {
  console.log(`Pentest scheduling API listening on port ${port}`);
});