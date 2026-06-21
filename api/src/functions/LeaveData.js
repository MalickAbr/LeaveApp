const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');

const CONTAINER_NAME = 'leave-data';
const BLOB_NAME = 'staff-leave-data.json';

app.http('LeaveData', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous', // access control is handled by staticwebapp.config.json routes
  route: 'leave-data',
  handler: async (request, context) => {
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

    if (request.method === 'GET') {
      try {
        const exists = await blockBlobClient.exists();
        if (!exists) {
          return { status: 200, jsonBody: { data: [], lastUpdated: null } };
        }
        const downloadResponse = await blockBlobClient.download();
        const downloaded = await streamToString(downloadResponse.readableStreamBody);
        return { status: 200, jsonBody: JSON.parse(downloaded) };
      } catch (err) {
        context.error('GET leave-data failed:', err.message);
        return { status: 500, jsonBody: { error: 'Failed to read leave data.' } };
      }
    }

    if (request.method === 'POST') {
      try {
        const principalHeader = request.headers.get('x-ms-client-principal');
        if (!principalHeader) {
          return { status: 401, jsonBody: { error: 'Not authenticated.' } };
        }
        const principal = JSON.parse(Buffer.from(principalHeader, 'base64').toString('utf8'));

        const body = await request.json();
        if (!body || !Array.isArray(body.data)) {
          return { status: 400, jsonBody: { error: 'Request body must be { data: [...] }' } };
        }

        await containerClient.createIfNotExists();
        const payload = JSON.stringify({
          data: body.data,
          lastUpdated: new Date().toISOString(),
          updatedBy: principal.userDetails
        });
        await blockBlobClient.upload(payload, Buffer.byteLength(payload), { overwrite: true });

        return { status: 200, jsonBody: { success: true, lastUpdated: new Date().toISOString() } };
      } catch (err) {
        context.error('POST leave-data failed:', err.message);
        return { status: 500, jsonBody: { error: 'Failed to save leave data.' } };
      }
    }

    return { status: 405, jsonBody: { error: 'Method not allowed.' } };
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
