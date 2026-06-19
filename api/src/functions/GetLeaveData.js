const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');

const CONTAINER_NAME = 'leave-data';
const BLOB_NAME = 'staff-leave-data.json';

app.http('GetLeaveData', {
  methods: ['GET'],
  authLevel: 'anonymous', // access control is handled by staticwebapp.config.json routes, not here
  route: 'leave-data',
  handler: async (request, context) => {
    try {
      const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
      if (!connectionString) {
        return {
          status: 500,
          jsonBody: { error: 'Storage not configured. AZURE_STORAGE_CONNECTION_STRING is missing.' }
        };
      }

      const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
      const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
      const blockBlobClient = containerClient.getBlockBlobClient(BLOB_NAME);

      const exists = await blockBlobClient.exists();
      if (!exists) {
        // No data uploaded yet — return empty array, not an error.
        // The front end treats this the same as "first run, no real data yet".
        return {
          status: 200,
          jsonBody: { data: [], lastUpdated: null }
        };
      }

      const downloadResponse = await blockBlobClient.download();
      const downloaded = await streamToString(downloadResponse.readableStreamBody);
      const parsed = JSON.parse(downloaded);

      return {
        status: 200,
        jsonBody: parsed
      };
    } catch (err) {
      context.error('GetLeaveData failed:', err.message);
      return {
        status: 500,
        jsonBody: { error: 'Failed to read leave data.' }
      };
    }
  }
});

async function streamToString(readableStream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readableStream.on('data', (data) => {
      chunks.push(data instanceof Buffer ? data : Buffer.from(data));
    });
    readableStream.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    readableStream.on('error', reject);
  });
}
