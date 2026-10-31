import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { runAllTests } from "./pentest/tester.js";

const region = process.env.AWS_REGION || "us-east-1";
const queueUrl = process.env.QUEUE_URL;
const reportsBucket = process.env.REPORTS_BUCKET;
const targetsTable = process.env.TARGETS_TABLE || "targets";
const scansTable = process.env.SCANS_TABLE || "scans";

if (!queueUrl || !reportsBucket) {
  console.error("QUEUE_URL and REPORTS_BUCKET must be set.");
  process.exit(1);
}

const sqs = new SQSClient({ region });
const s3 = new S3Client({ region });
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
  marshallOptions: { removeUndefinedValues: true },
});

// Runs the pentest and builds the report
async function runScan(targetUrl) {
  const results = await runAllTests(targetUrl, {});
  return {
    success: true,
    targetUrl,
    scannedAt: new Date().toISOString(),
    summary: {
      totalTests: results.length,
      passed: results.filter((r) => r.status === "PASS").length,
      failed: results.filter((r) => r.status === "FAIL").length,
      warnings: results.filter((r) => r.status === "WARNING").length,
      errors: results.filter((r) => r.status === "ERROR").length,
    },
    results,
  };
}

// Handles one job from the job queue
async function processJob(message) {
  const job = JSON.parse(message.Body); // { targetId, scanId, url, trigger }
  const attempts = Number(message.Attributes?.ApproximateReceiveCount || 1);

  // Check that the target still exists and is active
  const { Item: target } = await dynamo.send(
    new GetCommand({
      TableName: targetsTable,
      Key: { targetId: job.targetId },
    }),
  );

  if (!target || target.status !== "active") {
    console.log(`Skipping ${job.targetId}: target missing or not active.`);
    return;
  }

  // Record that the scan has started
  const startedAt = new Date().toISOString();
  await dynamo.send(
    new PutCommand({
      TableName: scansTable,
      Item: {
        targetId: job.targetId,
        scanId: job.scanId,
        status: "running",
        trigger: job.trigger,
        attempts,
        startedAt,
      },
    }),
  );

  // Run pentest scan
  console.log(`Scanning ${target.url} (scan ${job.scanId}, attempt ${attempts})`);
  const report = await runScan(target.url);

  // Save full report to S3
  const reportKey = `reports/${job.targetId}/${job.scanId}.json`;
  await s3.send(
    new PutObjectCommand({
      Bucket: reportsBucket,
      Key: reportKey,
      Body: JSON.stringify(report, null, 2),
      ContentType: "application/json",
    }),
  );

  // Record the summary in DynamoDB
  await dynamo.send(
    new PutCommand({
      TableName: scansTable,
      Item: {
        targetId: job.targetId,
        scanId: job.scanId,
        status: "done",
        trigger: job.trigger,
        attempts,
        startedAt,
        finishedAt: new Date().toISOString(),
        counts: {
          pass: report.summary.passed,
          fail: report.summary.failed,
          warning: report.summary.warnings,
          error: report.summary.errors,
        },
        failedTests: report.results.filter((r) => r.status === "FAIL").map((r) => r.id),
        reportKey,
      },
    }),
  );

  console.log(`Finished scan ${job.scanId}: ${report.summary.failed} failed.`);
}

// Polls the job queue for jobs
async function pollQueue() {
  console.log(`Worker started. Polling ${queueUrl}`);

  while (true) {
    let response;
    // Poll the queue
    try {
      response = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 1, // Take one message from the queue
          WaitTimeSeconds: 20, // Perform long polling
          MessageSystemAttributeNames: ["ApproximateReceiveCount"], // How many times this has been handed to a worker
        }),
      );
      // Handle polling errors
    } catch (error) {
      console.error("Could not receive from SQS:", error);
      await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5s before trying again
      continue;
    }

    // Process job
    for (const message of response.Messages || []) {
      // Delete job from queue if successfully processed
      try {
        await processJob(message);
        await sqs.send(
          new DeleteMessageCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: message.ReceiptHandle,
          }),
        );
      } catch (error) {
        console.error("Job failed, leaving it in the queue for retry:", error);
      }
    }
  }
}

pollQueue();
