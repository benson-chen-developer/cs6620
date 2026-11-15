import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const targetsTable = process.env.TARGETS_TABLE || 'targets';
const queueUrl = process.env.QUEUE_URL;

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sqs = new SQSClient({});

// Must match the intervals used by the API.
const intervals = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000
};

// Finds every active target whose nextRunAt has passed.
async function findDueTargets(nowIso) {
  const items = [];
  let lastKey;
  do {
    const result = await dynamo.send(new QueryCommand({
      TableName: targetsTable,
      IndexName: 'status-nextRunAt-index',
      KeyConditionExpression: '#status = :active AND nextRunAt <= :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':active': 'active', ':now': nowIso },
      ExclusiveStartKey: lastKey
    }));
    items.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

export const handler = async () => {
  if (!queueUrl) throw new Error('QUEUE_URL is not set.');

  const now = new Date();
  const nowIso = now.toISOString();
  const due = await findDueTargets(nowIso);
  console.log(`Found ${due.length} due target(s).`);

  let enqueued = 0;
  for (const target of due) {
    try {
      const scanId = new Date().toISOString();

      // 1. Queue the scan job for a worker.
      await sqs.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({
          targetId: target.targetId,
          scanId,
          url: target.url,
          trigger: 'scheduled'
        })
      }));

      // 2. Move nextRunAt forward. The condition stops two overlapping runs
      //    from both advancing the same target.
      const step = intervals[target.frequency] ?? intervals.daily;
      await dynamo.send(new UpdateCommand({
        TableName: targetsTable,
        Key: { targetId: target.targetId },
        UpdateExpression: 'SET nextRunAt = :next',
        ConditionExpression: 'nextRunAt = :old',
        ExpressionAttributeValues: {
          ':next': new Date(now.getTime() + step).toISOString(),
          ':old': target.nextRunAt
        }
      }));
      enqueued++;
    } catch (error) {
      // One bad target shouldn't stop the rest.
      console.error(`Failed to schedule ${target.targetId}:`, error);
    }
  }

  return { due: due.length, enqueued };
};
